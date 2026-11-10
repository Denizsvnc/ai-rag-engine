/**
 * Metrics recorded for an individual query response.
 */
export interface ResponseMetrics {
    /** Tokens consumed by this query execution. */
    tokensConsumed: number;
    /** Tokens saved via cache, FAQ offloading, or rule rejection. */
    tokensSaved: number;
    /** Estimated financial savings in USD. */
    estimatedCostSavedUsd: number;
    /** Latency in milliseconds. */
    latencyMs: number;
    /** Origin resolution source of the answer. */
    source: 'CACHE' | 'FAQ' | 'TOOL_EXECUTION' | 'LLM_RAG' | 'SECURITY_BLOCKED';
}

/**
 * Aggregated runtime performance, latency percentiles, and cost savings metrics summary.
 */
export interface EngineMetricsSummary {
    /** Total number of queries processed. */
    totalQueries: number;
    /** Total queries resolved via exact semantic cache. */
    cacheHits: number;
    /** Total queries resolved via fast FAQ match. */
    faqHits: number;
    /** Total queries routed to local tool execution. */
    smlToolHits: number;
    /** Total queries routed to external LLM generation. */
    llmCalls: number;
    /** Total queries rejected by security guardrails. */
    securityBlocked: number;
    /** Percentage of queries answered without consuming external LLM tokens (e.g., '65.5%'). */
    zeroTokenRate: string;
    /** Total tokens consumed across all LLM operations. */
    tokensConsumed: number;
    /** Total tokens avoided through caching and local routing. */
    tokensSaved: number;
    /** Total estimated monetary expense incurred in USD. */
    estimatedCostUsd: number;
    /** Total estimated financial savings in USD. */
    estimatedCostSavedUsd: number;
    /** Latency distribution and percentile statistics. */
    latency: {
        avgMs: number;
        minMs: number;
        maxMs: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        sumMs: number;
        count: number;
        buckets: Array<{ leMs: number; count: number }>;
    };
}

/**
 * Configuration options for token counting and financial cost estimation.
 */
export interface TokenTrackerOptions {
    /** Blended monetary cost per 1,000 tokens in USD. @defaultValue 0.003 */
    costPerThousandTokensUsd?: number;
    /** Estimated tokens required for baseline prompt+completion. @defaultValue 450 */
    baselineTokensPerQuery?: number;
}

/**
 * Real-time metric tracker monitoring token expenditure, offloading rate, and latency distributions.
 *
 * @remarks
 * Calculates token economies, tracks percentiles (p50, p95, p99), histogram latency buckets,
 * and cost savings achieved by zero-token resolution tiers (Cache, FAQ, SML).
 *
 * @example
 * ```typescript
 * import { TokenTracker } from '@denizsvnc/ai-rag-engine';
 *
 * const tracker = new TokenTracker();
 * tracker.trackQuery({
 *   source: 'CACHE',
 *   userPrompt: 'What are store hours?',
 *   latencyMs: 12
 * });
 *
 * const summary = tracker.getSummary();
 * console.log(`Zero token rate: ${summary.zeroTokenRate}`);
 * ```
 */
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
    private latencySumMs = 0;
    private readonly latencyBoundsMs = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];
    private latencyBucketCounts = this.latencyBoundsMs.map(() => 0);

    /**
     * Initializes a new TokenTracker instance.
     *
     * @param options - Tracker configuration options.
     */
    constructor(options?: TokenTrackerOptions) {
        this.costPerThousand = options?.costPerThousandTokensUsd ?? 0.003;
        this.baselineTokensPerQuery = options?.baselineTokensPerQuery ?? 450;
    }

    /**
     * Estimates token count of a given string using multilingual heuristics.
     *
     * @param text - Input text.
     * @returns Estimated token count.
     */
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

    /**
     * Records query execution event, updating counters, percentiles, and savings.
     *
     * @param event - Execution event details.
     * @returns Per-query response metrics.
     * @throws If latency is non-finite or negative.
     */
    public trackQuery(event: {
        source: ResponseMetrics['source'];
        userPrompt: string;
        answer?: string | undefined;
        usage?: { promptTokens: number; completionTokens: number } | undefined;
        latencyMs: number;
    }): ResponseMetrics {
        if (!Number.isFinite(event.latencyMs) || event.latencyMs < 0) {
            throw new Error('Latency must be finite and non-negative.');
        }
        this.latencySumMs += event.latencyMs;
        for (let i = 0; i < this.latencyBoundsMs.length; i++) {
            if (event.latencyMs <= this.latencyBoundsMs[i]!) this.latencyBucketCounts[i]!++;
        }
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
                p95Ms,
                p99Ms: count > 0 ? sortedLatencies[Math.min(Math.floor(count * 0.99), count - 1)]! : 0,
                sumMs: this.latencySumMs,
                count: this.totalQueries,
                buckets: this.latencyBoundsMs.map((leMs, index) => ({ leMs, count: this.latencyBucketCounts[index]! }))
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
        this.latencySumMs = 0;
        this.latencyBucketCounts.fill(0);
    }
}
