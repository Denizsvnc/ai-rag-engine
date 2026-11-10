import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PostgresVectorAdapter } from '../../src/adapters/vector/postgres-vector.adapter';
import { PostgresIngestionStore, IngestionConflictError, IngestionQuotaError } from '../../src/core/ingestion/postgres-ingestion-store';
import { QueuedIngestionService, type IngestionReference } from '../../src/core/ingestion/queued-ingestion.service';
import { IngestionWorker } from '../../src/core/ingestion/ingestion-worker';
import { BullMQJobQueue } from '../../src/core/queue/bullmq-queue';
import { createTenantRateLimiter } from '../../src/api/rate-limit';
import express from 'express';
import { once } from 'node:events';

async function until<T>(read: () => Promise<T>, accept: (result: T) => boolean, timeout = 12000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await read(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error('Timed out waiting for ingestion result.');
}

const isStrict = process.env.STRICT_ZERO_SKIP === 'true' || process.env.STRICT_ZERO_SKIP === '1';

test('Durable ingestion: shared blobs, outbox, idempotency, versions, quotas, retries and shutdown', { skip: isStrict ? false : (!process.env.PG_TEST_URL || !process.env.REDIS_TEST_URL), timeout: 60000 }, async t => {
    if (!process.env.PG_TEST_URL || !process.env.REDIS_TEST_URL) {
        throw new Error('[FAIL-CLOSED] PG_TEST_URL and REDIS_TEST_URL are strictly required when STRICT_ZERO_SKIP is active');
    }
    const prefix = `w_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({ connectionString: process.env.PG_TEST_URL, max: 5 });
    const store = new PostgresIngestionStore(pool, prefix);
    const vectors = new PostgresVectorAdapter({ pool, tableName: `${prefix}v`, modelName: 'test', dimensions: 3,
        embeddingProvider: { async getEmbedding() { return [1, 0, 0]; } } });
    const options = { redisUrl: process.env.REDIS_TEST_URL, queueName: prefix, attempts: 3, backoffMs: 20, concurrency: 2, globalConcurrency: 2 };
    const queue = new BullMQJobQueue<IngestionReference>(options);
    const service = new QueuedIngestionService(store, queue, { chunkSize: 64, chunkOverlap: 8, maxPendingPerTenant: 2, maxUploadBytes: 20000 });
    let failures = 0;
    let inject: 'none' | 'twice' | 'always' | 'post-commit' = 'none';
    let active = 0, peak = 0;
    const processor = { async replaceDocument(...args: Parameters<PostgresVectorAdapter['replaceDocument']>) {
        active++; peak = Math.max(peak, active);
        try {
        await new Promise(resolve => setTimeout(resolve, 40));
        if (inject === 'always' || inject === 'twice' && failures++ < 2) throw new Error('Injected transient failure');
        const result = await vectors.replaceDocument(...args);
        if (inject === 'post-commit' && failures++ === 0) throw new Error('Injected acknowledgement loss');
        return result;
        } finally { active--; }
    } };
    const worker = new IngestionWorker(service, processor, { pollMs: 50 });
    const upload = (content: string, extra = {}) => ({ filename: 'policy.txt', documentId: 'policy', tenantId: 'alpha', userId: 'alice', content, ...extra });
    const wait = (id: string) => until(() => service.getJobStatus(id, 'alpha'), job => job?.status === 'completed' || job?.status === 'failed');
    try {
        await store.migrate(); await vectors.init(); await queue.ready();
        await t.test('upload is persisted before a worker exists, quota is atomic and duplicate submission reuses a job', async () => {
            const first = await service.submitDocument(upload('Refund window is fourteen days. TC: 10000000146.', { idempotencyKey: 'request-1' }));
            const duplicate = await service.submitDocument(upload('Refund window is fourteen days. TC: 10000000146.', { idempotencyKey: 'request-1' }));
            assert.equal(first.jobId, duplicate.jobId);
            assert.ok((await store.get(first.jobId, 'alpha'))?.content);
            assert.equal(await service.getJobStatus(first.jobId, 'beta'), null);
            await assert.rejects(service.submitDocument(upload('different', { idempotencyKey: 'request-1' })), IngestionConflictError);
            await service.submitDocument(upload('Another queued document', { documentId: 'second' }));
            await assert.rejects(service.submitDocument(upload('Third queued document', { documentId: 'third' })), IngestionQuotaError);
            await worker.start();
            assert.equal((await wait(first.jobId))?.status, 'completed');
            assert.equal((await store.get(first.jobId, 'alpha'))?.content, null);
            const docs = await vectors.search('refund', 20, { tenantId: 'alpha', documentId: 'policy' });
            assert.ok(!docs.some(doc => doc.content.includes('10000000146')));
            assert.ok(docs.some(doc => doc.content.includes('TCKN')));
        });
        await t.test('updating to fewer chunks removes stale chunks and returning to old content creates a new revision', async () => {
            await until(() => store.dispatchable(), rows => rows.length === 0);
            const before = await vectors.getRevision('alpha');
            const next = await service.submitDocument(upload('Short revised policy.'));
            assert.equal((await wait(next.jobId))?.status, 'completed');
            const docs = await vectors.search('policy', 20, { tenantId: 'alpha', documentId: 'policy' });
            assert.equal(docs.length, 1);
            assert.equal(docs[0]?.content, 'Short revised policy.');
            assert.notEqual(await vectors.getRevision('alpha'), before);
            const reverted = await service.submitDocument(upload('Refund window is fourteen days. TC: 10000000146.'));
            assert.notEqual(reverted.jobId, next.jobId);
            assert.equal((await wait(reverted.jobId))?.status, 'completed');
            assert.equal((await store.get(reverted.jobId, 'alpha'))?.version, 3);
        });
        await t.test('retry after a committed write neither duplicates chunks nor increments the data revision twice', async () => {
            failures = 0; inject = 'post-commit';
            const revision = BigInt(await vectors.getRevision('alpha'));
            const job = await service.submitDocument(upload('Acknowledge recovery policy.', { documentId: 'ack' }));
            assert.equal((await wait(job.jobId))?.status, 'completed');
            assert.equal(failures, 2);
            assert.equal(BigInt(await vectors.getRevision('alpha')), revision + 1n);
            assert.equal((await vectors.search('policy', 20, { tenantId: 'alpha', documentId: 'ack' })).length, 1);
            inject = 'none';
        });
        await t.test('transient errors retry with backoff; exhausted work is retained and tenant-scoped manual retry works', async () => {
            inject = 'twice'; failures = 0;
            const job = await service.submitDocument(upload('Transient recovery policy.', { documentId: 'transient' }));
            assert.equal((await wait(job.jobId))?.status, 'completed');
            assert.equal(failures, 3);
            inject = 'always';
            const failed = await service.submitDocument(upload('Failure recovery policy.', { documentId: 'failure' }));
            assert.equal((await wait(failed.jobId))?.status, 'failed');
            assert.ok((await store.get(failed.jobId, 'alpha'))?.content);
            await assert.rejects(service.retryJob(failed.jobId, 'beta'));
            inject = 'none';
            await service.retryJob(failed.jobId, 'alpha');
            assert.equal((await wait(failed.jobId))?.status, 'completed');
        });
        await t.test('older versions cannot overwrite newer documents', async () => {
            const doc = (version: number, content: string) => [{ id: 'one', content, metadata: { tenantId: 'alpha', documentId: 'ordered', documentVersion: version } }];
            assert.equal(await vectors.replaceDocument('ordered', 'alpha', 2, doc(2, 'new')), 'applied');
            assert.equal(await vectors.replaceDocument('ordered', 'alpha', 1, doc(1, 'old')), 'superseded');
            assert.equal(await vectors.replaceDocument('ordered', 'alpha', 2, doc(2, 'new')), 'unchanged');
            assert.equal((await vectors.search('policy', 3, { tenantId: 'alpha', documentId: 'ordered' }))[0]?.content, 'new');
        });
        await t.test('a committed upload survives dispatch failure and the worker recovers its outbox', async () => {
            const disconnected = new QueuedIngestionService(store, {
                add: queue.add.bind(queue), process: queue.process.bind(queue), ready: queue.ready.bind(queue), retry: queue.retry.bind(queue), close: queue.close.bind(queue),
                async getJob() { throw new Error('Injected Redis outage after blob commit'); }
            });
            const submitted = await disconnected.submitDocument(upload('Outbox recovery policy.', { documentId: 'outbox' }));
            assert.ok(await store.get(submitted.jobId, 'alpha'));
            assert.equal((await wait(submitted.jobId))?.status, 'completed');
        });
        await t.test('multiple workers obey shared global concurrency', async () => {
            const secondQueue = new BullMQJobQueue<IngestionReference>(options);
            const secondService = new QueuedIngestionService(store, secondQueue, { maxPendingPerTenant: 10 });
            const secondWorker = new IngestionWorker(secondService, processor, { pollMs: 50 });
            peak = 0;
            try {
                await secondWorker.start();
                const jobs = await Promise.all(Array.from({ length: 5 }, (_, index) => secondService.submitDocument(upload('Concurrent policy.', { documentId: `parallel-${index}` }))));
                for (const job of jobs) assert.equal((await wait(job.jobId))?.status, 'completed');
                assert.ok(peak >= 1 && peak <= 2, `Global concurrency exceeded: ${peak}`);
            } finally { await secondWorker.close(); }
        });
        await t.test('streamed uploads use shared blobs, unsafe files and oversized inputs are rejected', async () => {
            const stream = await service.submitDocument({ ...upload(''), content: Readable.from(['shared ', 'stream policy']), documentId: 'stream' });
            assert.equal((await wait(stream.jobId))?.status, 'completed');
            await assert.rejects(service.submitDocument(upload('MZ dangerous', { filename: 'bad.exe' })));
            await assert.rejects(service.submitDocument(upload('x'.repeat(20001))), IngestionQuotaError);
        });
        await t.test('graceful shutdown drains an active job', async () => {
            const job = await service.submitDocument(upload('Shutdown drain policy.', { documentId: 'shutdown' }));
            await until(() => store.get(job.jobId, 'alpha'), row => row?.status === 'processing');
            await worker.close();
            assert.equal((await store.get(job.jobId, 'alpha'))?.status, 'completed');
        });
    } finally {
        await worker.close();
        const redis = new Redis(process.env.REDIS_TEST_URL!); redis.on('error', () => {});
        try { const keys = await redis.keys(`bull:${prefix}:*`); if (keys.length) await redis.del(...keys); } finally { redis.disconnect(); }
        await pool.query(`DROP TABLE IF EXISTS "${prefix}", "${prefix}_heads", "${prefix}v", "${prefix}v_config", "${prefix}v_epochs", "${prefix}v_manifests"`);
        await pool.end();
    }
});

test('Redis rate limiting is shared across API instances and tenant-isolated', { skip: isStrict ? false : !process.env.REDIS_TEST_URL, timeout: 15000 }, async () => {
    if (!process.env.REDIS_TEST_URL) {
        throw new Error('[FAIL-CLOSED] REDIS_TEST_URL is strictly required when STRICT_ZERO_SKIP is active');
    }
    const client = new Redis(process.env.REDIS_TEST_URL); client.on('error', () => {}); await client.ping();
    const prefix = `test:rate:${randomUUID()}:`;
    const apps = [express(), express()];
    const servers = apps.map(app => {
        app.use((req, _res, next) => { req.auth = { tenantId: String(req.headers['x-test-tenant'] || 'alpha'), userId: 'test', roles: [] }; next(); });
        app.use(createTenantRateLimiter(client, { limit: 2, windowMs: 200, prefix }));
        app.get('/', (_req, res) => res.json({ ok: true }));
        return app.listen(0, '127.0.0.1');
    });
    try {
        await Promise.all(servers.map(server => once(server, 'listening')));
        const urls = servers.map(server => `http://127.0.0.1:${(server.address() as any).port}`);
        assert.equal((await fetch(urls[0]!)).status, 200);
        assert.equal((await fetch(urls[1]!)).status, 200);
        const denied = await fetch(urls[0]!); assert.equal(denied.status, 429); assert.ok(denied.headers.get('retry-after'));
        assert.equal((await fetch(urls[1]!, { headers: { 'x-test-tenant': 'beta' } })).status, 200);
        await new Promise(resolve => setTimeout(resolve, 210));
        assert.equal((await fetch(urls[0]!)).status, 200);
    } finally {
        await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
        const keys = await client.keys(`${prefix}*`); if (keys.length) await client.del(...keys); client.disconnect();
    }
});
