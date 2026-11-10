import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface.js';

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

    private getProviderName(provider: ILLMProvider, index: number): string {
        if ((provider as any).name && typeof (provider as any).name === 'string') {
            return (provider as any).name;
        }
        if ((provider as any).model && typeof (provider as any).model === 'string') {
            const ctor = provider.constructor?.name && provider.constructor.name !== 'Object' ? provider.constructor.name : 'LLMProvider';
            return `${ctor}(${(provider as any).model})`;
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
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
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
