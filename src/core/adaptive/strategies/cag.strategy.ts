import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { ICacheAdapter } from '../../../interfaces/cache.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';
import { CacheIdentity } from '../../security/cache-identity.js';

/**
 * Backing cache tier taxonomy utilized by Cache-Augmented Generation (CAG).
 */
export type CAGCacheType =
    | 'in_memory_lru'
    | 'redis_distributed'
    | 'response_cache'
    | 'semantic_cache'
    | 'prompt_prefix_cache'
    | 'provider_managed_cache'
    | 'native_model_kv';

/**
 * Options for configuring CAGStrategy.
 */
export interface CAGStrategyOptions {
    /** Whether strategy is enabled. */
    enabled?: boolean | undefined;
    /** Declared or preferred cache architecture tier. */
    cacheType?: CAGCacheType | undefined;
    /**
     * Whether the active model provider genuinely supports hardware/native KV-cache reuse.
     * Defaults to `false` unless explicitly negotiated with an LLM provider supporting KV cache.
     */
    nativeKvCapability?: boolean | undefined;
    /** HMAC signing secret for cryptographic cache key generation. */
    signingSecret?: string | undefined;
}

/**
 * Cache-Augmented Generation (CAG) strategy for zero-token instantaneous answer resolution.
 *
 * @remarks
 * Evaluates multi-dimensional cryptographic cache keys against memory LRU, distributed Redis,
 * or prompt-prefix caches. When an authorized hit occurs, returns an immediate answer draft.
 * Strictly separates response caching from genuine native KV-cache acceleration.
 */
export class CAGStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'cag',
        name: 'Cache-Augmented Generation (CAG)',
        description: 'Multi-dimensional cryptographic cache lookup with strict role, tenant, and revision isolation.',
        category: 'cache',
        supportsStreaming: false,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: false,
        requiresToolRegistry: false,
        typicalLatencyMs: 2,
        estimatedCostPerQuery: 0.0
    };

    private readonly enabled: boolean;
    private readonly cacheType: CAGCacheType;
    private readonly nativeKvCapability: boolean;
    private readonly signingSecret: string | undefined;

    constructor(
        private readonly cacheAdapter?: ICacheAdapter | undefined,
        optionsOrEnabled: boolean | CAGStrategyOptions = true,
        legacyCacheType: CAGCacheType = 'in_memory_lru'
    ) {
        if (typeof optionsOrEnabled === 'boolean') {
            this.enabled = optionsOrEnabled;
            this.cacheType = legacyCacheType;
            this.nativeKvCapability = false;
            this.signingSecret = undefined;
        } else {
            this.enabled = optionsOrEnabled.enabled ?? true;
            this.cacheType = optionsOrEnabled.cacheType || legacyCacheType;
            this.nativeKvCapability = Boolean(optionsOrEnabled.nativeKvCapability);
            this.signingSecret = optionsOrEnabled.signingSecret;
        }
    }

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
     * Executes Cache-Augmented Generation retrieval with multi-dimensional authorization scoping.
     * Enforces genuine capability negotiation for native KV-cache claims.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.cacheAdapter) {
            return {
                strategyId: 'cag',
                success: false,
                executionTimeMs: 0,
                evidence: [],
                confidence: 0,
                error: 'Cache adapter not configured'
            };
        }

        // 1. Determine effective capability: only report native KV if genuinely supported by provider
        const effectiveNativeKv = this.cacheType === 'native_model_kv' && this.nativeKvCapability;
        const effectiveCacheTier: CAGCacheType =
            this.cacheType === 'native_model_kv' && !this.nativeKvCapability
                ? 'response_cache' // Degrade gracefully from unverified claim to actual response cache
                : this.cacheType;

        // 2. Build multi-dimensional cryptographic cache key
        const cacheKey = CacheIdentity.buildCacheKey({
            tenantId: context.tenantId,
            query: context.query,
            roles: context.roles,
            userId: context.userId,
            documentRevision: (context.metadata?.['documentRevision'] as string | number | undefined),
            graphRevision: (context.metadata?.['graphRevision'] as string | number | undefined),
            policyVersion: (context.metadata?.['policyVersion'] as string | number | undefined),
            modelId: (context.metadata?.['modelId'] as string | undefined),
            strategyConfigVersion: (context.metadata?.['strategyConfigVersion'] as string | number | undefined),
            cacheScope: 'cag'
        }, this.signingSecret);

        const cached = await this.cacheAdapter.get(cacheKey);

        if (cached) {
            const evidence: EvidenceItem[] = [{
                id: `cag_hit_${Date.now()}`,
                strategyId: 'cag',
                sourceDocId: 'cache_store',
                tenantId: context.tenantId,
                content: typeof cached === 'string' ? cached : JSON.stringify(cached),
                score: 1.0,
                evidenceType: 'cached_prefix',
                extractionProvenance: { method: 'rule_assertion', confidence: 1.0 },
                metadata: {
                    cacheType: effectiveCacheTier,
                    nativeKvSupported: effectiveNativeKv,
                    cacheKey
                }
            }];

            const answerDraft = typeof cached === 'string'
                ? cached
                : (typeof cached === 'object' && cached !== null && 'answer' in cached && typeof (cached as { answer: unknown }).answer === 'string'
                    ? (cached as { answer: string }).answer
                    : undefined);

            return {
                strategyId: 'cag',
                success: true,
                executionTimeMs: Date.now() - startTime,
                evidence,
                ...(answerDraft ? { answerDraft } : {}),
                confidence: 1.0,
                telemetry: {
                    cacheHit: true,
                    tokensUsed: 0,
                    nativeKvUsed: effectiveNativeKv
                }
            };
        }

        // Cache miss: do NOT fabricate an answerDraft or report false confidence
        return {
            strategyId: 'cag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence: [],
            confidence: 0.0,
            telemetry: { cacheHit: false, tokensUsed: 0, nativeKvUsed: false }
        };
    }
}
