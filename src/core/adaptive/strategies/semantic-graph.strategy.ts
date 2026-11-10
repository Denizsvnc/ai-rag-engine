import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IGraphAdapter } from '../../../interfaces/graph.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Strategy implementation exploring conceptual clusters and semantic relations via knowledge graph.
 *
 * @remarks
 * Discovers seed entities using lexical or semantic node matching, traverses the knowledge
 * graph up to configured neighborhood depth, and projects traversed entity nodes into
 * normalized evidence items for multi-strategy fusion.
 *
 * @example
 * ```typescript
 * import { SemanticGraphStrategy, MemoryGraphAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const graphAdapter = new MemoryGraphAdapter();
 * const strategy = new SemanticGraphStrategy(graphAdapter);
 *
 * const result = await strategy.execute({
 *   query: 'Find connections to quantum computing',
 *   tenantId: 'org_123',
 *   traversalDepth: 2
 * });
 * ```
 */
export class SemanticGraphStrategy implements IStrategy {
    /**
     * Capability metadata declaring graph requirements, latency, and cost estimates.
     */
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'semantic_graph',
        name: 'Semantic Graph',
        description: 'Explores conceptual clusters and semantic similarity relations between entities and documents.',
        category: 'knowledge',
        supportsStreaming: false,
        supportsMultiTenant: true,
        requiresGraphIndex: true,
        requiresVectorStore: false,
        requiresToolRegistry: false,
        typicalLatencyMs: 60,
        estimatedCostPerQuery: 0.0015
    };

    /**
     * Creates an instance of SemanticGraphStrategy.
     *
     * @param graphStore - Underlying graph store adapter (or null/undefined if absent).
     * @param enabled - Whether the strategy is enabled in the query planner.
     */
    constructor(
        private readonly graphStore?: IGraphAdapter | null | undefined,
        private readonly enabled: boolean = true
    ) {}

    /**
     * Determines whether the strategy is enabled and has a configured graph store.
     *
     * @returns True if enabled and graph store is available.
     */
    public isEnabled(): boolean {
        return this.enabled && !!this.graphStore;
    }

    /**
     * Evaluates runtime availability against current execution context.
     *
     * @param context - Execution context containing query and tenant ID.
     * @returns Promise resolving to true if available.
     */
    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.isEnabled();
    }

    /**
     * Estimates monetary cost in USD for running the strategy.
     *
     * @param context - Execution context.
     * @returns Estimated cost per query.
     */
    public estimateCost(context: StrategyExecutionContext): number {
        return this.metadata.estimatedCostPerQuery;
    }

    /**
     * Estimates typical execution latency in milliseconds.
     *
     * @param context - Execution context.
     * @returns Typical latency in ms.
     */
    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    /**
     * Executes semantic graph traversal for the given query.
     *
     * @param context - Execution context with query, tenantId, and optional traversalDepth.
     * @returns Execution result with graph entity evidence items and confidence score.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.graphStore) {
            return { strategyId: 'semantic_graph', success: false, executionTimeMs: 0, evidence: [], confidence: 0, error: 'Graph store not configured' };
        }

        const maxHops = context.traversalDepth ?? 2;
        const matchingNodes = await this.graphStore.searchNodes(context.query, context.tenantId, 3);
        const evidence: EvidenceItem[] = [];

        for (const seedNode of matchingNodes) {
            const neighborhood = await this.graphStore.getNeighbors(seedNode.id, context.tenantId, {
                maxDepth: maxHops,
                maxNodes: 10
            });

            for (const node of neighborhood.nodes) {
                evidence.push({
                    id: `sem_graph_node_${node.id}`,
                    strategyId: 'semantic_graph',
                    sourceDocId: node.sourceDocId || node.id,
                    sourceChunkId: node.sourceChunkId,
                    sourceRevision: node.revision,
                    tenantId: context.tenantId,
                    content: `Concept: ${node.name} (Type: ${node.type}) - ${JSON.stringify(node.properties || {})}`,
                    score: node.confidence,
                    evidenceType: 'graph_entity',
                    extractionProvenance: { method: 'vector_cosine', confidence: node.confidence }
                });
            }
        }

        return {
            strategyId: 'semantic_graph',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? 0.8 : 0.2
        };
    }
}

