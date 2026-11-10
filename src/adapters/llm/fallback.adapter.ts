import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface.js';

/**
 * Configuration options for `FallbackLLMProvider`.
 */
export interface FallbackProviderOptions {
    /** Whether to log warning messages to stderr when failover occurs. Defaults to `true`. */
    logFailover?: boolean;
}

/**
 * Resilient LLM provider wrapper that sequences multiple LLM providers with automatic failover.
 *
 * @remarks
 * If the primary provider encounters a quota error, timeout, or 5xx outage, `FallbackLLMProvider`
 * automatically catches the error and cascades to the secondary provider without dropping the query.
 *
 * @example
 * ```typescript
 * const provider = new FallbackLLMProvider([
 *   new GeminiAdapter({ model: 'gemini-3.6-flash' }),
 *   new OpenAIAdapter({ model: 'gpt-4o-mini' }),
 *   new OllamaAdapter({ model: 'llama3.2' })
 * ]);
 * ```
 */
export class FallbackLLMProvider implements ILLMProvider {
    private providers: ILLMProvider[];
    private logFailover: boolean;

    /**
     * Creates a new `FallbackLLMProvider`.
     *
     * @param providers - Ordered array of `ILLMProvider` backends to cascade through.
     * @param options - Optional failover logging configuration.
     * @throws `Error` if `providers` array is empty or undefined.
     */
    constructor(providers: ILLMProvider[], options?: FallbackProviderOptions) {
        if (!providers || providers.length === 0) {
            throw new Error('[FallbackLLMProvider] At least one LLM provider must be provided.');
        }
        this.providers = providers;
        this.logFailover = options?.logFailover ?? true;
    }

    private getProviderName(provider: ILLMProvider, index: number): string {
        const record = provider as unknown as Record<string, unknown>;
        if (typeof record['name'] === 'string') {
            return record['name'];
        }
        if (typeof record['model'] === 'string') {
            const ctor = provider.constructor?.name && provider.constructor.name !== 'Object' ? provider.constructor.name : 'LLMProvider';
            return `${ctor}(${record['model']})`;
        }
        if (provider.constructor?.name && provider.constructor.name !== 'Object') {
            return provider.constructor.name;
        }
        return `Provider#${index + 1}`;
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const failureErrors: Array<{ providerName: string; error: string }> = [];

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i]!;
            const providerName = this.getProviderName(provider, i);

            try {
                return await provider.generate(request);
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                failureErrors.push({ providerName, error: errorMessage });

                if (this.logFailover) {
                    const nextProvider = this.providers[i + 1];
                    const nextName = nextProvider ? this.getProviderName(nextProvider, i + 1) : 'None';
                    console.warn(
                        `[FallbackLLMProvider] ${providerName} failed: "${errorMessage}". Failing over to next provider: ${nextName}`
                    );
                }
            }
        }

        const summary = failureErrors
            .map(f => `[${f.providerName}]: ${f.error}`)
            .join(' | ');

        throw new Error(`[FallbackLLMProvider] All configured LLM providers failed. Details: ${summary}`);
    }
}
