import { CustomLLMAdapter } from './custom.adapter';

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
 * Automatically targets Ollama's OpenAI-compatible /v1/chat/completions endpoint.
 */
export class OllamaAdapter extends CustomLLMAdapter {
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

    public static createFast(config?: Partial<OllamaConfig>): OllamaAdapter {
        return new OllamaAdapter({
            ...config,
            model: config?.model || process.env.OLLAMA_MODEL_FAST || process.env.OLLAMA_MODEL || 'llama3.2:3b'
        });
    }

    public static createSmart(config?: Partial<OllamaConfig>): OllamaAdapter {
        return new OllamaAdapter({
            ...config,
            model: config?.model || process.env.OLLAMA_MODEL_SMART || process.env.OLLAMA_MODEL || 'deepseek-r1:8b'
        });
    }
}
