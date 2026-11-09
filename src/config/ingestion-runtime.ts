import { Pool } from 'pg';
import { PostgresVectorAdapter } from '../adapters/vector/postgres-vector.adapter.js';
import { BullMQJobQueue } from '../core/queue/bullmq-queue.js';
import { PostgresIngestionStore } from '../core/ingestion/postgres-ingestion-store.js';
import { QueuedIngestionService, type IngestionReference } from '../core/ingestion/queued-ingestion.service.js';
import { IngestionWorker } from '../core/ingestion/ingestion-worker.js';

export function positiveEnv(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    return value;
}

/** API and worker share configuration, never a process-local model/vector store. */
export async function createIngestionRuntime(vectors: PostgresVectorAdapter) {
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('Durable ingestion requires DATABASE_URL and REDIS_URL.');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    pool.on('error', error => console.error('[Ingestion DB]', error.message));
    const store = new PostgresIngestionStore(pool, process.env.INGESTION_TABLE_NAME);
    const queue = new BullMQJobQueue<IngestionReference>({
        redisUrl: process.env.REDIS_URL, queueName: process.env.INGESTION_QUEUE_NAME,
        concurrency: positiveEnv('INGESTION_CONCURRENCY', 2), globalConcurrency: positiveEnv('INGESTION_GLOBAL_CONCURRENCY', 4),
        attempts: positiveEnv('INGESTION_ATTEMPTS', 3),
        lockDurationMs: positiveEnv('INGESTION_LOCK_DURATION_MS', 30000), stalledIntervalMs: positiveEnv('INGESTION_STALLED_INTERVAL_MS', 30000), onError: error => console.error('[Ingestion Redis]', error.message)
    });
    try {
        await store.ready(); await queue.ready();
        const backend = new QueuedIngestionService(store, queue, {
            maxUploadBytes: positiveEnv('INGESTION_MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
            maxPendingPerTenant: positiveEnv('INGESTION_MAX_PENDING_PER_TENANT', 100),
            maxStoredBytesPerTenant: positiveEnv('INGESTION_MAX_STORED_BYTES_PER_TENANT', 50 * 1024 * 1024)
        });
        const worker = new IngestionWorker(backend, vectors, { onError: error => console.error('[Ingestion outbox]', error instanceof Error ? error.message : error) });
        let closed = false;
        return { backend, worker, async close() { if (closed) return; closed = true; await worker.close(); await pool.end(); } };
    } catch (error) { await queue.close(); await pool.end(); throw error; }
}

export function persistentVectorsFromEnv(): PostgresVectorAdapter {
    return new PostgresVectorAdapter({
        connectionString: process.env.DATABASE_URL, tableName: process.env.VECTOR_TABLE_NAME,
        modelName: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
        dimensions: positiveEnv('EMBEDDING_DIMENSIONS', 384), autoMigrate: process.env.VECTOR_AUTO_MIGRATE === 'true'
    });
}
