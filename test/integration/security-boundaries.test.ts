import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { RAGEngine } from '../../src/core/engine';
import { createApiRoutes } from '../../src/api/routes';
import { createAuthToken } from '../../src/api/auth';
import { createRagMiddleware } from '../../src/api/middleware';
import type { QueryContext } from '../../src/interfaces/query-context.interface';

const secret = 'http-security-test-secret-at-least-32-bytes';
test('HTTP denies forged identity and isolates ingestion status without exposing job payload', async () => {
    const job = { id: 'private-job', type: 'document-ingest', data: { tenantId: 'alpha', userId: 'alice', contentBase64: 'SECRET', tempFilePath: '/private/file' }, status: 'queued', progress: 0, createdAt: 1, updatedAt: 1 };
    const engine = new RAGEngine({
        llmProvider: { async generate() { return { content: 'ok' }; } }, inputs: {},
        ingestion: { jobQueue: { process() {}, async getJob(id: string) { return id === job.id ? job : null; } } }
    });
    let observed: QueryContext | undefined;
    engine.init = async () => {};
    engine.query = async (_query, context) => { observed = context; return { answer: 'ok', intent: 'RAG_QUERY', resolvedBy: 'test', latencyMs: 0 }; };
    const app = express();
    app.use(express.json());
    app.post('/unwired', createRagMiddleware(engine));
    app.use('/api', createApiRoutes(engine, { enforceAuth: true, auth: { jwtSecret: secret } }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = (tenantId: string) => createAuthToken({ tenantId, userId: 'alice', roles: ['editor'] }, secret);
    try {
        assert.equal((await fetch(`${base}/unwired`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-roles': 'admin' }, body: JSON.stringify({ query: 'hello' }) })).status, 401);
        assert.equal((await fetch(`${base}/api/query`, { method: 'POST', headers: { 'x-roles': 'admin' } })).status, 401);
        const res = await fetch(`${base}/api/query`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token('alpha')}`, 'x-tenant-id': 'beta', 'x-roles': 'superadmin', 'x-confirmed-action': 'true' },
            body: JSON.stringify({ query: 'hello', context: { tenantId: 'beta', userId: 'attacker', roles: ['superadmin'], confirmedAction: true, metadata: { trusted: true } } })
        });
        assert.equal(res.status, 200);
        assert.equal(observed?.tenantId, 'alpha');
        assert.equal(observed?.userId, 'alice');
        assert.deepEqual(observed?.roles, ['editor']);
        assert.equal(observed?.confirmedAction, undefined);
        assert.equal(observed?.metadata, undefined);
        for (const tenant of ['beta', 'alpha']) {
            const status = await fetch(`${base}/api/ingest/status/private-job`, { headers: { authorization: `Bearer ${token(tenant)}` } });
            assert.equal(status.status, tenant === 'alpha' ? 200 : 404);
            if (tenant === 'alpha') {
                const body = await status.json() as any;
                assert.equal(body.id, job.id);
                assert.equal(body.data, undefined);
                assert.ok(!JSON.stringify(body).includes('SECRET'));
            }
        }
        assert.equal((await fetch(`${base}/api/ingest/status/unknown`, { headers: { authorization: `Bearer ${token('alpha')}` } })).status, 404);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
