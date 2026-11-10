import { providerTimeoutSignal } from '../../utils/http.js';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface.js';

/**
 * Configuration options for OpenAI LLM adapter.
 */
export interface OpenAIConfig {
    /** OpenAI API Key. Defaults to `process.env.OPENAI_API_KEY`. */
    apiKey?: string | undefined;
    /** Model identifier (e.g. `'gpt-4o-mini'`, `'gpt-4o'`). Defaults to `process.env.OPENAI_MODEL` or `'gpt-4o-mini'`. */
    model?: string | undefined;
    /** Base API endpoint. Defaults to `'https://api.openai.com/v1/chat/completions'`. */
    endpoint?: string | undefined;
    /** Sampling temperature in range [0.0 - 2.0]. Defaults to 0.1 for deterministic RAG answers. */
    temperature?: number | undefined;
}

/**
 * Enterprise adapter for OpenAI and OpenAI-compatible Chat Completions endpoints.
 *
 * @example
 * ```typescript
 * const openai = new OpenAIAdapter({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4o-mini',
 *   temperature: 0.1
 * });
 * const response = await openai.generate({
 *   systemPrompt: 'You are an internal corporate knowledge assistant.',
 *   userPrompt: 'Summarize Q3 financial report.'
 * });
 * ```
 */
export class OpenAIAdapter implements ILLMProvider {
    protected apiKey: string;
    protected model: string;
    protected endpoint: string;
    protected temperature: number;

    /**
     * Creates a new `OpenAIAdapter`.
     *
     * @param configOrApiKey - `OpenAIConfig` object, or raw API key string.
     * @param model - Model name string when passing raw API key.
     * @param endpoint - Custom endpoint URL for OpenAI proxies or gateways.
     * @throws `Error` if no API key is provided or found in environment variables.
     */
    constructor(
        configOrApiKey?: string | OpenAIConfig,
        model?: string,
        endpoint?: string
    ) {
        let key = '';
        let resolvedModel = '';
        let resolvedEndpoint = '';
        let temp = 0.1;

        if (typeof configOrApiKey === 'object' && configOrApiKey !== null) {
            key = configOrApiKey.apiKey || process.env.OPENAI_API_KEY || '';
            resolvedModel = configOrApiKey.model || process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini';
            resolvedEndpoint = configOrApiKey.endpoint || process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
            if (configOrApiKey.temperature !== undefined) temp = configOrApiKey.temperature;
        } else {
            key = configOrApiKey || process.env.OPENAI_API_KEY || '';
            resolvedModel = model || process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini';
            resolvedEndpoint = endpoint || process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
        }

        this.apiKey = key;
        if (!this.apiKey) {
            throw new Error('[OpenAIAdapter] API Key not found. Provide it in constructor or set OPENAI_API_KEY in .env');
        }
        this.model = resolvedModel;
        this.endpoint = resolvedEndpoint;
        this.temperature = temp;
    }

    public static createFast(apiKey?: string): OpenAIAdapter {
        return new OpenAIAdapter(apiKey, process.env.OPENAI_MODEL_FAST || 'gpt-4o-mini');
    }

    public static createSmart(apiKey?: string): OpenAIAdapter {
        return new OpenAIAdapter(apiKey, process.env.OPENAI_MODEL_SMART || 'gpt-4o');
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const messages = [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt }
        ];

        const body: Record<string, unknown> = {
            model: this.model,
            messages,
            temperature: this.temperature, // Low temperature to reduce hallucination in RAG pipelines
        };

        // Attach tool schemas if provided
        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            body.tool_choice = 'auto';
        }

        const response = await fetch(this.endpoint, {
            method: 'POST',
                signal: providerTimeoutSignal(),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`[OpenAI API Error] ${response.status}: ${errorData}`);
        }

        const data = await response.json();
        const message = data.choices[0].message;

        const result: ILLMResponse = {
            content: message.content || '',
            usage: {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens
            }
        };

        // Parse tool call arguments if returned by the model
        if (message.tool_calls && message.tool_calls.length > 0) {
            result.toolCalls = message.tool_calls.map((tc: { function: { name: string; arguments: string } }) => ({
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>
            }));
        }

        return result;
    }
}