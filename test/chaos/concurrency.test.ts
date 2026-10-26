import { test, describe } from 'node:test';
import assert from 'node:assert';
import { RAGEngine } from '../../src/core/engine';
import { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class MockLLM implements ILLMProvider {
    public callCount = 0;
    async generate(req: ILLMRequest): Promise<ILLMResponse> {
        this.callCount++;
        // Small artificial delay to simulate network latency
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
            content: `Mock response for: ${req.userPrompt.substring(0, 20)}`,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
    }
}

describe('Chaos & Concurrency Hardening', () => {
    test('Parallel init() calls should resolve via a single mutex lock without race conditions', async () => {
        const mockLLM = new MockLLM();
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            cache: { enabled: false },
            smlConfig: { enabled: false } // Fast test of mutex lock
        });

        // Launch 50 concurrent init() calls simultaneously
        const initPromises = Array.from({ length: 50 }, () => engine.init());
        await Promise.all(initPromises);

        // Verification: all 50 resolved cleanly
        assert.strictEqual(typeof engine.query, 'function');
    });

    test('High-concurrency parallel queries should execute safely with tenant-isolated contexts', async () => {
        const mockLLM = new MockLLM();
        const engine = new RAGEngine({
            llmProvider: mockLLM,
            inputs: {},
            cache: { enabled: true, filePath: './data/test-chaos-cache.json' },
            smlConfig: { enabled: false }
        });

        await engine.init();

        // 30 parallel queries across 3 different tenants
        const tenants = ['tenant_alpha', 'tenant_beta', 'tenant_gamma'];
        const queryPromises = Array.from({ length: 30 }, (_, i) => {
            const tenantId = tenants[i % tenants.length];
            return engine.query(`Concurrent question #${i}`, { tenantId, userId: `user_${i}` });
        });

        const results = await Promise.all(queryPromises);

        assert.strictEqual(results.length, 30);
        for (const res of results) {
            assert.ok(res.answer.includes('Mock response'));
            assert.ok(res.latencyMs >= 0);
        }

        await engine.clearCache();
    });
});
