import type { IAgentTool } from './tool.interface.js';

/**
 * Standardized LLM prompt request structure dispatched to `ILLMProvider`.
 */
export interface ILLMRequest {
    /** Structured system prompt with business rules, retrieved documents, and boundary frames. */
    systemPrompt?: string | undefined;
    /** The framed user question or input prompt. */
    userPrompt: string;
    /** Optional array of tools available for model-driven function calling. */
    tools?: IAgentTool[];
    /** Complexity hint for tiered routing: `'fast'` for high throughput or `'smart'` for deep reasoning. */
    complexity?: 'fast' | 'smart';
}

/**
 * Standardized response object returned by an `ILLMProvider`.
 */
export interface ILLMResponse {
    /** Generated text response from the language model. */
    content: string;
    /** Function call suggestions emitted by the model. */
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, unknown>;
    }>;
    /** FinOps token consumption details. */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens?: number;
    };
}

/**
 * Pluggable Large Language Model (LLM) interface.
 * Implemented by `GeminiAdapter`, `OpenAIAdapter`, `OllamaAdapter`, `TieredLLMProvider`, and `FallbackLLMProvider`.
 *
 * @example
 * ```typescript
 * const customProvider: ILLMProvider = {
 *   generate: async (req) => ({
 *     content: `Answer to: ${req.userPrompt}`,
 *     usage: { promptTokens: 10, completionTokens: 5 }
 *   })
 * };
 * ```
 */
export interface ILLMProvider {
    /**
     * Dispatches a prompt request to the LLM backend.
     *
     * @param request - Standardized prompt request conforming to `ILLMRequest`.
     * @returns Promise resolving to `ILLMResponse`.
     * @throws `Error` if the provider fails or API rate limit is exceeded.
     */
    generate(request: ILLMRequest): Promise<ILLMResponse>;
}