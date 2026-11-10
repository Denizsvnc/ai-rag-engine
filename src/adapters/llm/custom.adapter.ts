import { providerTimeoutSignal } from '../../utils/http.js';
import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface.js';

export interface CustomLLMConfig {
    /**
     * Full URL to the OpenAI-compatible chat completions endpoint.
     * e.g., 'http://localhost:8000/v1/chat/completions' (vLLM)
     * e.g., 'http://internal-llm.company.local:8080/v1/chat/completions'
     */
    endpoint?: string;

    /**
     * Model identifier expected by the inference server.
     * e.g., 'llama-3.1-8b-instruct', 'mistral-large', 'qwen-2.5-72b'
     */
    model?: string;

    /**
     * Optional API key or bearer token. Left empty if running within a secured private VPC.
     */
    apiKey?: string | undefined;

    /**
     * Additional HTTP headers (e.g. corporate proxy headers, tenant IDs, authorization).
     */
    customHeaders?: Record<string, string> | undefined;

    /**
     * Sampling temperature (defaults to 0.1 for deterministic RAG answers).
     */
    temperature?: number | undefined;
}

/**
 * Adapter for private, self-hosted, or internal enterprise LLM APIs.
 * Works seamlessly with vLLM, LocalAI, HuggingFace TGI, LM Studio, Azure OpenAI,
 * and any internal API gateway adhering to the OpenAI-compatible /v1/chat/completions spec.
 */
export class CustomLLMAdapter implements ILLMProvider {
    protected endpoint: string;
    protected model: string;
    protected apiKey?: string | undefined;
    protected customHeaders: Record<string, string>;
    protected temperature: number;

    /**
     * Initializes a new CustomLLMAdapter instance.
     *
     * @param config - Optional configuration overrides (endpoint, model, apiKey, headers).
     */
    constructor(config?: CustomLLMConfig) {
        this.endpoint =
            config?.endpoint ||
            process.env.PRIVATE_LLM_ENDPOINT ||
            process.env.CUSTOM_LLM_ENDPOINT ||
            'http://localhost:8000/v1/chat/completions';

        this.model =
            config?.model ||
            process.env.PRIVATE_LLM_MODEL ||
            process.env.PRIVATE_LLM_MODEL_FAST ||
            process.env.CUSTOM_LLM_MODEL ||
            'default-model';

        this.apiKey = config?.apiKey || process.env.PRIVATE_LLM_API_KEY || process.env.CUSTOM_LLM_API_KEY;

        let parsedEnvHeaders: Record<string, string> = {};
        if (process.env.PRIVATE_LLM_HEADERS) {
            try {
                parsedEnvHeaders = JSON.parse(process.env.PRIVATE_LLM_HEADERS);
            } catch (err) {
                console.warn('[CustomLLMAdapter] Failed to parse PRIVATE_LLM_HEADERS from environment. Expected valid JSON.');
            }
        }

        this.customHeaders = {
            ...parsedEnvHeaders,
            ...(config?.customHeaders || {})
        };

        this.temperature = config?.temperature ?? 0.1;
    }

    /**
     * Creates a fast low-latency instance of CustomLLMAdapter.
     *
     * @param config - Optional configuration overrides.
     * @returns Configured CustomLLMAdapter instance.
     */
    public static createFast(config?: Partial<CustomLLMConfig>): CustomLLMAdapter {
        return new CustomLLMAdapter({
            ...config,
            model: config?.model || process.env.PRIVATE_LLM_MODEL_FAST || process.env.PRIVATE_LLM_MODEL || 'default-fast-model'
        });
    }

    /**
     * Creates a high-reasoning smart instance of CustomLLMAdapter.
     *
     * @param config - Optional configuration overrides.
     * @returns Configured CustomLLMAdapter instance.
     */
    public static createSmart(config?: Partial<CustomLLMConfig>): CustomLLMAdapter {
        return new CustomLLMAdapter({
            ...config,
            model: config?.model || process.env.PRIVATE_LLM_MODEL_SMART || process.env.PRIVATE_LLM_MODEL || 'default-smart-model'
        });
    }

    /**
     * Generates a completion from the custom inference endpoint.
     *
     * @param request - LLM request payload with prompts and optional tool definitions.
     * @returns Standardized LLM response with generated text, token usage, and tool calls.
     * @throws If HTTP connection fails or non-200 status is returned.
     */
    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const messages: Array<{ role: string; content: string }> = [];

        if (request.systemPrompt) {
            messages.push({ role: 'system', content: request.systemPrompt });
        }
        messages.push({ role: 'user', content: request.userPrompt });

        const body: Record<string, unknown> = {
            model: this.model,
            messages,
            temperature: this.temperature
        };

        // Attach function schemas if tools are provided
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

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.customHeaders
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        let response: Response;
        try {
            response = await fetch(this.endpoint, {
                method: 'POST',
                signal: providerTimeoutSignal(),
                headers,
                body: JSON.stringify(body)
            });
        } catch (networkError: unknown) {
            const netMsg = networkError instanceof Error ? networkError.message : String(networkError);
            throw new Error(
                `[CustomLLMAdapter] Failed to connect to private LLM at ${this.endpoint}: ${netMsg}`
            );
        }

        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`[CustomLLMAdapter] Error from ${this.endpoint} (${response.status}): ${errorDetails}`);
        }

        const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string | Record<string, unknown> } }> } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error(`[CustomLLMAdapter] Unexpected response structure from ${this.endpoint}: missing choices.`);
        }

        const message = choice.message;
        const result: ILLMResponse = {
            content: message?.content || ''
        };

        if (data.usage) {
            result.usage = {
                promptTokens: data.usage.prompt_tokens ?? 0,
                completionTokens: data.usage.completion_tokens ?? 0
            };
        }

        if (message?.tool_calls && message.tool_calls.length > 0) {
            result.toolCalls = message.tool_calls.map((tc: { function: { name: string; arguments: string | Record<string, unknown> } }) => ({
                name: tc.function.name,
                arguments: typeof tc.function.arguments === 'string'
                    ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                    : tc.function.arguments
            }));
        }

        return result;
    }
}
