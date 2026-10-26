import type { IJobQueue } from './job-queue.interface';
import { InMemoryJobQueue } from './in-memory-queue';
import { BullMQJobQueue, type BullMQQueueOptions } from './bullmq-queue';

export interface QueueConfig {
    driver?: 'memory' | 'bullmq' | undefined;
    redisUrl?: string | undefined;
    concurrency?: number | undefined;
    queueName?: string | undefined;
}

/**
 * Creates the appropriate job queue based on configuration.
 * Uses zero-dependency InMemoryJobQueue by default, or BullMQJobQueue when Redis is configured.
 */
export function createJobQueue<TData = any, TResult = any>(config?: QueueConfig): IJobQueue<TData, TResult> {
    if (config?.driver === 'bullmq' || (config?.redisUrl && config?.driver !== 'memory')) {
        return new BullMQJobQueue<TData, TResult>({
            redisUrl: config?.redisUrl,
            queueName: config?.queueName,
            concurrency: config?.concurrency
        });
    }

    return new InMemoryJobQueue<TData, TResult>({
        concurrency: config?.concurrency
    });
}
