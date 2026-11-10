import { Queue, Worker, UnrecoverableError, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';
import type { IJobQueue, Job, JobHandler } from './job-queue.interface.js';

/**
 * Configuration options for the BullMQ Redis-backed job queue.
 */
export interface BullMQQueueOptions {
    /** Name of the Redis queue. @defaultValue 'rag-ingestion-queue' */
    queueName?: string | undefined;
    /** Redis connection URL string (e.g. 'redis://:auth@127.0.0.1:6379/0'). */
    redisUrl?: string | undefined;
    /** Host, port, and password connection parameters. */
    connection?: { host?: string | undefined; port?: number | undefined; password?: string | undefined } | undefined;
    /** Worker concurrency per process. @defaultValue 2 */
    concurrency?: number | undefined;
    /** Global cluster concurrency limit. @defaultValue 4 */
    globalConcurrency?: number | undefined;
    /** Maximum retry attempts for failed jobs. @defaultValue 3 */
    attempts?: number | undefined;
    /** Exponential backoff delay in milliseconds. @defaultValue 1000 */
    backoffMs?: number | undefined;
    /** Lock duration for long-running ingestion chunks. @defaultValue 30000 */
    lockDurationMs?: number | undefined;
    /** Stalled job check interval in milliseconds. @defaultValue 30000 */
    stalledIntervalMs?: number | undefined;
    /** Callback invoked on Redis connection or worker errors. */
    onError?: ((error: Error) => void) | undefined;
}

/**
 * Enterprise distributed job queue backed by Redis and BullMQ.
 *
 * @remarks
 * Decouples producer from consumer: workers start only when `process()` is explicitly invoked.
 * Provides exponential backoff, cluster-wide concurrency control, and durable job state.
 *
 * @example
 * ```typescript
 * import { BullMQJobQueue } from '@denizsvnc/ai-rag-engine';
 *
 * const queue = new BullMQJobQueue({
 *   redisUrl: process.env.REDIS_URL,
 *   concurrency: 4
 * });
 * await queue.ready();
 * ```
 */
export class BullMQJobQueue<TData = unknown, TResult = unknown> implements IJobQueue<TData, TResult> {
    private readonly queue: Queue;
    private readonly producer: Redis;
    private consumer: Redis | undefined;
    private worker: Worker | undefined;
    private processingType: string | undefined;
    private closed = false;
    private readonly name: string;
    private readonly attempts: number;

    /**
     * Initializes a new BullMQJobQueue instance.
     *
     * @param options - BullMQ and Redis connection options.
     */
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

    /**
     * Waits until the Redis queue connection is fully established and applies concurrency settings.
     */
    public async ready(): Promise<void> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([this.queue.waitUntilReady(), new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Redis queue readiness timed out.')), 5000);
            })]);
            await this.queue.setGlobalConcurrency(this.options.globalConcurrency ?? 4);
        } finally { if (timeout) clearTimeout(timeout); }
    }

    /**
     * Enqueues a job into Redis with exponential backoff and retention settings.
     *
     * @param type - Job type string.
     * @param data - Job payload data.
     * @param jobId - Optional custom job ID.
     * @returns Job descriptor record.
     */
    public async add(type: string, data: TData, jobId?: string): Promise<Job<TData, TResult>> {
        if (this.closed) throw new Error('Queue is closed.');
        const job = await this.queue.add(type, data, {
            ...(jobId ? { jobId } : {}), attempts: this.attempts,
            backoff: { type: 'exponential', delay: this.options.backoffMs ?? 1000 },
            removeOnComplete: { age: 7 * 86400, count: 10000 }, removeOnFail: { age: 7 * 86400, count: 10000 }
        });
        return this.map(job, 'queued');
    }

    /**
     * Retrieves job status and progress from Redis.
     *
     * @param id - Job identifier.
     * @returns Job record or null if not found.
     */
    public async getJob(id: string): Promise<Job<TData, TResult> | null> {
        const job = await this.queue.getJob(id);
        if (!job) return null;
        const state = await job.getState();
        const status = state === 'active' ? 'processing' : state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'queued';
        return this.map(job, status);
    }

    /**
     * Starts worker consumer loop listening for queued jobs.
     *
     * @param type - Job type to subscribe to.
     * @param handler - Worker handler function processing each job.
     */
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

    /**
     * Retries a failed job in Redis, resetting attempts.
     *
     * @param id - Job identifier.
     * @throws If job is not in failed state.
     */
    public async retry(id: string): Promise<void> {
        const job = await this.queue.getJob(id);
        if (!job || await job.getState() !== 'failed') throw new Error('Only a failed job can be retried.');
        await job.retry('failed', { resetAttemptsMade: true });
    }

    /**
     * Drains active jobs, disconnects workers, and closes Redis connections.
     */
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
