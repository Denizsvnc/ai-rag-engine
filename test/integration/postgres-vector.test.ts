import { RAGEngine } from '../../src/core/engine';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { PostgresVectorAdapter } from '../../src/adapters/vector/postgres-vector.adapter';

const exec = promisify(execFile);
const isStrict = process.env.STRICT_ZERO_SKIP === 'true' || process.env.STRICT_ZERO_SKIP === '1';
const embeddings = { async getEmbedding(text: string) { return new Float32Array(/refund|iade|return/.test(text) ? [1, 0, 0] : [0, 1, 0]); } };
test('PostgreSQL vector store persists, upserts atomically and isolates tenant CRUD', { skip: isStrict ? false : !process.env.PG_TEST_URL, timeout: 30_000 }, async t => {
    if (!process.env.PG_TEST_URL) {
        throw new Error('[FAIL-CLOSED] PG_TEST_URL is strictly required when STRICT_ZERO_SKIP is active');
    }
    const tableName = `test_${randomUUID().replaceAll('-', '')}`;
    const connectionString = process.env.PG_TEST_URL;
    const pool = new Pool({ connectionString, max: 5 });
    const options = { pool, tableName, dimensions: 3, modelName: 'test-v1', embeddingProvider: embeddings, createHnswIndex: true };
    const a = new PostgresVectorAdapter(options);
    const b = new PostgresVectorAdapter(options);
    try {
        await Promise.all([a.init(), b.init()]);
        await t.test('same ID belongs independently to each tenant and upsert does not duplicate', async () => {
            await a.addDocuments([
                { id: 'same', content: 'refund policy original', metadata: { tenantId: 'alpha', category: 'policy' } },
                { id: 'same', content: 'refund policy beta', metadata: { tenantId: 'beta', category: 'policy' } }
            ]);
            await a.addDocuments([{ id: 'same', content: 'refund policy updated', metadata: { tenantId: 'alpha', category: 'policy' } }]);
            const alpha = await b.search('refund', 10, { tenantId: 'alpha' });
            assert.equal(alpha.length, 1);
            assert.equal(alpha[0]?.content, 'refund policy updated');
            assert.equal(alpha[0]?.version, 2);
            assert.equal((await b.search('refund', 10, { tenantId: 'beta' }))[0]?.content, 'refund policy beta');
            await a.addDocuments([{ id: 'same', content: 'refund policy updated', metadata: { tenantId: 'alpha', category: 'policy' } }]);
            assert.equal((await b.search('refund', 10, { tenantId: 'alpha' }))[0]?.version, 2);
            assert.equal((await b.search('refund', 10, { tenantId: 'alpha', category: 'missing' })).length, 0);
        });
        await t.test('new independent process reads the persistent index', async () => {
            const script = `
                import { PostgresVectorAdapter } from './src/adapters/vector/postgres-vector.adapter.ts';
                const store = new PostgresVectorAdapter({
                    connectionString: process.env.PG_TEST_URL, tableName: process.env.TEST_VECTOR_TABLE,
                    dimensions: 3, modelName: 'test-v1', autoMigrate: false,
                    embeddingProvider: { async getEmbedding() { return [1,0,0]; } }
                });
                try { console.log(JSON.stringify(await store.search('refund', 3, {tenantId:'alpha'}))); }
                finally { await store.close(); }
            `;
            const result = await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
                env: { ...process.env, TEST_VECTOR_TABLE: tableName }, timeout: 10_000
            });
            const docs = JSON.parse(result.stdout);
            assert.equal(docs[0].content, 'refund policy updated');
            assert.equal(docs[0].metadata.tenantId, 'alpha');
        });
        await t.test('unscoped access, invalid vectors and incompatible models fail closed', async () => {
            await assert.rejects(a.search('refund'), /tenantId/);
            await assert.rejects(a.deleteDocument('same'), /tenantId/);
            await assert.rejects(a.clear(), /tenantId/);
            await assert.rejects(a.addDocuments([{ id: 'x', content: 'refund' }]), /tenantId/);
            await assert.rejects(new PostgresVectorAdapter({ ...options, modelName: 'other', autoMigrate: false }).init(), /mismatch/);
            await assert.rejects(new PostgresVectorAdapter({ ...options, dimensions: 4, autoMigrate: false }).init(), /mismatch/);
            const bad = new PostgresVectorAdapter({ ...options, embeddingProvider: { async getEmbedding() { return [NaN, 0, 1]; } } });
            await assert.rejects(bad.addDocuments([{ id: 'bad', content: 'refund', metadata: { tenantId: 'alpha' } }]), /finite/);
            await assert.rejects(a.search('refund', 0, { tenantId: 'alpha' }), /topK/);
        });
        await t.test('SQL failure rolls back the whole document batch', async () => {
            await assert.rejects(a.addDocuments([
                { id: 'rollback', content: 'refund', metadata: { tenantId: 'alpha' } },
                { id: 'invalid\0id', content: 'refund', metadata: { tenantId: 'alpha' } }
            ]));
            assert.ok(!(await a.search('refund', 10, { tenantId: 'alpha' })).some(doc => doc.id === 'rollback'));
        });
        await t.test('hybrid retrieval applies tenant and metadata boundaries on both paths', async () => {
            const docs = await a.searchHybrid('refund', 10, { tenantId: 'alpha', category: 'policy' });
            assert.equal(docs.length, 1);
            assert.equal(docs[0]?.metadata?.tenantId, 'alpha');
            assert.equal(docs[0]?.content, 'refund policy updated');
        });
        await t.test('engine query uses persistent retrieval without crossing the caller tenant', async () => {
            let prompt = '';
            const engine = new RAGEngine({
                llmProvider: { async generate(request) { prompt = request.systemPrompt; return { content: 'policy answer' }; } },
                inputs: { vectorStore: a }, cache: { enabled: false }, smlConfig: { enabled: false }
            });
            await engine.init();
            const response = await engine.query('refund policy', { tenantId: 'alpha', userId: 'alice', roles: ['user'] });
            assert.deepEqual(response.sources, ['same']);
            assert.ok(prompt.includes('refund policy updated'));
            assert.ok(!prompt.includes('refund policy beta'));
        });
        await t.test('runtime database role works without schema ownership or migration privileges', async () => {
            const role = `runtime_${randomUUID().replaceAll('-', '')}`;
            const password = randomUUID();
            await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
            const url = new URL(connectionString);
            url.username = role; url.password = password;
            url.searchParams.set('user', role); url.searchParams.set('password', password);
            const runtimePool = new Pool({ connectionString: url.toString() });
            try {
                await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
                await pool.query(`GRANT SELECT ON "${tableName}_config" TO "${role}"`);
                await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${tableName}", "${tableName}_epochs" TO "${role}"`);
                assert.equal((await runtimePool.query('SELECT current_user')).rows[0].current_user, role);
                const store = new PostgresVectorAdapter({ ...options, pool: runtimePool, autoMigrate: false });
                await store.init();
                await store.addDocuments([{ id: 'runtime', content: 'refund runtime', metadata: { tenantId: 'alpha' } }]);
                assert.ok((await store.search('refund', 10, { tenantId: 'alpha' })).some(doc => doc.id === 'runtime'));
                await assert.rejects(runtimePool.query(`ALTER TABLE "${tableName}" ADD COLUMN forbidden text`), { code: '42501' });
                assert.equal(await store.deleteDocument('runtime', { tenantId: 'alpha' }), true);
            } finally {
                await runtimePool.end();
                await pool.query(`DROP OWNED BY "${role}"`);
                await pool.query(`DROP ROLE "${role}"`);
            }
        });
        await t.test('IDs and filter values are SQL parameters, not executable SQL', async () => {
            const id = "'; DROP TABLE users; --";
            await a.addDocuments([{ id, content: 'refund', metadata: { tenantId: 'alpha' } }]);
            assert.ok((await b.search('refund', 10, { tenantId: 'alpha' })).some(doc => doc.id === id));
            assert.equal((await b.search('refund', 10, { tenantId: "alpha' OR true --" })).length, 0);
            assert.throws(() => new PostgresVectorAdapter({ ...options, tableName: 'bad; DROP TABLE users' }), /table name/);
        });
        await t.test('tenant deletion and clear preserve the other tenant', async () => {
            assert.equal(await a.deleteDocument('same', { tenantId: 'alpha' }), true);
            assert.equal(await a.deleteDocument('same', { tenantId: 'alpha' }), false);
            assert.equal((await b.search('refund', 10, { tenantId: 'beta' })).length, 1);
            await a.clear({ tenantId: 'alpha' });
            assert.equal((await b.search('refund', 10, { tenantId: 'alpha' })).length, 0);
            assert.equal((await b.search('refund', 10, { tenantId: 'beta' })).length, 1);
        });
    } finally {
        await pool.query(`DROP TABLE IF EXISTS "${tableName}", "${tableName}_config", "${tableName}_epochs", "${tableName}_manifests"`);
        await pool.end();
    }
});
