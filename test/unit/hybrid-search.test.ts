import { test, describe } from 'node:test';
import assert from 'node:assert';
import { BM25Index } from '../../src/core/vector/bm25';
import { reciprocalRankFusion } from '../../src/core/vector/hybrid-search';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter';
import { SMLEngine } from '../../src/core/sml-engine';

describe('Hybrid Search (BM25 + Dense Vectors + RRF)', () => {
    test('BM25Index should score exact keyword and alphanumeric identifiers with high precision', () => {
        const bm25 = new BM25Index();
        bm25.index([
            { id: 'doc1', content: 'Standard return policy for shoes and clothing items within 14 days.' },
            { id: 'doc2', content: 'Database connectivity error code ERR_CONN_TIMEOUT_504 occurred on replica.' },
            { id: 'doc3', content: 'Payment gateway configuration and Stripe webhook secret keys.' }
        ]);

        const results = bm25.search('ERR_CONN_TIMEOUT_504');
        assert.ok(results.length > 0);
        assert.strictEqual(results[0]?.document.id, 'doc2');
        assert.ok(results[0]?.score! > 0);
    });

    test('Reciprocal Rank Fusion should blend dense and sparse rankings fairly', () => {
        const denseDocs = [
            { id: 'doc_dense_1', content: 'Dense high semantic match' },
            { id: 'doc_shared', content: 'Relevant in both semantics and keywords' },
            { id: 'doc_dense_3', content: 'Dense lower semantic match' }
        ];

        const sparseDocs = [
            { id: 'doc_shared', content: 'Relevant in both semantics and keywords' },
            { id: 'doc_sparse_2', content: 'Keyword match' },
            { id: 'doc_sparse_3', content: 'Keyword lower match' }
        ];

        const fused = reciprocalRankFusion(denseDocs, sparseDocs, 3, 60);

        assert.ok(fused.length <= 3);
        // doc_shared appears in both dense (rank 2) and sparse (rank 1), so its reciprocal score must be the highest!
        assert.strictEqual(fused[0]?.id, 'doc_shared');
        assert.ok(fused[0]?.rrfScore! > fused[1]?.rrfScore!);
    });

    test('MemoryVectorAdapter.searchHybrid should return blended results using both vector and BM25', async () => {
        const sml = new SMLEngine();
        const vectorStore = new MemoryVectorAdapter(sml);

        await vectorStore.addDocuments([
            { id: 'sku_doc', content: 'Product SKU-998877 is an ultralight carbon fiber mountain bike.' },
            { id: 'bike_doc', content: 'General information regarding bicycle maintenance and gear shifting.' },
            { id: 'unrelated', content: 'Company vacation calendar and HR policies.' }
        ]);

        const hybridResults = await vectorStore.searchHybrid('SKU-998877 mountain bike', 2);

        assert.ok(hybridResults.length > 0);
        assert.strictEqual(hybridResults[0]?.id, 'sku_doc');
        assert.ok(hybridResults[0]?.rrfScore! > 0);
    });
});
