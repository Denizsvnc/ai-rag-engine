import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IGraphAdapter } from '../../../interfaces/graph.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Strategy implementation retrieving structured entity-relation-entity factual triples from a knowledge graph.
 *
 * @remarks
 * Locates seed nodes matching the user query, traverses connected edges within multi-hop depth,
 * and formats relationships into structured propositional evidence with provenance and confidence metrics.
 *
 * @example
 * ```typescript
 * import { KnowledgeGraphStrategy, MemoryGraphAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const graph = new MemoryGraphAdapter();
 * const strategy = new KnowledgeGraphStrategy(graph);
 *
 * const result = await strategy.execute({
 *   query: 'Who founded ACME Corp?',
 *   tenantId: 'tenant_default',
 *   traversalDepth: 2
 * });
 * ```
 */
export class KnowledgeGraphStrategy implements IStrategy {
    /**
     * Capability metadata declaring graph requirements, latency, and cost estimates.
     */
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'knowledge_graph',
        name: 'Knowledge Graph',
        description: 'Structured entity-relation-entity factual triple retrieval and path traversal.',
        category: 'knowledge',
        supportsStreaming: false,
        supportsMultiTenant: true,
        requiresGraphIndex: true,
        requiresVectorStore: false,
        requiresToolRegistry: false,
        typicalLatencyMs: 50,
        estimatedCostPerQuery: 0.001
    };

    /**
     * Creates an instance of KnowledgeGraphStrategy.
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
     * Executes knowledge graph relation extraction and traversal.
     *
     * @param context - Execution context with query, tenantId, and optional traversalDepth.
     * @returns Execution result containing factual triple evidence items.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.graphStore) {
            return { strategyId: 'knowledge_graph', success: false, executionTimeMs: 0, evidence: [], confidence: 0, error: 'Graph store not configured' };
        }

        const maxHops = Math.min(context.traversalDepth ?? 2, 3);
        const seedNodes = await this.graphStore.searchNodes(context.query, context.tenantId, 3);
        const evidence: EvidenceItem[] = [];

        for (const seed of seedNodes) {
            const neighborhood = await this.graphStore.getNeighbors(seed.id, context.tenantId, {
                maxDepth: maxHops,
                maxNodes: 15
            });

            // Map edges to factual propositions
            for (const edge of neighborhood.edges) {
                const src = neighborhood.nodes.find(n => n.id === edge.sourceId);
                const tgt = neighborhood.nodes.find(n => n.id === edge.targetId);
                const srcName = src?.name || edge.sourceId;
                const tgtName = tgt?.name || edge.targetId;

                evidence.push({
                    id: `kg_fact_${edge.id}`,
                    strategyId: 'knowledge_graph',
                    sourceDocId: edge.sourceDocId || 'kg_asserted',
                    sourceChunkId: edge.sourceChunkId,
                    sourceRevision: edge.revision,
                    tenantId: context.tenantId,
                    content: `Fact: (${srcName}) -[${edge.relation}]-> (${tgtName}) [Category: ${edge.category}, Confidence: ${(edge.confidence * 100).toFixed(0)}%]`,
                    score: edge.confidence,
                    evidenceType: 'graph_relation',
                    extractionProvenance: {
                        method: edge.category === 'asserted' ? 'rule_assertion' : 'llm_extraction',
                        confidence: edge.confidence
                    },
                    traversalPath: [srcName, edge.relation, tgtName]
                });
            }
        }

        return {
            strategyId: 'knowledge_graph',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? 0.90 : 0.20
        };
    }
}

