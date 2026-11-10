import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteVectorAdapter } from '../../../src/adapters/vector/sqlite-vector.adapter.js';
import { SqliteDocumentAdapter } from '../../../src/adapters/document/sqlite-document.adapter.js';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter.js';
import { MemoryIngestionStore } from '../../../src/core/ingestion/memory-ingestion-store.js';
import { MemoryBlobStore } from '../../../src/adapters/blob/memory-blob.adapter.js';
import { LocalFsBlobStore } from '../../../src/adapters/blob/local-fs-blob.adapter.js';

describe('Storage Adapter Reusable Contract Suite', () => {
    describe('SqliteVectorAdapter Behavioral Contract', () => {
        it('persists vectors and retrieves results accurately with multi-tenant isolation', async () => {
            const dbPath = path.resolve(process.cwd(), 'test-temp-vectors.sqlite');
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

            const store = new SqliteVectorAdapter({ filePath: dbPath });
            await store.init();

            // Insert documents for tenant_alpha and tenant_beta
            await store.addDocuments([
                {
                    id: 'doc_alpha_1',
                    content: 'Alpha corp policy specifies 14 business days refund policy.',
                    metadata: { tenantId: 'tenant_alpha', category: 'policy' }
                },
                {
                    id: 'doc_beta_1',
                    content: 'Beta corp policy specifies 60 business days refund policy.',
                    metadata: { tenantId: 'tenant_beta', category: 'policy' }
                }
            ]);

            // Query as tenant_alpha
            const alphaResults = await store.search('refund policy duration', 5, { tenantId: 'tenant_alpha' });
            assert.equal(alphaResults.length, 1);
            assert.equal(alphaResults[0]!.id, 'doc_alpha_1');
            assert.ok(!alphaResults.some(d => d.id === 'doc_beta_1'), 'Must NEVER leak tenant_beta documents to tenant_alpha');

            // Query as tenant_beta
            const betaResults = await store.search('refund policy duration', 5, { tenantId: 'tenant_beta' });
            assert.equal(betaResults.length, 1);
            assert.equal(betaResults[0]!.id, 'doc_beta_1');

            // Close adapter and reopen to test true disk persistence
            await store.close();

            const storeReopened = new SqliteVectorAdapter({ filePath: dbPath });
            await storeReopened.init();

            const persistedResults = await storeReopened.search('refund policy duration', 5, { tenantId: 'tenant_alpha' });
            assert.equal(persistedResults.length, 1);
            assert.equal(persistedResults[0]!.id, 'doc_alpha_1');

            await storeReopened.close();
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        });

        it('executes atomic document replacement and rejects superseded versions', async () => {
            const store = new SqliteVectorAdapter({ filePath: ':memory:' });
            await store.init();

            // 1. Initial version 1 replacement
            const r1 = await store.replaceDocument('contract_42', 'tenant_x', 1, [
                { id: 'chunk_v1_1', content: 'Clause 1: initial terms', metadata: {} },
                { id: 'chunk_v1_2', content: 'Clause 2: initial liabilities', metadata: {} }
            ]);
            assert.equal(r1, 'applied');

            const searchV1 = await store.search('initial terms', 5, { tenantId: 'tenant_x' });
            assert.equal(searchV1.length, 2);

            // 2. Version 2 update replaces version 1 atomically
            const r2 = await store.replaceDocument('contract_42', 'tenant_x', 2, [
                { id: 'chunk_v2_1', content: 'Clause 1: amended updated terms', metadata: {} }
            ]);
            assert.equal(r2, 'applied');

            const searchV2 = await store.search('amended updated terms', 5, { tenantId: 'tenant_x' });
            assert.equal(searchV2.length, 1);
            assert.equal(searchV2[0]!.id, 'chunk_v2_1');

            // 3. Stale version 1 attempt is rejected as superseded
            const rStale = await store.replaceDocument('contract_42', 'tenant_x', 1, [
                { id: 'chunk_v1_stale', content: 'Stale retry terms', metadata: {} }
            ]);
            assert.equal(rStale, 'superseded');

            await store.close();
        });
    });

    describe('MemoryVectorAdapter Behavioral Contract', () => {
        it('supports atomic document replacement and revision invalidation in memory', async () => {
            const store = new MemoryVectorAdapter();

            const r1 = await store.replaceDocument('doc_hr_1', 'tenant_y', 1, [
                { id: 'c1', content: 'HR employee handbook vacation policy is 20 days.', metadata: {} }
            ]);
            assert.equal(r1, 'applied');

            const rev1 = await store.getRevision('tenant_y');

            const r2 = await store.replaceDocument('doc_hr_1', 'tenant_y', 2, [
                { id: 'c2', content: 'HR employee handbook vacation policy amended to 25 days.', metadata: {} }
            ]);
            assert.equal(r2, 'applied');

            const rev2 = await store.getRevision('tenant_y');
            assert.notEqual(rev1, rev2, 'Revision counter must increment upon document replacement');

            // Out-of-order stale update is superseded
            const rStale = await store.replaceDocument('doc_hr_1', 'tenant_y', 1, [
                { id: 'c_stale', content: 'Stale attempt', metadata: {} }
            ]);
            assert.equal(rStale, 'superseded');
        });
    });

    describe('SqliteDocumentAdapter Behavioral Contract', () => {
        it('enforces multi-tenant isolation across document CRUD operations', async () => {
            const store = new SqliteDocumentAdapter({ filePath: ':memory:' });
            await store.init();

            await store.putDocument({
                id: 'terms_v1',
                tenantId: 'tenant_1',
                content: 'Terms of service for tenant 1',
                metadata: { category: 'legal' }
            });

            await store.putDocument({
                id: 'terms_v1', // Same document ID under different tenant
                tenantId: 'tenant_2',
                content: 'Terms of service for tenant 2',
                metadata: { category: 'legal' }
            });

            // Tenant 1 reads only tenant 1 document
            const doc1 = await store.getDocument('terms_v1', 'tenant_1');
            assert.ok(doc1);
            assert.equal(doc1.content, 'Terms of service for tenant 1');

            // Tenant 2 reads only tenant 2 document
            const doc2 = await store.getDocument('terms_v1', 'tenant_2');
            assert.ok(doc2);
            assert.equal(doc2.content, 'Terms of service for tenant 2');

            // Tenant 1 cannot delete Tenant 2 document
            await store.deleteDocument('terms_v1', 'tenant_1');
            const doc1After = await store.getDocument('terms_v1', 'tenant_1');
            assert.equal(doc1After, null);

            const doc2After = await store.getDocument('terms_v1', 'tenant_2');
            assert.ok(doc2After, 'Tenant 2 document must remain untouched');

            await store.close();
        });
    });

    describe('MemoryIngestionStore Behavioral Contract', () => {
        it('handles idempotency, tenant quota enforcement, and state transitions in memory', async () => {
            const store = new MemoryIngestionStore();

            const fileContent = Buffer.from('Corporate confidential data buffer');

            // 1. Initial put
            const upload1 = await store.put({
                tenantId: 'acme',
                userId: 'user_1',
                documentId: 'doc_report',
                filename: 'report.txt',
                content: fileContent,
                settings: { chunkSize: 200, chunkOverlap: 20 },
                idempotencyKey: 'idemp_key_001'
            }, { maxPending: 5, maxStoredBytes: 10000 });

            assert.equal(upload1.status, 'pending');
            assert.equal(upload1.version, 1);

            // 2. Duplicate put with same idempotency key and content returns identical upload
            const uploadDup = await store.put({
                tenantId: 'acme',
                userId: 'user_1',
                documentId: 'doc_report',
                filename: 'report.txt',
                content: fileContent,
                settings: { chunkSize: 200, chunkOverlap: 20 },
                idempotencyKey: 'idemp_key_001'
            }, { maxPending: 5, maxStoredBytes: 10000 });

            assert.equal(uploadDup.id, upload1.id);

            // 3. Status state transitions
            await store.mark(upload1.id, 'processing');
            const inProc = await store.get(upload1.id, 'acme');
            assert.equal(inProc?.status, 'processing');

            await store.complete(upload1.id, { chunksIndexed: 2 });
            const completed = await store.get(upload1.id, 'acme');
            assert.equal(completed?.status, 'completed');
            assert.equal(completed?.content, null, 'Raw blob must be released from memory on completion');
        });
    });

    describe('BlobStore Behavioral Contract & Path Traversal Prevention', () => {
        it('MemoryBlobStore isolates stored buffers per tenant', async () => {
            const blob = new MemoryBlobStore();
            await blob.put('data/secret.txt', Buffer.from('alpha secret'), 'tenant_alpha');

            const retrievedAlpha = await blob.get('data/secret.txt', 'tenant_alpha');
            assert.equal(retrievedAlpha?.toString(), 'alpha secret');

            const retrievedBeta = await blob.get('data/secret.txt', 'tenant_beta');
            assert.equal(retrievedBeta, null, 'tenant_beta must never access tenant_alpha blob');
        });

        it('LocalFsBlobStore strictly prevents path traversal attacks', async () => {
            const testDir = path.resolve(process.cwd(), 'test-temp-blobs');
            const blob = new LocalFsBlobStore({ baseDir: testDir });

            // Legal put
            await blob.put('legal/file.txt', Buffer.from('content'), 'tenant_safe');
            const exists = await blob.exists('legal/file.txt', 'tenant_safe');
            assert.equal(exists, true);

            // Illegal directory traversal attack
            await assert.rejects(
                () => blob.put('../../../../../etc/passwd', Buffer.from('pawned'), 'tenant_safe'),
                /Path traversal detected/
            );

            // Teardown
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        });
    });
});

