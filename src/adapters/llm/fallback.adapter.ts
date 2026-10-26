import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface';

export interface FallbackProviderOptions {
    logFailover?: boolean;
}

export class FallbackLLMProvider implements ILLMProvider {
    private providers: ILLMProvider[];
    private logFailover: boolean;

    constructor(providers: ILLMProvider[], options?: FallbackProviderOptions) {
        if (!providers || providers.length === 0) {
            throw new Error('[FallbackLLMProvider] At least one LLM provider must be provided.');
        }
        this.providers = providers;
        this.logFailover = options?.logFailover ?? true;
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const failureErrors: Array<{ providerName: string; error: string }> = [];

        for (let i = 0; i < this.providers.length; i++) {
            const provider = this.providers[i]!;
            const providerName = provider.constructor.name || `Provider#${i + 1}`;

            try {
                return await provider.generate(request);
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                failureErrors.push({ providerName, error: errorMessage });

                if (this.logFailover) {
                    const nextProvider = this.providers[i + 1];
                    const nextName = nextProvider ? (nextProvider.constructor.name || `Provider#${i + 2}`) : 'None';
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
