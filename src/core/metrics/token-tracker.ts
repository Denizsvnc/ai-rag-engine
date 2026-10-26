export interface ResponseMetrics {
    tokensConsumed: number;
    tokensSaved: number;
    estimatedCostSavedUsd: number;
    latencyMs: number;
    source: 'CACHE' | 'FAQ' | 'TOOL_EXECUTION' | 'LLM_RAG' | 'SECURITY_BLOCKED';
}

export interface EngineMetricsSummary {
    totalQueries: number;
    cacheHits: number;
    faqHits: number;
    smlToolHits: number;
    llmCalls: number;
    securityBlocked: number;
    zeroTokenRate: string; // e.g. "65.5%"
    tokensConsumed: number;
    tokensSaved: number;
    estimatedCostUsd: number;
    estimatedCostSavedUsd: number;
    latency: {
        avgMs: number;
        minMs: number;
        maxMs: number;
        p50Ms: number;
        p95Ms: number;
    };
}

export interface TokenTrackerOptions {
    costPerThousandTokensUsd?: number; // Default: $0.003 (blended GPT-4o-mini / Gemini Flash rate)
    baselineTokensPerQuery?: number;   // Average tokens spent on full prompt+generation if not offloaded (default: 450)
}

export class TokenTracker {
    private readonly costPerThousand: number;
    private readonly baselineTokensPerQuery: number;

    private totalQueries = 0;
    private cacheHits = 0;
    private faqHits = 0;
    private smlToolHits = 0;
    private llmCalls = 0;
    private securityBlocked = 0;

    private totalTokensConsumed = 0;
    private totalTokensSaved = 0;
    private latencies: number[] = [];

    constructor(options?: TokenTrackerOptions) {
        this.costPerThousand = options?.costPerThousandTokensUsd ?? 0.003;
        this.baselineTokensPerQuery = options?.baselineTokensPerQuery ?? 450;
    }


    public estimateTokens(text: string): number {
        if (!text || text.trim().length === 0) return 0;
        const normalized = text.trim();
        // Word count based heuristic combined with character length
        const words = normalized.split(/\s+/).length;
        const chars = normalized.length;
        // Average token is ~4 chars in English, ~3.3 in agglutinative Turkish
        const charBased = Math.ceil(chars / 3.6);
        const wordBased = Math.ceil(words * 1.3);
        return Math.max(charBased, wordBased, 1);
    }


    public trackQuery(event: {
        source: ResponseMetrics['source'];
        userPrompt: string;
        answer?: string | undefined;
        usage?: { promptTokens: number; completionTokens: number } | undefined;
        latencyMs: number;
    }): ResponseMetrics {
        this.totalQueries++;
        this.latencies.push(event.latencyMs);
        if (this.latencies.length > 5000) {
            this.latencies.splice(0, 1000); // sliding window
        }

        let tokensConsumed = 0;
        let tokensSaved = 0;

        switch (event.source) {
            case 'CACHE':
                this.cacheHits++;
                tokensSaved = this.baselineTokensPerQuery;
                break;
            case 'FAQ':
                this.faqHits++;
                tokensSaved = this.baselineTokensPerQuery;
                break;
            case 'TOOL_EXECUTION':
                this.smlToolHits++;
                // SML handles native routing, but argument extraction may consume ~100 tokens
                if (event.usage) {
                    tokensConsumed = event.usage.promptTokens + event.usage.completionTokens;
                } else {
                    tokensConsumed = this.estimateTokens(event.userPrompt) + 40;
                }
                tokensSaved = Math.max(0, this.baselineTokensPerQuery - tokensConsumed);
                break;
            case 'SECURITY_BLOCKED':
                this.securityBlocked++;
                tokensSaved = this.baselineTokensPerQuery;
                break;
            case 'LLM_RAG':
            default:
                this.llmCalls++;
                if (event.usage) {
                    tokensConsumed = event.usage.promptTokens + event.usage.completionTokens;
                } else {
                    const promptEst = this.estimateTokens(event.userPrompt) + 250; // Context docs + rules
                    const completionEst = this.estimateTokens(event.answer || '');
                    tokensConsumed = promptEst + completionEst;
                }
                break;
        }

        this.totalTokensConsumed += tokensConsumed;
        this.totalTokensSaved += tokensSaved;

        const estimatedCostSavedUsd = Number(((tokensSaved / 1000) * this.costPerThousand).toFixed(6));

        return {
            tokensConsumed,
            tokensSaved,
            estimatedCostSavedUsd,
            latencyMs: event.latencyMs,
            source: event.source
        };
    }

    public recordFullQuery(promptTokens: number, completionTokens: number, latencyMs: number): void {
        this.trackQuery({
            source: 'LLM_RAG',
            userPrompt: 'prompt',
            usage: { promptTokens, completionTokens },
            latencyMs
        });
    }

    public getSummary(): EngineMetricsSummary {
        const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
        const count = sortedLatencies.length;

        const avgMs = count > 0 ? Number((this.latencies.reduce((a, b) => a + b, 0) / count).toFixed(2)) : 0;
        const minMs = count > 0 ? sortedLatencies[0]! : 0;
        const maxMs = count > 0 ? sortedLatencies[count - 1]! : 0;
        const p50Index = count > 0 ? Math.min(Math.floor(count * 0.50), count - 1) : 0;
        const p50Ms = count > 0 ? sortedLatencies[p50Index]! : 0;
        const p95Index = count > 0 ? Math.min(Math.floor(count * 0.95), count - 1) : 0;
        const p95Ms = count > 0 ? sortedLatencies[p95Index]! : 0;

        const zeroTokenQueries = this.cacheHits + this.faqHits + this.securityBlocked;
        const zeroTokenRate =
            this.totalQueries > 0
                ? `${((zeroTokenQueries / this.totalQueries) * 100).toFixed(1)}%`
                : '0.0%';

        const estimatedCostUsd = Number(((this.totalTokensConsumed / 1000) * this.costPerThousand).toFixed(4));
        const estimatedCostSavedUsd = Number(((this.totalTokensSaved / 1000) * this.costPerThousand).toFixed(4));

        return {
            totalQueries: this.totalQueries,
            cacheHits: this.cacheHits,
            faqHits: this.faqHits,
            smlToolHits: this.smlToolHits,
            llmCalls: this.llmCalls,
            securityBlocked: this.securityBlocked,
            zeroTokenRate,
            tokensConsumed: this.totalTokensConsumed,
            tokensSaved: this.totalTokensSaved,
            estimatedCostUsd,
            estimatedCostSavedUsd,
            latency: {
                avgMs,
                minMs,
                maxMs,
                p50Ms,
                p95Ms
            }
        };
    }

    public reset(): void {
        this.totalQueries = 0;
        this.cacheHits = 0;
        this.faqHits = 0;
        this.smlToolHits = 0;
        this.llmCalls = 0;
        this.securityBlocked = 0;
        this.totalTokensConsumed = 0;
        this.totalTokensSaved = 0;
        this.latencies = [];
    }
}
