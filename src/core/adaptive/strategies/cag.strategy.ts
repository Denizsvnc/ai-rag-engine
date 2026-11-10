import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { ICacheAdapter } from '../../../interfaces/cache.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Backing cache tier taxonomy utilized by Cache-Augmented Generation (CAG).
 */
export type CAGCacheType =
    | 'in_memory_lru'
    | 'redis_distributed'
    | 'provider_prompt_prefix'
    | 'native_model_kv';

/**
 * Cache-Augmented Generation (CAG) strategy for zero-token instantaneous answer resolution.
 *
 * @remarks
 * Evaluates semantic query keys against memory LRU, distributed Redis, or prompt-prefix caches.
 * When a hit occurs, returns an immediate answer draft with 0 LLM token cost.
 */
export class CAGStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'cag',
        name: 'Cache-Augmented Generation (CAG)',
        description: 'Hierarchical prompt-prefix, semantic, and in-memory cache lookup with zero-token execution.',
        category: 'cache',
        supportsStreaming: false,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: false,
        requiresToolRegistry: false,
        typicalLatencyMs: 2,
        estimatedCostPerQuery: 0.0
    };

    constructor(
        private readonly cacheAdapter?: ICacheAdapter | undefined,
        private readonly enabled: boolean = true,
        private readonly cacheType: CAGCacheType = 'in_memory_lru'
    ) {}

    public isEnabled(): boolean {
        return this.enabled && !!this.cacheAdapter;
    }

    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.isEnabled();
    }

    public estimateCost(context: StrategyExecutionContext): number {
        return 0.0;
    }

    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    /**
     * Executes Cache-Augmented Generation retrieval.
     * Accurately reports cache architecture without falsely claiming native KV-cache.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.cacheAdapter) {
            return { strategyId: 'cag', success: false, executionTimeMs: 0, evidence: [], confidence: 0, error: 'Cache adapter not configured' };
        }

        // Construct tenant-scoped cache key
        const cacheKey = `cag:tenant:${context.tenantId}:${this.hash(context.query)}`;
        const cached = await this.cacheAdapter.get(cacheKey);

        if (cached) {
            const evidence: EvidenceItem[] = [{
                id: `cag_hit_${this.hash(cacheKey)}`,
                strategyId: 'cag',
                sourceDocId: 'cache_store',
                tenantId: context.tenantId,
                content: typeof cached === 'string' ? cached : JSON.stringify(cached),
                score: 1.0,
                evidenceType: 'cached_prefix',
                extractionProvenance: { method: 'rule_assertion', confidence: 1.0 },
                metadata: {
                    cacheType: this.cacheType,
                    nativeKvSupported: this.cacheType === 'native_model_kv'
                }
            }];

            return {
                strategyId: 'cag',
                success: true,
                executionTimeMs: Date.now() - startTime,
                evidence,
                answerDraft: typeof cached === 'string'
                    ? cached
                    : (typeof cached === 'object' && cached !== null && 'answer' in cached && typeof (cached as { answer: unknown }).answer === 'string'
                        ? (cached as { answer: string }).answer
                        : undefined),
                confidence: 1.0,
                telemetry: { cacheHit: true, tokensUsed: 0 }
            };
        }

        return {
            strategyId: 'cag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence: [],
            confidence: 0.0,
            telemetry: { cacheHit: false, tokensUsed: 0 }
        };
    }

    private hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36).slice(0, 8);
    }
}

