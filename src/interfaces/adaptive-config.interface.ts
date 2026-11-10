import type { StrategyId } from './strategy.interface.js';
import type { EvidenceFusionConfig } from './evidence.interface.js';

/**
 * Execution mode for adaptive query planning and strategy orchestration.
 */
export type AdaptiveExecutionMode = 'auto' | 'manual' | 'auto-hybrid' | 'fallback';

/**
 * Fine-grained per-strategy configuration options and parameter overrides.
 */
export interface StrategySpecificConfig {
    /** Whether this specific strategy is enabled in the registry. */
    enabled?: boolean | undefined;
    /** Execution priority relative to other strategies (higher = preferred). */
    priority?: number | undefined;
    /** Fusion weight applied during Reciprocal Rank Fusion (RRF). */
    weight?: number | undefined;
    /** Top K retrieval budget for this strategy. */
    topK?: number | undefined;
    /** Minimum similarity score threshold for evidence acceptance. */
    similarityThreshold?: number | undefined;
    /** Graph traversal depth (hops) when applicable. */
    maxHops?: number | undefined;
    /** Strategy-specific custom parameters. */
    options?: Record<string, unknown> | undefined;
}

export interface AdaptiveIntelligenceConfig {
    /**
     * Master switch for the Adaptive Multi-Strategy Intelligence Architecture.
     * When false or omitted, RAGEngine defaults strictly to the legacy RAG pipeline.
     */
    enabled: boolean;

    /**
     * Strategy selection mode:
     * - `auto`: Automatically select the single optimal strategy.
     * - `manual`: Run only explicitly requested strategy via context/config.
     * - `auto-hybrid`: Concurrently execute multiple complementary strategies and fuse evidence.
     * - `fallback`: Attempt strategies in a configured priority chain until sufficient evidence is found.
     */
    mode?: AdaptiveExecutionMode | undefined;

    /**
     * Explicit strategy toggle and fine-grained parameters.
     */
    strategies?: Partial<Record<StrategyId, boolean | StrategySpecificConfig>> | undefined;

    /**
     * Strategy priority overrides (higher number = higher execution preference).
     */
    priorities?: Partial<Record<StrategyId, number>> | undefined;

    /**
     * Maximum parallel strategy executions. Defaults to 3.
     */
    maxParallelOperations?: number | undefined;

    /**
     * Maximum recursive reasoning depth (for KAG and multi-hop). Defaults to 2.
     */
    maxReasoningDepth?: number | undefined;

    /**
     * Maximum graph traversal depth (hops) for Knowledge Graph and GraphRAG. Defaults to 2.
     */
    graphTraversalDepth?: number | undefined;

    /**
     * Maximum step iterations for Agentic RAG. Defaults to 5.
     */
    agentStepLimit?: number | undefined;

    /**
     * Maximum execution time before canceling remaining operations (in milliseconds).
     */
    latencyDeadlineMs?: number | undefined;

    /**
     * Cost budget per query in abstract units or USD.
     */
    costBudgetPerQuery?: number | undefined;

    /**
     * Fallback strategy sequence when primary strategies yield insufficient evidence or fail.
     */
    fallbackChain?: StrategyId[] | undefined;

    /**
     * Multi-strategy evidence fusion and ranking parameters.
     */
    fusion?: EvidenceFusionConfig | undefined;

    /**
     * Whether request-level QueryContext is permitted to override strategy selection.
     * Security Rule: QueryContext overrides can NEVER re-enable a strategy disabled by tenant/system policy.
     */
    allowRequestOverrides?: boolean | undefined;

    /**
     * Strategy telemetry and decision explanation tracing.
     */
    observability?: {
        logDecisions?: boolean | undefined;
        traceTraversals?: boolean | undefined;
    } | undefined;
}

export interface StrategyDecisionExplanation {
    selectedStrategies: StrategyId[];
    rejectedStrategies: Array<{ strategyId: StrategyId; reason: string }>;
    mode: AdaptiveExecutionMode;
    reasons: string[];
    confidence: number;
    estimatedCost: number;
    estimatedLatencyMs: number;
    fallbackChain: StrategyId[];
}

