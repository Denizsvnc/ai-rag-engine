import { BM25Index } from '../../src/core/vector/bm25';
import { reciprocalRankFusion } from '../../src/core/vector/hybrid-search';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter';

test('memory vector upsert and scoped deletion preserve same IDs in other tenants', async () => {
    const store = new MemoryVectorAdapter({ async getEmbedding() { return new Float32Array([1, 0]); } } as any);
    await store.addDocuments([
        { id: 'same', content: 'original refund', metadata: { tenantId: 'alpha' } },
        { id: 'same', content: 'beta refund', metadata: { tenantId: 'beta' } }
    ]);
    await store.addDocuments([{ id: 'same', content: 'updated refund', metadata: { tenantId: 'alpha' } }]);
    assert.deepEqual((await store.search('refund', 3, { tenantId: 'alpha' })).map(doc => doc.content), ['updated refund']);
    assert.deepEqual((await store.searchHybrid('refund', 3, { tenantId: 'alpha' })).map(doc => doc.content), ['updated refund']);
    assert.deepEqual((await store.searchHybrid('refund', 3, { tenantId: 'beta' })).map(doc => doc.content), ['beta refund']);
    await store.deleteDocument('same', { tenantId: 'alpha' });
    assert.equal((await store.searchHybrid('refund', 3, { tenantId: 'beta' })).length, 1);
    await store.clear({ tenantId: 'alpha' });
    assert.equal((await store.search('refund', 3, { tenantId: 'beta' })).length, 1);
    await store.clear();
    assert.equal((await store.searchHybrid('refund')).length, 0);
});


test('lexical index and fusion distinguish identical IDs across tenants', () => {
    const docs = [
        { id: 'same', content: 'refund alpha', metadata: { tenantId: 'alpha' } },
        { id: 'same', content: 'refund beta', metadata: { tenantId: 'beta' } }
    ];
    const index = new BM25Index();
    index.index(docs);
    assert.equal(index.search('refund', 3, { tenantId: 'alpha' })[0]?.document.content, 'refund alpha');
    assert.equal(index.search('refund', 3, { tenantId: 'beta' })[0]?.document.content, 'refund beta');
    assert.equal(reciprocalRankFusion(docs, docs).length, 2);
});
