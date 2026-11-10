import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentIngestionService } from '../../../src/services/document-ingestion.service.js';
import { dotProduct } from '../../../src/utils/math.js';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter.js';
import { BM25Index } from '../../../src/core/vector/bm25.js';

describe('Logical Verification: Property-Based & Metamorphic Invariants', () => {
    describe('Property-Based Testing', () => {
        it('Property 1: Document chunking always makes forward progress and stays within bounded sizes', () => {
            const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 çğıöşü\n\t.';
            const pseudoRandom = (seed: number) => {
                let s = seed;
                return () => {
                    s = (s * 9301 + 49297) % 233280;
                    return s / 233280;
                };
            };
            const rand = pseudoRandom(42);

            for (let trial = 0; trial < 100; trial++) {
                // Generate random text length 10 to 3000
                const textLen = Math.floor(rand() * 2990) + 10;
                let text = '';
                for (let i = 0; i < textLen; i++) {
                    text += alphabet[Math.floor(rand() * alphabet.length)];
                }

                const chunkSize = Math.floor(rand() * 200) + 50; // 50 to 250
                const overlap = Math.floor(rand() * (chunkSize - 10)) + 5; // 5 to chunkSize - 5

                const chunks = DocumentIngestionService.chunkText(text, chunkSize, overlap);

                assert.ok(chunks.length > 0, `Trial ${trial}: Chunks array must not be empty`);

                for (let c = 0; c < chunks.length; c++) {
                    const chunk = chunks[c]!;
                    assert.ok(chunk.length > 0, `Trial ${trial}, chunk ${c}: Must not produce empty chunk string`);
                    // Forward progress & bounded size invariant: chunk size must not explode beyond 2x chunkSize
                    assert.ok(
                        chunk.length <= chunkSize * 2 + 100,
                        `Trial ${trial}, chunk ${c}: Chunk size ${chunk.length} exceeded bounded upper limit`
                    );
                }
            }
        });

        it('Property 2: Dot product satisfies Cauchy-Schwarz inequality and symmetry for all random vector pairs', () => {
            const pseudoRandom = (seed: number) => {
                let s = seed;
                return () => {
                    s = (s * 9301 + 49297) % 233280;
                    return s / 233280;
                };
            };
            const rand = pseudoRandom(1337);

            for (let trial = 0; trial < 200; trial++) {
                const dim = 384;
                const v1 = new Array(dim);
                const v2 = new Array(dim);
                let norm1 = 0;
                let norm2 = 0;

                for (let d = 0; d < dim; d++) {
                    const r1 = rand() * 2 - 1;
                    const r2 = rand() * 2 - 1;
                    v1[d] = r1;
                    v2[d] = r2;
                    norm1 += r1 * r1;
                    norm2 += r2 * r2;
                }
                norm1 = Math.sqrt(norm1);
                norm2 = Math.sqrt(norm2);

                // Normalize unit vectors
                for (let d = 0; d < dim; d++) {
                    v1[d] /= norm1;
                    v2[d] /= norm2;
                }

                const dp12 = dotProduct(v1, v2);
                const dp21 = dotProduct(v2, v1);

                // Symmetry invariant: dot(u, v) == dot(v, u)
                assert.ok(
                    Math.abs(dp12 - dp21) < 1e-6,
                    `Trial ${trial}: Dot product symmetry violated: ${dp12} vs ${dp21}`
                );

                // Cauchy-Schwarz bound for unit vectors: -1.0 <= u.v <= 1.0 (with float precision slack)
                assert.ok(
                    dp12 >= -1.0001 && dp12 <= 1.0001,
                    `Trial ${trial}: Cauchy-Schwarz inequality violated: score = ${dp12}`
                );
            }
        });

        it('Property 3: Parameterized tenant filter strictly partitions retrieval universe', async () => {
            const memoryStore = new MemoryVectorAdapter();
            const tenants = ['tenant_alpha', 'tenant_beta', 'tenant_gamma'];
            const dim = 384;

            for (let t = 0; t < tenants.length; t++) {
                const tenantId = tenants[t]!;
                for (let i = 0; i < 10; i++) {
                    await memoryStore.addDocuments([{
                        id: `${tenantId}_doc_${i}`,
                        content: `Sensitive document ${i} for ${tenantId}`,
                        metadata: { tenantId }
                    }]);
                }
            }

            // Invariant: Querying for Tenant A must NEVER return any document from Tenant B or C
            for (const targetTenant of tenants) {
                const results = await memoryStore.search('Sensitive document', 20, { tenantId: targetTenant });

                assert.ok(results.length > 0, `Must return documents for ${targetTenant}`);
                for (const doc of results) {
                    assert.equal(
                        doc.metadata?.tenantId,
                        targetTenant,
                        `Tenant isolation violated: expected ${targetTenant}, found ${doc.metadata?.tenantId} in ${doc.id}`
                    );
                    assert.ok(
                        doc.id.startsWith(targetTenant),
                        `ID prefix mismatch: document ${doc.id} leaked into ${targetTenant} query`
                    );
                }
            }
        });
    });

    describe('Metamorphic Testing', () => {
        it('Metamorphic Relation 1: Ingestion of foreign tenant documents does not alter existing tenant retrieval scores', async () => {
            const memoryStore = new MemoryVectorAdapter();

            // 1. Ingest base documents for tenant_main
            await memoryStore.addDocuments([
                { id: 'main_doc_1', content: 'Enterprise Financial Policy', metadata: { tenantId: 'tenant_main' } },
                { id: 'main_doc_2', content: 'Customer Service SLAs', metadata: { tenantId: 'tenant_main' } }
            ]);

            const baselineResults = await memoryStore.search('Financial', 5, { tenantId: 'tenant_main' });
            assert.equal(baselineResults.length, 2);
            const baselineScore1 = baselineResults[0]!.score;

            // 2. Metamorphic perturbation: inject 50 high-scoring documents into tenant_foreign
            const foreignDocs = [];
            for (let i = 0; i < 50; i++) {
                foreignDocs.push({
                    id: `foreign_doc_${i}`,
                    content: 'Enterprise Financial Policy with identical terms',
                    metadata: { tenantId: 'tenant_foreign' }
                });
            }
            await memoryStore.addDocuments(foreignDocs);

            // 3. Measure post-perturbation results for tenant_main
            const postResults = await memoryStore.search('Financial', 5, { tenantId: 'tenant_main' });

            assert.equal(postResults.length, 2, 'Metamorphic relation violated: result set size altered by foreign tenant');
            assert.equal(postResults[0]!.id, baselineResults[0]!.id, 'Metamorphic relation violated: top doc changed');
            assert.equal(postResults[0]!.score, baselineScore1, 'Metamorphic relation violated: score altered by foreign docs');
        });

        it('Metamorphic Relation 2: Idempotent re-ingestion preserves exact document count and revision', async () => {
            const memoryStore = new MemoryVectorAdapter();
            const vec = new Array(384).fill(0.08);

            const doc = {
                id: 'idempotent_doc_x',
                content: 'Strict Idempotency Verification Document',
                embedding: vec,
                metadata: { tenantId: 'tenant_idem' }
            };

            // Ingest once
            await memoryStore.addDocuments([doc]);
            const firstSearch = await memoryStore.search('Idempotency', 10, { tenantId: 'tenant_idem' });
            assert.equal(firstSearch.length, 1);

            // Re-ingest 5 times with same ID
            for (let i = 0; i < 5; i++) {
                await memoryStore.addDocuments([doc]);
            }

            const finalSearch = await memoryStore.search('Idempotency', 10, { tenantId: 'tenant_idem' });
            assert.equal(finalSearch.length, 1, 'Metamorphic relation violated: Duplicate ingestion created multiple entries');
            assert.equal(finalSearch[0]!.id, 'idempotent_doc_x');
        });

        it('Metamorphic Relation 3: BM25 score monotonicity under term frequency scaling', () => {
            const bm25 = new BM25Index();

            // Document A mentions "refund" once
            // Document B mentions "refund" five times
            // Document C mentions unrelated words
            bm25.index([
                { id: 'doc_low', content: 'Our product policy has a refund period for customer orders.' },
                { id: 'doc_high', content: 'Refund refund refund refund refund policy details and return conditions.' },
                { id: 'doc_none', content: 'Company hardware and cloud infrastructure specifications.' }
            ]);

            const results = bm25.search('refund', 3);

            assert.equal(results.length, 2);
            assert.equal(results[0]!.document.id, 'doc_high', 'Metamorphic relation violated: Higher term frequency must rank higher');
            assert.equal(results[1]!.document.id, 'doc_low');
            assert.ok(
                results[0]!.score > results[1]!.score,
                `Monotonicity violated: score(high)=${results[0]!.score} must exceed score(low)=${results[1]!.score}`
            );
        });
    });
});
