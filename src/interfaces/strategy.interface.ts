/**
 * Strategy identifiers and operational capabilities for Adaptive Multi-Strategy Intelligence.
 */

/**
 * Unique identifiers for all 9 supported retrieval, reasoning, and caching strategies.
 */
export type StrategyId =
    | 'traditional_rag'
    | 'cag'
    | 'kag'
    | 'semantic_graph'
    | 'knowledge_graph'
    | 'graph_rag'
    | 'semantic_search'
    | 'hybrid_search'
    | 'agentic_rag';

/** High-level operational category of an execution strategy. */
export type StrategyCategory = 'retrieval' | 'reasoning' | 'knowledge' | 'cache' | 'agent';

/**
 * Fine-grained operational outcome of strategy execution.
 */
export type StrategyExecutionOutcome =
    | 'SUCCESS'
    | 'FAILED'
    | 'TIMED_OUT'
    | 'CANCELLED'
    | 'UNAVAILABLE'
    | 'BUDGET_EXCEEDED';

/**
 * Capability and dependency metadata declared by each strategy.
 */
export interface StrategyCapabilityMetadata {
    /** Unique strategy identifier. */
    id: StrategyId;
    /** Human-readable strategy name. */
    name: string;
    /** Descriptive explanation of how this strategy retrieves or deduces answers. */
    description: string;
    /** Operational category. */
    category: StrategyCategory;
    /** Whether the strategy supports progressive token streaming. */
    supportsStreaming: boolean;
    /** Whether the strategy strictly isolates data by tenant. */
    supportsMultiTenant: boolean;
    /** Whether the strategy requires an initialized `IGraphAdapter`. */
    requiresGraphIndex: boolean;
    /** Whether the strategy requires an initialized `IVectorStoreAdapter`. */
    requiresVectorStore: boolean;
    /** Whether the strategy requires an initialized `ToolRegistry`. */
    requiresToolRegistry: boolean;
    /** Typical execution latency in milliseconds under normal load. */
    typicalLatencyMs: number;
    /** Estimated execution cost in USD or abstract budget units per query. */
    estimatedCostPerQuery: number;
}

/**
 * Execution parameters and constraints delivered to a strategy during query evaluation.
 */
export interface StrategyExecutionContext {
    /** User query or question text. */
    query: string;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** Optional requesting user ID. */
    userId?: string | undefined;
    /** Requesting user RBAC roles. */
    roles?: string[] | undefined;
    /** Abort signal for latency deadline or client cancellation. */
    signal?: AbortSignal | undefined;
    /** Epoch timestamp deadline after which execution must abort. */
    deadline?: number | undefined;
    /** FinOps cost budget limit for this operation. */
    budgetLimit?: number | undefined;
    /** Graph traversal hop limit. */
    traversalDepth?: number | undefined;
    /** Top K retrieval budget. */
    topK?: number | undefined;
    /** Minimum similarity score threshold for evidence acceptance. */
    similarityThreshold?: number | undefined;
    /** Caller-supplied metadata. */
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Structured output returned by strategy execution.
 */
export interface StrategyExecutionResult {
    /** Identifier of the strategy that produced this result. */
    strategyId: StrategyId;
    /** Whether the strategy successfully retrieved evidence or drafted an answer. */
    success: boolean;
    /** Execution latency in milliseconds. */
    executionTimeMs: number;
    /** Array of structured evidence items retrieved. */
    evidence: import('./evidence.interface.js').EvidenceItem[];
    /** Strategy-specific intermediate state or reasoning traces. */
    intermediateData?: Record<string, unknown> | undefined;
    /** Optional pre-synthesized answer draft (e.g. from CAG or exact tool match). */
    answerDraft?: string | undefined;
    /** Calibrated confidence score in range [0.0 - 1.0]. */
    confidence: number;
    /** Fine-grained execution outcome status. */
    outcome?: StrategyExecutionOutcome | undefined;
    /** Error message if the strategy failed. */
    error?: string | undefined;
    /** Telemetry metrics gathered during execution. */
    telemetry?: {
        tokensUsed?: number | undefined;
        nodesTraversed?: number | undefined;
        cacheHit?: boolean | undefined;
        toolCallsCount?: number | undefined;
        nativeKvUsed?: boolean | undefined;
    } | undefined;
}

/**
 * Pluggable strategy contract implemented by all adaptive retrieval, reasoning, and caching engines.
 */
export interface IStrategy {
    /** Capability metadata and system dependencies. */
    readonly metadata: StrategyCapabilityMetadata;
    /** Returns whether the strategy is currently enabled by configuration. */
    isEnabled(): boolean;
    /** Verifies runtime availability (e.g. storage connectivity, data existence). */
    isAvailable(context: StrategyExecutionContext): Promise<boolean>;
    /** Estimates cost for the given execution context. */
    estimateCost(context: StrategyExecutionContext): number;
    /** Estimates expected latency in milliseconds for the given context. */
    estimateLatency(context: StrategyExecutionContext): number;
    /** Executes the strategy and returns structured evidence and confidence metrics. */
    execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult>;
    /** Optional cleanup hook invoked on engine shutdown. */
    cleanup?(): Promise<void>;
}

