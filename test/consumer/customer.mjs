import assert from 'node:assert/strict';
import express from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { pipeline } from '@huggingface/transformers';
import { createAuthToken, RAGEngine, SMLEngine, LocalFaqAdapter } from '@denizsvnc/ai-rag-engine';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
const steps = [];
const children = [];
const prefix = `c_${randomUUID().replaceAll('-', '')}`;
const vectors = `${prefix}v`;
const ingestion = `${prefix}i`;
const queueName = `${prefix}q`;
const secret = randomBytes(32).toString('hex');
const pool = new Pool({ connectionString: process.env.PG_TEST_URL });
const redis = new Redis(process.env.REDIS_TEST_URL);
redis.on('error', () => {});
const wait = async (check, label, timeout = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`Timed out: ${label}`);
};
const pass = label => { steps.push(label); console.log(`PASS ${label}`); };
const stop = async (child, signal = 'SIGTERM') => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill(signal);
    await Promise.race([once(child, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('Child shutdown timeout')), 12000))]);
};
let api, worker, providerServer;
const common = {
    ...process.env, NODE_ENV: 'production', JWT_SECRET: secret, CONFIRMATION_SECRET: randomBytes(32).toString('hex'),
    DATABASE_URL: process.env.PG_TEST_URL, REDIS_URL: process.env.REDIS_TEST_URL,
    VECTOR_STORE: 'postgres', VECTOR_TABLE_NAME: vectors, INGESTION_TABLE_NAME: ingestion, INGESTION_QUEUE_NAME: queueName,
    RUNTIME_DB_USER: `${prefix}r`, RUNTIME_DB_PASSWORD: randomBytes(32).toString('hex'),
    CACHE_KEY_PREFIX: `${prefix}:cache:`, API_RATE_KEY_PREFIX: `${prefix}:rate:`,
    VECTOR_AUTO_MIGRATE: 'false', INGESTION_QUEUE: 'bullmq', ALLOW_ANONYMOUS_DEV_AUTH: 'false',
    INGESTION_CONCURRENCY: '1', INGESTION_GLOBAL_CONCURRENCY: '1',
    INGESTION_LOCK_DURATION_MS: '1200', INGESTION_STALLED_INTERVAL_MS: '1000', API_RATE_LIMIT: '1000',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', OLLAMA_HOST: '', PRIVATE_LLM_API_KEY: '', PRIVATE_LLM_HEADERS: '{}', ALLOW_PUBLIC_OPENSOURCE_LLM: 'false',
    HOST: '127.0.0.1', LLM_TIMEOUT_MS: '60000', SHUTDOWN_TIMEOUT_MS: '10000'
};
const token = tenantId => createAuthToken({ userId: 'customer', tenantId, roles: ['editor', 'admin'] }, secret);
const headers = tenantId => ({ authorization: `Bearer ${token(tenantId)}`, 'content-type': 'application/json' });
const run = (entry, extra = {}) => {
    const child = spawn(process.execPath, [path.join('node_modules/@denizsvnc/ai-rag-engine/dist', entry)], { env: { ...common, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.logs = ''; child.stdout.on('data', data => { child.logs += data; }); child.stderr.on('data', data => { child.logs += data; });
    children.push(child); return child;
};
try {
    // The provider is a real local language model. Fixtures contain no customer data or secrets.
    console.log('Loading local flan-t5-small (q8) for a real generation check...');
    const generator = await pipeline('text2text-generation', 'Xenova/flan-t5-small', { dtype: 'q8', cache_dir: process.env.CONSUMER_GENERATION_MODEL_CACHE_DIR || process.env.RAG_MODEL_CACHE_DIR });
    const provider = express(); provider.use(express.json());
    provider.post('/v1/chat/completions', async (req, res) => {
        const source = req.body.messages.find(message => message.role === 'system')?.content || '';
        const question = req.body.messages.findLast(message => message.role === 'user')?.content || '';
        const docs = [...source.matchAll(/<document[^>]*>\n([\s\S]*?)\n<\/document>/g)].map(match => match[1]).join('\n');
        try {
            const generated = await generator(`question: ${question.replace(/<[^>]+>/g, '')} context: ${docs}`, { max_new_tokens: 32, do_sample: false });
            res.json({ choices: [{ message: { role: 'assistant', content: generated[0].generated_text } }] });
        } catch (error) { res.status(500).json({ error: String(error) }); }
    });
    providerServer = provider.listen(0, '127.0.0.1'); await once(providerServer, 'listening');
    common.PRIVATE_LLM_ENDPOINT = `http://127.0.0.1:${providerServer.address().port}/v1/chat/completions`;
    common.PRIVATE_LLM_MODEL_FAST = 'flan-t5-small'; common.PRIVATE_LLM_MODEL_SMART = 'flan-t5-small';
    await writeFile('empty-faq.json', '[]');
    common.FAQ_FILE_PATH = path.resolve('empty-faq.json');
    const metadata = JSON.parse(await readFile('node_modules/@denizsvnc/ai-rag-engine/package.json', 'utf8'));
    assert.equal(metadata.bin['ai-rag-worker'], 'dist/worker.js');
    const migration = await exec(process.execPath, ['node_modules/@denizsvnc/ai-rag-engine/dist/scripts/migrate-vector.js'], { env: common });
    assert.match(migration.stdout, /schemas initialized/); pass('installed migration CLI');
    const runtimeUrl = new URL(process.env.PG_TEST_URL);
    runtimeUrl.searchParams.set('user', common.RUNTIME_DB_USER); runtimeUrl.searchParams.set('password', common.RUNTIME_DB_PASSWORD);
    common.DATABASE_URL = runtimeUrl.toString();
    pass('separate migration and runtime credentials');
    const probe = express().listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    api = run('api/server.js', { PORT: String(port) });
    await wait(() => api.logs.includes('[RAG API] Ready') || api.exitCode !== null && Promise.reject(new Error(api.logs)), 'API ready');
    const base = `http://127.0.0.1:${port}/api`;
    const request = (route, tenant = 'alpha', body, extras = {}) => fetch(base + route, {
        method: body === undefined ? 'GET' : 'POST', headers: { ...headers(tenant), ...extras }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'hello' }) })).status, 401);
    pass('public health and authentication rejection');
    const upload = { filename: 'consumer.txt', documentId: 'policy', content: 'The customer refund period is 14 days. Support is available every weekday.' };
    const first = await request('/ingest', 'alpha', upload, { 'idempotency-key': 'first-upload' }); assert.equal(first.status, 202);
    const job = await first.json();
    assert.equal((await request(`/ingest/status/${job.jobId}`, 'beta')).status, 404);
    const duplicate = await request('/ingest', 'alpha', upload, { 'idempotency-key': 'first-upload' }); assert.equal((await duplicate.json()).jobId, job.jobId);
    assert.equal((await request('/ingest', 'alpha', { ...upload, content: 'different' }, { 'idempotency-key': 'first-upload' })).status, 409);
    pass('upload before worker, idempotency conflict and cross-tenant status rejection');
    worker = run('worker.js'); await wait(() => worker.logs.includes('[IngestionWorker] Ready'), 'worker ready');
    await wait(async () => (await (await request(`/ingest/status/${job.jobId}`)).json()).status === 'completed', 'ingestion completed', 60000);
    const status = await (await request(`/ingest/status/${job.jobId}`)).json(); assert.equal(status.data, undefined); assert.equal(status.result.documentId, 'policy');
    const generated = await request('/query', 'alpha', { query: 'How many days is the refund period?' }); assert.equal(generated.status, 200);
    const answer = await generated.json();
    assert.notEqual(answer.resolvedBy, 'CACHE');
    assert.match(answer.answer.toLowerCase(), /14|fourteen/); assert.ok(answer.sources?.length);
    pass('real embedding -> BullMQ worker -> pgvector -> real local LLM answer');
    const cached = await (await request('/query', 'alpha', { query: 'How many days is the refund period?' })).json(); assert.equal(cached.resolvedBy, 'CACHE');
    pass('query cache hit');
    const replacement = await (await request('/ingest', 'alpha', { ...upload, content: 'The customer refund period is now 30 days.' })).json();
    await wait(async () => (await (await request(`/ingest/status/${replacement.jobId}`)).json()).status === 'completed', 'replacement');
    const updated = await (await request('/query', 'alpha', { query: 'How many days is the refund period?' })).json();
    assert.notEqual(updated.resolvedBy, 'CACHE'); assert.match(updated.answer.toLowerCase(), /30|thirty/);
    pass('document replacement invalidates old query cache via data revision');
    await stop(worker); worker = undefined;
    const recovery = await (await request('/ingest', 'alpha', { ...upload, documentId: 'recovery', content: 'Crash recovery documentation. '.repeat(3000) })).json();
    worker = run('worker.js'); await wait(async () => (await (await request(`/ingest/status/${recovery.jobId}`)).json()).status === 'processing', 'active job before crash');
    await stop(worker, 'SIGKILL'); worker = run('worker.js');
    await wait(async () => (await (await request(`/ingest/status/${recovery.jobId}`)).json()).status === 'completed', 'stalled job recovered', 60000);
    const rows = await pool.query(`SELECT id FROM "${vectors}" WHERE tenant_id='alpha' AND metadata->>'documentId'='recovery'`);
    assert.equal(new Set(rows.rows.map(row => row.id)).size, rows.rows.length);
    pass('worker SIGKILL mid-job and restart without duplicate chunks');
    assert.equal((await request('/ingest', 'alpha', { filename: 'bad.exe', content: 'MZ malware' })).status, 400);
    pass('unsafe upload rejection');
    await stop(api); api = run('api/server.js', { PORT: String(port) }); await wait(() => api.logs.includes('[RAG API] Ready'), 'API restart');
    assert.equal((await (await request(`/ingest/status/${replacement.jobId}`)).json()).status, 'completed');
    pass('API restart preserves shared job status');
    const sml = new SMLEngine(); const faq = new LocalFaqAdapter({ smlEngine: sml });
    await faq.setFaqs([{ question: 'What is the support email?', answer: 'support@example.test' }]);
    const sdk = new RAGEngine({ inputs: { faq }, llmProvider: { async generate() { throw new Error('FAQ should not call an LLM'); } }, cache: { enabled: false } });
    assert.equal((await sdk.query('What is the support email?')).intent, 'FAQ');
    pass('public SDK FAQ path with real embeddings');
    await writeFile('verification.json', JSON.stringify({ success: true, generation: 'real local Xenova/flan-t5-small q8', embedding: 'real local MiniLM', project: process.cwd(), steps }, null, 2));
} catch (error) {
    await writeFile('failure.log', children.map(child => child.logs).join('\n'));
    throw error;
} finally {
    for (const child of children) await stop(child).catch(() => child.kill('SIGKILL'));
    if (providerServer) await new Promise(resolve => providerServer.close(resolve));
    const keys = [...await redis.keys(`bull:${queueName}:*`), ...await redis.keys(`${prefix}:*`)]; if (keys.length) await redis.del(...keys); redis.disconnect();
    await pool.query(`DROP TABLE IF EXISTS "${vectors}", "${vectors}_config", "${vectors}_epochs", "${vectors}_manifests", "${ingestion}", "${ingestion}_heads"`);
    if ((await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [common.RUNTIME_DB_USER])).rowCount) {
        await pool.query(`DROP OWNED BY "${common.RUNTIME_DB_USER}"`); await pool.query(`DROP ROLE "${common.RUNTIME_DB_USER}"`);
    }
    await pool.end();
}
