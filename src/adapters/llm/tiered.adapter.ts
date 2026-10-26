import type { ILLMProvider, ILLMRequest, ILLMResponse } from '../../interfaces/llm.interface';
import { OpenAIAdapter } from './openai.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OpenRouterAdapter } from './openrouter.adapter';
import { CustomLLMAdapter } from './custom.adapter';
import { OllamaAdapter } from './ollama.adapter';
import { FallbackLLMProvider } from './fallback.adapter';

export interface TieredLLMConfig {
    fastProvider: ILLMProvider;
    smartProvider: ILLMProvider;
    classifier?: ((request: ILLMRequest) => 'fast' | 'smart') | undefined;
}

export class TieredLLMProvider implements ILLMProvider {
    private fastProvider: ILLMProvider;
    private smartProvider: ILLMProvider;
    private customClassifier?: ((request: ILLMRequest) => 'fast' | 'smart') | undefined;

    constructor(config: TieredLLMConfig) {
        this.fastProvider = config.fastProvider;
        this.smartProvider = config.smartProvider;
        if (config.classifier) this.customClassifier = config.classifier;
    }

    /**
     * Determines whether the request requires high reasoning (smart) or standard execution (fast).
     */
    public classifyComplexity(request: ILLMRequest): 'fast' | 'smart' {
        if (request.complexity) return request.complexity;
        if (this.customClassifier) return this.customClassifier(request);

        const prompt = (request.userPrompt + ' ' + request.systemPrompt).toLowerCase();

        // 1. High-reasoning and analytical indicators (Turkish & English)
        const smartKeywords = [
            'karşılaştır', 'analiz', 'adım adım', 'kıyasla', 'nedenini açıkla', 'derinlemesine',
            'çözümle', 'strateji', 'matematik', 'algoritma', 'farkları neler',
            'compare', 'analyze', 'step by step', 'explain why', 'evaluate', 'synthesis',
            'deep dive', 'trade-offs', 'in-depth'
        ];

        const hasSmartKeyword = smartKeywords.some(keyword => prompt.includes(keyword));
        if (hasSmartKeyword) return 'smart';

        // 2. Multi-part questions (2 or more question marks)
        const questionMarks = (request.userPrompt.match(/\?/g) || []).length;
        if (questionMarks >= 2) return 'smart';

        // 3. Lengthy, detailed context prompts (> 60 words)
        const wordCount = request.userPrompt.trim().split(/\s+/).length;
        if (wordCount > 60) return 'smart';

        // 4. Multiple tool schemas needing precision
        if (request.tools && request.tools.length > 1) return 'smart';

        return 'fast';
    }

    public async generate(request: ILLMRequest): Promise<ILLMResponse> {
        const tier = this.classifyComplexity(request);
        const primaryProvider = tier === 'smart' ? this.smartProvider : this.fastProvider;
        const alternateProvider = tier === 'smart' ? this.fastProvider : this.smartProvider;

        try {
            return await primaryProvider.generate(request);
        } catch (error: any) {
            console.warn(
                `[TieredLLMProvider] ${tier.toUpperCase()} tier failed: "${error?.message}". Failing over to alternate tier...`
            );
            return await alternateProvider.generate(request);
        }
    }

    /**
     * Automatically constructs a TieredLLMProvider based on available configuration in environment variables.
     * Enforces enterprise data privacy compliance by respecting ALLOW_PUBLIC_OPENSOURCE_LLM.
     */
    public static createFromEnv(): TieredLLMProvider {
        const hasCustom = Boolean(process.env.PRIVATE_LLM_ENDPOINT || process.env.CUSTOM_LLM_ENDPOINT);
        const hasOllama = Boolean(process.env.OLLAMA_HOST || process.env.OLLAMA_MODEL);
        const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
        const hasGemini = Boolean(process.env.GEMINI_API_KEY);
        const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

        // Strict enterprise privacy control: public open-source models disabled unless explicitly allowed
        const allowPublicOpenSource = process.env.ALLOW_PUBLIC_OPENSOURCE_LLM === 'true';

        const fastProviders: ILLMProvider[] = [];
        const smartProviders: ILLMProvider[] = [];

        // 1. Private Enterprise / Self-Hosted Custom LLMs (vLLM, TGI, LocalAI, internal VPC gateway)
        if (hasCustom) {
            fastProviders.push(CustomLLMAdapter.createFast());
            smartProviders.push(CustomLLMAdapter.createSmart());
        }

        // 2. Local/On-Premise Ollama Instance
        if (hasOllama) {
            fastProviders.push(OllamaAdapter.createFast());
            smartProviders.push(OllamaAdapter.createSmart());
        }

        // 3. Proprietary Cloud APIs (OpenAI, Gemini)
        if (hasOpenAI) {
            fastProviders.push(OpenAIAdapter.createFast());
            smartProviders.push(OpenAIAdapter.createSmart());
        }

        if (hasGemini) {
            fastProviders.push(GeminiAdapter.createFast());
            smartProviders.push(GeminiAdapter.createSmart());
        }

        // 4. Public Open-Source LLMs (OpenRouter) - Allowed ONLY if compliance flag permits
        if (hasOpenRouter) {
            if (!allowPublicOpenSource) {
                console.info(
                    '[TieredLLMProvider] OPENROUTER_API_KEY found, but ALLOW_PUBLIC_OPENSOURCE_LLM is false (or unset). Skipping public open-source LLMs to safeguard company data.'
                );
            } else {
                fastProviders.push(OpenRouterAdapter.createFast());
                smartProviders.push(OpenRouterAdapter.createSmart());
            }
        }

        if (fastProviders.length === 0 || smartProviders.length === 0) {
            throw new Error(
                '[TieredLLMProvider] No eligible LLM providers found in environment. Please set PRIVATE_LLM_ENDPOINT, OLLAMA_HOST, OPENAI_API_KEY, GEMINI_API_KEY, or set ALLOW_PUBLIC_OPENSOURCE_LLM=true for OPENROUTER_API_KEY in .env.'
            );
        }

        const fastProvider = fastProviders.length > 1 ? new FallbackLLMProvider(fastProviders) : fastProviders[0]!;
        const smartProvider = smartProviders.length > 1 ? new FallbackLLMProvider(smartProviders) : smartProviders[0]!;

        return new TieredLLMProvider({
            fastProvider,
            smartProvider
        });
    }
}
