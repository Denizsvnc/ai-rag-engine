import test from 'node:test';
import assert from 'node:assert/strict';
import { RAGEngine } from '../../../src/core/engine';
import { LocalFaqAdapter } from '../../../src/adapters/faq/local-faq.adapter';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../../src/interfaces/llm.interface';

class MockCountingLLMProvider implements ILLMProvider {
    public callCount = 0;
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        this.callCount++;
        return {
            content: `LLM Response for call ${this.callCount}`,
            usage: { promptTokens: 10, completionTokens: 5 }
        };
    }
}

test('Security Layer - Cache Role Isolation & Multi-Tenant FAQ Boundary', async (t) => {
    await t.test('Cache Role Isolation: Different roles asking identical prompt must never share cache', async () => {
        const mockLLM = new MockCountingLLMProvider();
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            cache: { enabled: true, ttl: 60 },
            smlConfig: { enabled: false }
        });
        await engine.init();

        const queryText = 'What is the confidential revenue report for Q3?';

        // 1. Admin queries prompt -> LLM is called
        const resAdmin = await engine.query(queryText, {
            userId: 'admin_alice',
            tenantId: 'tenant_finance',
            roles: ['admin', 'manager']
        });
        assert.equal(mockLLM.callCount, 1);
        assert.equal(resAdmin.resolvedBy, 'LLM_RAG');

        // 2. Admin queries prompt again -> Cache HIT
        const resAdmin2 = await engine.query(queryText, {
            userId: 'admin_alice',
            tenantId: 'tenant_finance',
            roles: ['admin', 'manager']
        });
        assert.equal(mockLLM.callCount, 1, 'Subsequent admin query should hit cache');
        assert.equal(resAdmin2.resolvedBy, 'CACHE');

        // 3. Guest user queries the EXACT same prompt for the same tenant
        // MUST NOT hit the admin's cached response!
        const resGuest = await engine.query(queryText, {
            userId: 'guest_bob',
            tenantId: 'tenant_finance',
            roles: ['guest']
        });

        assert.equal(mockLLM.callCount, 2, 'Guest query MUST cause a cache miss due to role isolation');
        assert.equal(resGuest.resolvedBy, 'LLM_RAG');
    });

    await t.test('LocalFaqAdapter: Multi-tenant filtering prevents cross-tenant FAQ leakage', async () => {
        const faqAdapter = new LocalFaqAdapter();
        // Clear default FAQs and populate tenant-specific FAQs
        await faqAdapter.setFaqs([
            {
                question: 'What is our corporate discount code?',
                answer: 'Tenant Alpha discount code is ALPHA-VIP-99',
                category: 'billing',
                tenantId: 'tenant_alpha'
            },
            {
                question: 'What is our corporate discount code?',
                answer: 'Tenant Beta discount code is BETA-STANDARD-10',
                category: 'billing',
                tenantId: 'tenant_beta'
            },
            {
                question: 'What is the main support email?',
                answer: 'Global support is support@universal.com',
                category: 'general'
                // Global FAQ without tenantId
            }
        ]);

        await faqAdapter.init();

        // 1. Tenant Alpha query should match Alpha FAQ only
        const matchAlpha = await faqAdapter.findBestMatch('What is our corporate discount code?', 0.6, 'tenant_alpha');
        assert.ok(matchAlpha);
        assert.ok(matchAlpha.answer.includes('ALPHA-VIP-99'));

        // 2. Tenant Beta query should match Beta FAQ only
        const matchBeta = await faqAdapter.findBestMatch('What is our corporate discount code?', 0.6, 'tenant_beta');
        assert.ok(matchBeta);
        assert.ok(matchBeta.answer.includes('BETA-STANDARD-10'));

        // 3. Tenant Gamma (unrelated tenant) should NOT see Alpha or Beta discount codes
        const matchGamma = await faqAdapter.findBestMatch('What is our corporate discount code?', 0.6, 'tenant_gamma');
        assert.equal(matchGamma, null, 'Tenant Gamma must not access Tenant Alpha or Beta FAQs');

        // 4. Global FAQ (no tenantId specified) should be accessible to Tenant Gamma
        const globalMatch = await faqAdapter.findBestMatch('What is the main support email?', 0.6, 'tenant_gamma');
        assert.ok(globalMatch);
        assert.ok(globalMatch.answer.includes('support@universal.com'));
    });
});
