import { Queue, Worker, UnrecoverableError, type Job as BullJob } from 'bullmq';
import Redis from 'ioredis';
import type { IJobQueue, Job, JobHandler } from './job-queue.interface.js';

export interface BullMQQueueOptions {
    queueName?: string | undefined;
    redisUrl?: string | undefined;
    connection?: { host?: string | undefined; port?: number | undefined; password?: string | undefined } | undefined;
    concurrency?: number | undefined;
    globalConcurrency?: number | undefined;
    attempts?: number | undefined;
    backoffMs?: number | undefined;
    lockDurationMs?: number | undefined;
    stalledIntervalMs?: number | undefined;
    onError?: ((error: Error) => void) | undefined;
}

/** Redis-backed producer; a consumer starts only when process() is explicitly called. */
export class BullMQJobQueue<TData = any, TResult = any> implements IJobQueue<TData, TResult> {
    private readonly queue: Queue;
    private readonly producer: Redis;
    private consumer: Redis | undefined;
    private worker: Worker | undefined;
    private processingType: string | undefined;
    private closed = false;
    private readonly name: string;
    private readonly attempts: number;

    constructor(private readonly options: BullMQQueueOptions = {}) {
        this.name = options.queueName ?? 'rag-ingestion-queue';
        if (!/^[a-zA-Z0-9_-]+$/.test(this.name)) throw new Error('Invalid queueName.');
        this.attempts = options.attempts ?? 3;
        for (const [name, value] of Object.entries({ attempts: this.attempts, concurrency: options.concurrency ?? 2, globalConcurrency: options.globalConcurrency ?? 4 })) {
            if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
        }
        this.producer = this.connection(false);
        this.queue = new Queue(this.name, { connection: this.producer });
        this.queue.on('error', error => this.report(error));
    }

    private connection(worker: boolean): Redis {
        const settings = { maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: worker, connectTimeout: 2000 };
        const client = this.options.redisUrl
            ? new Redis(this.options.redisUrl, settings)
            : new Redis({ host: this.options.connection?.host ?? '127.0.0.1', port: this.options.connection?.port ?? 6379, ...(this.options.connection?.password !== undefined ? { password: this.options.connection.password } : {}), ...settings });
        client.on('error', error => this.report(error));
        return client;
    }

    private report(error: Error): void {
        this.options.onError?.(error);
    }

    public async ready(): Promise<void> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([this.queue.waitUntilReady(), new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Redis queue readiness timed out.')), 5000);
            })]);
            await this.queue.setGlobalConcurrency(this.options.globalConcurrency ?? 4);
        } finally { if (timeout) clearTimeout(timeout); }
    }

    public async add(type: string, data: TData, jobId?: string): Promise<Job<TData, TResult>> {
        if (this.closed) throw new Error('Queue is closed.');
        const job = await this.queue.add(type, data, {
            ...(jobId ? { jobId } : {}), attempts: this.attempts,
            backoff: { type: 'exponential', delay: this.options.backoffMs ?? 1000 },
            removeOnComplete: { age: 7 * 86400, count: 10000 }, removeOnFail: { age: 7 * 86400, count: 10000 }
        });
        return this.map(job, 'queued');
    }

    public async getJob(id: string): Promise<Job<TData, TResult> | null> {
        const job = await this.queue.getJob(id);
        if (!job) return null;
        const state = await job.getState();
        const status = state === 'active' ? 'processing' : state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'queued';
        return this.map(job, status);
    }

    public async process(type: string, handler: JobHandler<TData, TResult>): Promise<void> {
        if (this.closed) throw new Error('Queue is closed.');
        if (this.processingType && this.processingType !== type) throw new Error('Use one job type per queue.');
        this.processingType = type;
        if (!this.worker) {
            this.consumer = this.connection(true);
            this.worker = new Worker(this.name, async job => {
                if (job.name !== type) throw new UnrecoverableError(`Unsupported job type: ${job.name}`);
                return handler(this.map(job, 'processing'), progress => job.updateProgress(progress));
            }, {
                connection: this.consumer, concurrency: this.options.concurrency ?? 2,
                lockDuration: this.options.lockDurationMs ?? 30000,
                stalledInterval: this.options.stalledIntervalMs ?? 30000,
                maxStalledCount: 2
            });
            this.worker.on('error', error => this.report(error));
        }
        await this.worker.waitUntilReady();
    }

    public async retry(id: string): Promise<void> {
        const job = await this.queue.getJob(id);
        if (!job || await job.getState() !== 'failed') throw new Error('Only a failed job can be retried.');
        await job.retry('failed', { resetAttemptsMade: true });
    }

    public async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        try {
            await this.worker?.close(); // Drain active work before releasing connections.
            if (this.producer.status !== 'ready') this.producer.disconnect();
            await this.queue.close();
        } finally {
            this.consumer?.disconnect(); this.producer.disconnect();
        }
    }

    private map(job: BullJob, status: Job['status']): Job<TData, TResult> {
        return {
            id: job.id!, type: job.name, data: job.data as TData, status,
            progress: typeof job.progress === 'number' ? job.progress : 0,
            result: job.returnvalue as TResult, error: job.failedReason,
            createdAt: job.timestamp, updatedAt: job.finishedOn ?? job.processedOn ?? job.timestamp,
            completedAt: job.finishedOn, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? 1
        };
    }
}
