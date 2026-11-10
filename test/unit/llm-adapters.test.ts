import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CustomLLMAdapter } from '../../src/adapters/llm/custom.adapter.js';
import { OllamaAdapter } from '../../src/adapters/llm/ollama.adapter.js';
import { OpenRouterAdapter } from '../../src/adapters/llm/openrouter.adapter.js';
import { TieredLLMProvider } from '../../src/adapters/llm/tiered.adapter.js';
import { GeminiAdapter } from '../../src/adapters/llm/gemini.adapter.js';
import { OpenAIAdapter } from '../../src/adapters/llm/openai.adapter.js';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../src/interfaces/llm.interface.js';

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

    describe('GeminiAdapter & OpenAIAdapter Dual Constructor Ergonomics', () => {
        it('should support GeminiAdapter with configuration object', () => {
            const gemini = new GeminiAdapter({
                apiKey: 'test-gemini-key',
                model: 'gemini-2.0-flash',
                temperature: 0.2
            });

            assert.equal((gemini as any).apiKey, 'test-gemini-key');
            assert.equal((gemini as any).model, 'gemini-2.0-flash');
            assert.equal((gemini as any).temperature, 0.2);
        });

        it('should support GeminiAdapter with positional arguments', () => {
            const gemini = new GeminiAdapter('test-gemini-key-2', 'gemini-1.5-pro');

            assert.equal((gemini as any).apiKey, 'test-gemini-key-2');
            assert.equal((gemini as any).model, 'gemini-1.5-pro');
            assert.equal((gemini as any).temperature, 0.1);
        });

        it('should support OpenAIAdapter with configuration object', () => {
            const openai = new OpenAIAdapter({
                apiKey: 'test-openai-key',
                model: 'gpt-4o-mini',
                endpoint: 'https://custom-proxy.openai.com/v1',
                temperature: 0.0
            });

            assert.equal((openai as any).apiKey, 'test-openai-key');
            assert.equal((openai as any).model, 'gpt-4o-mini');
            assert.equal((openai as any).endpoint, 'https://custom-proxy.openai.com/v1');
            assert.equal((openai as any).temperature, 0.0);
        });

        it('should support OpenAIAdapter with positional arguments', () => {
            const openai = new OpenAIAdapter('test-openai-key-2', 'gpt-4o', 'https://api.openai.com/v1/chat/completions');

            assert.equal((openai as any).apiKey, 'test-openai-key-2');
            assert.equal((openai as any).model, 'gpt-4o');
            assert.equal((openai as any).endpoint, 'https://api.openai.com/v1/chat/completions');
        });

        it('should support OpenRouterAdapter with configuration object', () => {
            const openrouter = new OpenRouterAdapter({
                apiKey: 'test-openrouter-key',
                model: 'meta-llama/llama-3.2-3b-instruct:free'
            });

            assert.equal((openrouter as any).apiKey, 'test-openrouter-key');
            assert.equal((openrouter as any).model, 'meta-llama/llama-3.2-3b-instruct:free');
        });
    });
});
