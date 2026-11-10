import { OpenAIAdapter, type OpenAIConfig } from './openai.adapter.js';

/**
 * Configuration options for the OpenRouter LLM adapter.
 *
 * @remarks
 * Extends {@link OpenAIConfig} with OpenRouter default models and endpoints.
 */
export interface OpenRouterConfig extends OpenAIConfig {}

/**
 * LLM adapter connecting to the unified OpenRouter.ai API.
 *
 * @remarks
 * Provides access to diverse open-source and proprietary models through an OpenAI-compatible interface.
 * Enforces corporate data compliance policies: when `ALLOW_PUBLIC_OPENSOURCE_LLM=false`, instantiation is blocked.
 *
 * @example
 * ```typescript
 * import { OpenRouterAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const llm = new OpenRouterAdapter({
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   model: 'meta-llama/llama-3.2-3b-instruct:free'
 * });
 *
 * const response = await llm.generate({
 *   userPrompt: 'Summarize the given text.'
 * });
 * ```
 */
export class OpenRouterAdapter extends OpenAIAdapter {
    /**
     * Initializes a new instance of OpenRouterAdapter.
     *
     * @param configOrApiKey - OpenRouter configuration object or API key string.
     * @param model - Model identifier override.
     * @param endpoint - OpenRouter completion endpoint URL.
     * @throws If corporate policy disallows public open-source models (`ALLOW_PUBLIC_OPENSOURCE_LLM=false`).
     * @throws If API key is missing.
     */
    constructor(
        configOrApiKey?: string | OpenRouterConfig,
        model?: string,
        endpoint: string = 'https://openrouter.ai/api/v1/chat/completions'
    ) {
        // Enterprise Data Governance & Compliance Guard
        if (process.env.ALLOW_PUBLIC_OPENSOURCE_LLM === 'false') {
            throw new Error(
                '[OpenRouterAdapter] Blocked by security policy: ALLOW_PUBLIC_OPENSOURCE_LLM is set to false in .env. Corporate prompts cannot be routed to public external open-source models.'
            );
        }

        let key = '';
        let resolvedModel = '';
        let resolvedEndpoint = endpoint;
        let temp = 0.1;

        if (typeof configOrApiKey === 'object' && configOrApiKey !== null) {
            key = configOrApiKey.apiKey || process.env.OPENROUTER_API_KEY || '';
            resolvedModel = configOrApiKey.model || process.env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free';
            if (configOrApiKey.endpoint) resolvedEndpoint = configOrApiKey.endpoint;
            if (configOrApiKey.temperature !== undefined) temp = configOrApiKey.temperature;
        } else {
            key = configOrApiKey || process.env.OPENROUTER_API_KEY || '';
            resolvedModel = model || process.env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free';
        }

        if (!key) {
            throw new Error('[OpenRouterAdapter] API Key not found. Provide it in constructor or set OPENROUTER_API_KEY in .env');
        }

        super({
            apiKey: key,
            model: resolvedModel,
            endpoint: resolvedEndpoint,
            temperature: temp
        });
    }

    /**
     * Factory method creating an OpenRouter adapter tuned for low-latency tasks.
     *
     * @param apiKey - Optional API key override.
     * @returns Configured OpenRouterAdapter instance.
     */
    public static createFast(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free');
    }

    /**
     * Factory method creating an OpenRouter adapter tuned for high-reasoning tasks.
     *
     * @param apiKey - Optional API key override.
     * @returns Configured OpenRouterAdapter instance.
     */
    public static createSmart(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_SMART || 'deepseek/deepseek-r1:free');
    }
}
