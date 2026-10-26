import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RAGEngine } from '../../src/core/engine';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter';
import { SMLEngine } from '../../src/core/sml-engine';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class MockCountingLLM implements ILLMProvider {
    public calls: Record<string, number> = {};

    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        const key = req.userPrompt;
        this.calls[key] = (this.calls[key] || 0) + 1;
        return {
            content: `Response for: ${key}`,
            usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 }
        };
    }
}

describe('Multi-Tenancy & Tenant Isolation', () => {
    test('Cache should be strictly isolated by tenantId so tenant B never reads tenant A cache', async () => {
        const mockLLM = new MockCountingLLM();
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            cache: { enabled: true, filePath: './data/test-tenant-cache.json' },
            smlConfig: { enabled: false }
        });

        await engine.init();
        await engine.clearCache();

        const query = 'What are the company holiday days?';

        // 1. Tenant Alpha queries -> Cache miss, LLM invoked
        const resA1 = await engine.query(query, { tenantId: 'tenant_alpha' });
        assert.strictEqual(resA1.resolvedBy, 'LLM_RAG');

        // 2. Tenant Alpha queries again -> Cache HIT
        const resA2 = await engine.query(query, { tenantId: 'tenant_alpha' });
        assert.strictEqual(resA2.resolvedBy, 'CACHE');

        // 3. Tenant Beta queries the EXACT same query -> Must be Cache MISS (isolated)
        const resB1 = await engine.query(query, { tenantId: 'tenant_beta' });
        assert.strictEqual(resB1.resolvedBy, 'LLM_RAG');

        // 4. Tenant Beta queries again -> Cache HIT for Tenant Beta
        const resB2 = await engine.query(query, { tenantId: 'tenant_beta' });
        assert.strictEqual(resB2.resolvedBy, 'CACHE');

        await engine.clearCache();
    });

    test('Vector search should filter by tenantId preventing cross-tenant document leakage', async () => {
        const sml = new SMLEngine();
        const vectorStore = new MemoryVectorAdapter(sml);

        // Ingest documents for two separate tenants
        await vectorStore.addDocuments([
            {
                id: 'doc_alpha_contracts',
                content: 'Confidential Alpha Acquisition Agreement for Q4.',
                metadata: { tenantId: 'tenant_alpha' }
            },
            {
                id: 'doc_beta_financials',
                content: 'Confidential Beta Financial statements and revenue data for Q4.',
                metadata: { tenantId: 'tenant_beta' }
            }
        ]);

        // Search for Tenant Alpha
        const alphaResults = await vectorStore.search('financial and acquisition reports', 5, {
            tenantId: 'tenant_alpha'
        });

        // Tenant Alpha must only see its own document
        assert.strictEqual(alphaResults.length, 1);
        assert.strictEqual(alphaResults[0]?.id, 'doc_alpha_contracts');

        // Search for Tenant Beta
        const betaResults = await vectorStore.search('financial and acquisition reports', 5, {
            tenantId: 'tenant_beta'
        });

        // Tenant Beta must only see its own document
        assert.strictEqual(betaResults.length, 1);
        assert.strictEqual(betaResults[0]?.id, 'doc_beta_financials');
    });
});
