import { CustomLLMAdapter } from './custom.adapter.js';

export interface OllamaConfig {
    /**
     * Base host for the Ollama instance (e.g. 'http://localhost:11434' or 'http://192.168.1.50:11434').
     * Defaults to process.env.OLLAMA_HOST || 'http://localhost:11434'.
     */
    host?: string | undefined;

    /**
     * Model tag pulled in Ollama (e.g., 'llama3.2', 'deepseek-r1:8b', 'mistral', 'qwen2.5:7b').
     * Defaults to process.env.OLLAMA_MODEL || 'llama3.2'.
     */
    model?: string | undefined;

    /**
     * Sampling temperature (defaults to 0.1).
     */
    temperature?: number | undefined;

    /**
     * Optional custom headers (e.g. if Ollama is behind an Nginx reverse proxy).
     */
    customHeaders?: Record<string, string> | undefined;
}

/**
 * Dedicated adapter for self-hosted Ollama instances.
 *
 * @remarks
 * Automatically routes requests to Ollama's OpenAI-compatible `/v1/chat/completions` endpoint.
 *
 * @example
 * ```typescript
 * import { OllamaAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const ollama = new OllamaAdapter({
 *   host: 'http://localhost:11434',
 *   model: 'llama3.2'
 * });
 *
 * const response = await ollama.generate({
 *   userPrompt: 'Explain quantum entanglement simply.'
 * });
 * ```
 */
export class OllamaAdapter extends CustomLLMAdapter {
    /**
     * Initializes a new instance of OllamaAdapter.
     *
     * @param config - Ollama configuration options (host, model, temperature, customHeaders).
     */
    constructor(config?: OllamaConfig) {
        const rawHost = config?.host || process.env.OLLAMA_HOST || 'http://localhost:11434';
        const normalizedHost = rawHost.replace(/\/+$/, '');
        const endpoint = `${normalizedHost}/v1/chat/completions`;

        const model = config?.model || process.env.OLLAMA_MODEL || process.env.OLLAMA_MODEL_FAST || 'llama3.2';

        super({
            endpoint,
            model,
            temperature: config?.temperature ?? 0.1,
            ...(config?.customHeaders ? { customHeaders: config.customHeaders } : {})
        });
    }

    /**
     * Factory creating an OllamaAdapter instance configured with a lightweight/fast model.
     *
     * @param config - Partial configuration overrides.
     * @returns Configured OllamaAdapter instance.
     */
    public static createFast(config?: Partial<OllamaConfig>): OllamaAdapter {
        return new OllamaAdapter({
            ...config,
            model: config?.model || process.env.OLLAMA_MODEL_FAST || process.env.OLLAMA_MODEL || 'llama3.2:3b'
        });
    }

    /**
     * Factory creating an OllamaAdapter instance configured with a reasoning/smart model.
     *
     * @param config - Partial configuration overrides.
     * @returns Configured OllamaAdapter instance.
     */
    public static createSmart(config?: Partial<OllamaConfig>): OllamaAdapter {
        return new OllamaAdapter({
            ...config,
            model: config?.model || process.env.OLLAMA_MODEL_SMART || process.env.OLLAMA_MODEL || 'deepseek-r1:8b'
        });
    }
}
