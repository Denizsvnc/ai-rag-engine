import type { IJobQueue, Job, JobHandler } from './job-queue.interface';

export interface BullMQQueueOptions {
    queueName?: string | undefined;
    redisUrl?: string | undefined;
    connection?: {
        host?: string | undefined;
        port?: number | undefined;
        password?: string | undefined;
    } | undefined;
    concurrency?: number | undefined;
}

/**
 * Enterprise Redis-backed BullMQ adapter.
 * Uses distributed queues for multi-instance production deployments.
 * Falls back with an informative message if bullmq is not installed.
 */
export class BullMQJobQueue<TData = any, TResult = any> implements IJobQueue<TData, TResult> {
    private queue: any = null;
    private worker: any = null;
    private readonly queueName: string;
    private readonly connectionOpts: any;
    private readonly concurrency: number;

    constructor(private options?: BullMQQueueOptions) {
        this.queueName = options?.queueName || 'rag-ingestion-queue';
        this.concurrency = options?.concurrency || 3;
        this.connectionOpts = options?.redisUrl
            ? { url: options.redisUrl }
            : options?.connection || { host: '127.0.0.1', port: 6379 };
    }

    private async getBullMQModule(): Promise<{ Queue: any; Worker: any }> {
        try {
            // Dynamic import ensures zero bundle bloat when Redis/BullMQ is not utilized
            const bullmq = await import('bullmq' as any);
            return bullmq;
        } catch {
            throw new Error(
                "[BullMQJobQueue] Enterprise BullMQ dependencies ('bullmq' and 'ioredis') are not installed. " +
                "Run 'npm install bullmq ioredis' to enable distributed Redis job queues, or use 'InMemoryJobQueue' for zero-dependency local processing."
            );
        }
    }

    public async add(type: string, data: TData, customJobId?: string): Promise<Job<TData, TResult>> {
        const { Queue } = await this.getBullMQModule();
        if (!this.queue) {
            this.queue = new Queue(this.queueName, { connection: this.connectionOpts });
        }

        const bJob = await this.queue.add(type, data, {
            jobId: customJobId,
            removeOnComplete: 1000,
            removeOnFail: 5000
        });

        const now = Date.now();
        return {
            id: bJob.id || String(bJob),
            type,
            data,
            status: 'queued',
            progress: 0,
            createdAt: now,
            updatedAt: now
        };
    }

    public async getJob(id: string): Promise<Job<TData, TResult> | null> {
        const { Queue } = await this.getBullMQModule();
        if (!this.queue) {
            this.queue = new Queue(this.queueName, { connection: this.connectionOpts });
        }

        const bJob = await this.queue.getJob(id);
        if (!bJob) return null;

        const state = await bJob.getState();
        const statusMap: Record<string, Job['status']> = {
            completed: 'completed',
            failed: 'failed',
            active: 'processing',
            delayed: 'queued',
            waiting: 'queued',
            prioritized: 'queued'
        };

        return {
            id: bJob.id,
            type: bJob.name,
            data: bJob.data,
            status: statusMap[state] || 'queued',
            progress: typeof bJob.progress === 'number' ? bJob.progress : 0,
            result: bJob.returnvalue,
            error: bJob.failedReason,
            createdAt: bJob.timestamp,
            updatedAt: bJob.processedOn || bJob.timestamp,
            completedAt: bJob.finishedOn
        };
    }

    public process(type: string, handler: JobHandler<TData, TResult>): void {
        this.getBullMQModule().then(({ Worker }) => {
            if (this.worker) return;

            this.worker = new Worker(
                this.queueName,
                async (bJob: any) => {
                    if (bJob.name !== type) return;

                    const jobWrapper: Job<TData, TResult> = {
                        id: bJob.id,
                        type: bJob.name,
                        data: bJob.data,
                        status: 'processing',
                        progress: typeof bJob.progress === 'number' ? bJob.progress : 0,
                        createdAt: bJob.timestamp,
                        updatedAt: Date.now()
                    };

                    const updateProgress = async (prog: number) => {
                        await bJob.updateProgress(prog);
                    };

                    return await handler(jobWrapper, updateProgress);
                },
                {
                    connection: this.connectionOpts,
                    concurrency: this.concurrency
                }
            );
        });
    }

    public async close(): Promise<void> {
        if (this.worker) {
            await this.worker.close();
            this.worker = null;
        }
        if (this.queue) {
            await this.queue.close();
            this.queue = null;
        }
    }
}
