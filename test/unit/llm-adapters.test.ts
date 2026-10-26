import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CustomLLMAdapter } from '../../src/adapters/llm/custom.adapter';
import { OllamaAdapter } from '../../src/adapters/llm/ollama.adapter';
import { OpenRouterAdapter } from '../../src/adapters/llm/openrouter.adapter';
import { TieredLLMProvider } from '../../src/adapters/llm/tiered.adapter';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface';

class MockProvider implements ILLMProvider {
    constructor(private responseText: string, public shouldFail: boolean = false) {}
    async generate(request: ILLMRequest): Promise<ILLMResponse> {
        if (this.shouldFail) throw new Error('Provider simulation error');
        return { content: this.responseText };
    }
}

describe('LLM Adapters & Routing', () => {
    describe('CustomLLMAdapter & OllamaAdapter', () => {
        it('should correctly configure CustomLLMAdapter for private VPC endpoints', () => {
            const custom = new CustomLLMAdapter({
                endpoint: 'http://my-internal-vllm.corp:8000/v1/chat/completions',
                model: 'mistral-large',
                apiKey: 'corp-secret-token',
                customHeaders: { 'X-Tenant-ID': 'analytics' }
            });

            assert.ok(custom !== null);
        });

        it('should initialize OllamaAdapter with standard local host defaults', () => {
            const ollama = new OllamaAdapter({
                host: 'http://localhost:11434',
                model: 'llama3.2'
            });

            assert.ok(ollama !== null);
        });
    });

    describe('OpenRouterAdapter Enterprise Compliance Guard', () => {
        it('should block instantiation when ALLOW_PUBLIC_OPENSOURCE_LLM=false', () => {
            const prevFlag = process.env.ALLOW_PUBLIC_OPENSOURCE_LLM;
            const prevKey = process.env.OPENROUTER_API_KEY;

            try {
                process.env.ALLOW_PUBLIC_OPENSOURCE_LLM = 'false';
                process.env.OPENROUTER_API_KEY = 'test-token';

                assert.throws(() => {
                    new OpenRouterAdapter();
                }, /Blocked by security policy: ALLOW_PUBLIC_OPENSOURCE_LLM is set to false/);
            } finally {
                process.env.ALLOW_PUBLIC_OPENSOURCE_LLM = prevFlag;
                process.env.OPENROUTER_API_KEY = prevKey;
            }
        });
    });

    describe('TieredLLMProvider', () => {
        const fastMock = new MockProvider('fast answer');
        const smartMock = new MockProvider('smart answer');
        const tiered = new TieredLLMProvider({
            fastProvider: fastMock,
            smartProvider: smartMock
        });

        it('should classify short inquiries as fast tier', () => {
            const req: ILLMRequest = {
                systemPrompt: 'Sys',
                userPrompt: 'Kargo kaç günde gelir?'
            };
            assert.equal(tiered.classifyComplexity(req), 'fast');
        });

        it('should classify analytical keywords as smart tier', () => {
            const req: ILLMRequest = {
                systemPrompt: 'Sys',
                userPrompt: 'İki seçeneğin artı ve eksilerini adım adım karşılaştır ve analiz et.'
            };
            assert.equal(tiered.classifyComplexity(req), 'smart');
        });

        it('should classify multi-question prompts as smart tier', () => {
            const req: ILLMRequest = {
                systemPrompt: 'Sys',
                userPrompt: 'İade süresi ne kadar? Ayrıca kargo ücreti kime ait?'
            };
            assert.equal(tiered.classifyComplexity(req), 'smart');
        });

        it('should failover to alternate tier if primary provider throws', async () => {
            const failingFast = new MockProvider('fast', true);
            const workingSmart = new MockProvider('smart fallback');

            const provider = new TieredLLMProvider({
                fastProvider: failingFast,
                smartProvider: workingSmart
            });

            const res = await provider.generate({
                systemPrompt: 'Sys',
                userPrompt: 'Kısa soru'
            });

            assert.equal(res.content, 'smart fallback');
        });
    });
});
