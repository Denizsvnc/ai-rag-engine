import type { IJobQueue } from './job-queue.interface.js';
import { InMemoryJobQueue } from './in-memory-queue.js';
import { BullMQJobQueue, type BullMQQueueOptions } from './bullmq-queue.js';

/**
 * Configuration options for job queue instantiation.
 */
export interface QueueConfig {
    /** Queue driver selection ('memory' or 'bullmq'). @defaultValue 'memory' */
    driver?: 'memory' | 'bullmq' | undefined;
    /** Redis connection URL if using BullMQ. */
    redisUrl?: string | undefined;
    /** Worker concurrency level. @defaultValue 2 */
    concurrency?: number | undefined;
    /** Name of the queue. @defaultValue 'rag-ingestion-queue' */
    queueName?: string | undefined;
}

/**
 * Creates an asynchronous job queue instance matching the provided configuration.
 *
 * @remarks
 * Uses zero-dependency {@link InMemoryJobQueue} by default, or {@link BullMQJobQueue}
 * when `driver: 'bullmq'` or `redisUrl` is provided.
 *
 * @param config - Queue configuration parameters.
 * @returns An instance implementing {@link IJobQueue}.
 *
 * @example
 * ```typescript
 * import { createJobQueue } from '@denizsvnc/ai-rag-engine';
 *
 * const queue = createJobQueue({
 *   driver: 'bullmq',
 *   redisUrl: process.env.REDIS_URL,
 *   concurrency: 4
 * });
 * ```
 */
export function createJobQueue<TData = unknown, TResult = unknown>(config?: QueueConfig): IJobQueue<TData, TResult> {
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
