import { OpenAIAdapter, type OpenAIConfig } from './openai.adapter.js';

export interface OpenRouterConfig extends OpenAIConfig {}

export class OpenRouterAdapter extends OpenAIAdapter {
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

    public static createFast(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free');
    }

    public static createSmart(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_SMART || 'deepseek/deepseek-r1:free');
    }
}
