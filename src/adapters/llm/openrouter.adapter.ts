import { OpenAIAdapter } from './openai.adapter';

export class OpenRouterAdapter extends OpenAIAdapter {
    constructor(
        apiKey?: string,
        model?: string,
        endpoint: string = 'https://openrouter.ai/api/v1/chat/completions'
    ) {
        // Enterprise Data Governance & Compliance Guard
        if (process.env.ALLOW_PUBLIC_OPENSOURCE_LLM === 'false') {
            throw new Error(
                '[OpenRouterAdapter] Blocked by security policy: ALLOW_PUBLIC_OPENSOURCE_LLM is set to false in .env. Corporate prompts cannot be routed to public external open-source models.'
            );
        }

        const key = apiKey || process.env.OPENROUTER_API_KEY || '';
        if (!key) {
            throw new Error('[OpenRouterAdapter] API Key not found. Provide it in constructor or set OPENROUTER_API_KEY in .env');
        }
        const resolvedModel = model || process.env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free';
        super(key, resolvedModel, endpoint);
    }

    public static createFast(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_FAST || 'meta-llama/llama-3.2-3b-instruct:free');
    }

    public static createSmart(apiKey?: string): OpenRouterAdapter {
        return new OpenRouterAdapter(apiKey, process.env.OPENROUTER_MODEL_SMART || 'deepseek/deepseek-r1:free');
    }
}
