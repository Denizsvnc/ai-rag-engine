import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RAGEngine } from '../../../src/core/engine';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter';
import { SMLEngine } from '../../../src/core/sml-engine';
import { Readable } from 'node:stream';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class MockTenantLLM implements ILLMProvider {
    public queryLog: Array<{ prompt: string; tenantId?: string }> = [];

    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        this.queryLog.push({ prompt: req.userPrompt });
        return {
            content: `LLM Generated for: ${req.userPrompt}`,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
    }
}

describe('Deep Enterprise Multi-Tenant Isolation & Anti-Poisoning', () => {
    test('Cache Anti-Poisoning: Identical prompts from different tenants must never share or leak cached responses', async () => {
        const mockLLM = new MockTenantLLM();
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            cache: { enabled: true, minHitsToPersist: 5 },
            smlConfig: { enabled: false }
        });

        await engine.init();

        const commonPrompt = 'What is the quarterly financial budget?';

        // 1. Tenant Alpha queries and populates cache
        const resAlpha1 = await engine.query(commonPrompt, { tenantId: 'tenant_alpha' });
        assert.strictEqual(resAlpha1.resolvedBy, 'LLM_RAG');
        assert.strictEqual(mockLLM.queryLog.length, 1);

        // 2. Tenant Alpha queries again -> served from cache
        const resAlpha2 = await engine.query(commonPrompt, { tenantId: 'tenant_alpha' });
        assert.strictEqual(resAlpha2.resolvedBy, 'CACHE');
        assert.strictEqual(mockLLM.queryLog.length, 1); // No new LLM invocation

        // 3. Tenant Beta queries the EXACT same prompt -> must NOT receive Tenant Alpha cache!
        const resBeta1 = await engine.query(commonPrompt, { tenantId: 'tenant_beta' });
        assert.strictEqual(resBeta1.resolvedBy, 'LLM_RAG');
        assert.strictEqual(mockLLM.queryLog.length, 2); // Dispatched to LLM freshly for Beta

        // 4. Invalidate only Tenant Alpha's cache
        await engine.invalidateCache('tenant_alpha');

        // Tenant Beta's cache should still be intact
        const resBeta2 = await engine.query(commonPrompt, { tenantId: 'tenant_beta' });
        assert.strictEqual(resBeta2.resolvedBy, 'CACHE');
        assert.strictEqual(mockLLM.queryLog.length, 2);
    });

    test('Vector Search Boundary: Documents from Tenant A must never be retrieved for Tenant B even with 100% semantic match', async () => {
        const smlEngine = new SMLEngine();
        await smlEngine.init();
        const vectorStore = new MemoryVectorAdapter(smlEngine);

        // Populate confidential documents with high semantic similarity
        await vectorStore.addDocuments([
            {
                id: 'alpha_secret_mna',
                content: 'Project Pegasus: Acquisition target valuation is set to 450 Million USD.',
                metadata: { tenantId: 'tenant_alpha', confidentiality: 'TOP_SECRET' }
            },
            {
                id: 'beta_public_announcement',
                content: 'Company quarterly revenue report announces general market growth.',
                metadata: { tenantId: 'tenant_beta', confidentiality: 'PUBLIC' }
            }
        ]);

        // Tenant Beta queries for acquisition valuation
        const betaResults = await vectorStore.search('acquisition target valuation and buyout price', 5, {
            tenantId: 'tenant_beta'
        });

        // Verification: Zero leakage of Tenant Alpha documents
        assert.ok(betaResults.every(doc => doc.metadata?.['tenantId'] === 'tenant_beta'));
        assert.strictEqual(betaResults.some(doc => doc.id === 'alpha_secret_mna'), false);

        // Tenant Alpha querying the same vector must retrieve its own document
        const alphaResults = await vectorStore.search('acquisition target valuation and buyout price', 5, {
            tenantId: 'tenant_alpha'
        });
        assert.ok(alphaResults.some(doc => doc.id === 'alpha_secret_mna'));
        assert.ok(alphaResults.every(doc => doc.metadata?.['tenantId'] === 'tenant_alpha'));
    });

    test('Streaming Ingestion Isolation: Uploaded stream chunks must be strictly tagged by tenantId', async () => {
        const smlEngine = new SMLEngine();
        await smlEngine.init();
        const vectorStore = new MemoryVectorAdapter(smlEngine);

        const engine = new RAGEngine({
            llmProvider: new MockTenantLLM(),
            inputs: { vectorStore },
            cache: { enabled: false },
            smlConfig: { enabled: false }
        });

        await engine.init();
        const ingestionService = engine.getIngestionService();

        const streamContent = 'Tenant Gamma proprietary sales data and supplier contracts for 2026.';
        const stream = Readable.from([streamContent]);

        const result = await ingestionService.ingestStreamDirect('gamma_contracts.txt', stream, {
            tenantId: 'tenant_gamma'
        });

        assert.ok(result.chunksCount > 0);

        // Querying with tenant_delta must yield 0 results
        const deltaSearch = await vectorStore.search('sales data and supplier contracts', 5, {
            tenantId: 'tenant_delta'
        });
        assert.strictEqual(deltaSearch.length, 0);

        // Querying with tenant_gamma retrieves the streamed document
        const gammaSearch = await vectorStore.search('sales data and supplier contracts', 5, {
            tenantId: 'tenant_gamma'
        });
        assert.ok(gammaSearch.length > 0);
        assert.strictEqual(gammaSearch[0]!.metadata?.['tenantId'], 'tenant_gamma');
    });
});
