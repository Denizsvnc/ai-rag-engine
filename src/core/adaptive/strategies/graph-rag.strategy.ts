import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IGraphAdapter } from '../../../interfaces/graph.interface.js';
import type { IVectorStoreAdapter } from '../../../interfaces/vector.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Strategy combining multi-hop local entity graph expansion with linked unstructured vector text chunks.
 *
 * @remarks
 * Architecture & Scope:
 * - Implements **Local GraphRAG**: Performs seed entity discovery followed by BFS neighborhood traversal
 *   up to `traversalDepth` hops, joining structural graph relations with corresponding vector chunks linked
 *   via `sourceChunkId` or `sourceDocId`.
 * - Does NOT perform offline global community-level summarization (hierarchical Leiden clustering). For global
 *   thematic queries without entity anchors, use `SemanticGraphStrategy` or `HybridSearchStrategy`.
 *
 * @example
 * ```typescript
 * import { GraphRAGStrategy, MemoryGraphAdapter, MemoryVectorAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const graph = new MemoryGraphAdapter();
 * const vector = new MemoryVectorAdapter();
 * const strategy = new GraphRAGStrategy(graph, vector);
 *
 * const result = await strategy.execute({
 *   query: 'How does system architecture relate to failure recovery?',
 *   tenantId: 'tenant_1'
 * });
 * ```
 */
export class GraphRAGStrategy implements IStrategy {
    /**
     * Capability metadata declaring graph and vector store dependencies, latency, and cost estimates.
     */
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'graph_rag',
        name: 'GraphRAG (Local Entity Expansion + Linked Chunks)',
        description: 'Multi-hop graph neighborhood expansion combined with linked unstructured text chunk retrieval.',
        category: 'knowledge',
        supportsStreaming: true,
        supportsMultiTenant: true,
        requiresGraphIndex: true,
        requiresVectorStore: true,
        requiresToolRegistry: false,
        typicalLatencyMs: 90,
        estimatedCostPerQuery: 0.0025
    };

    /**
     * Creates an instance of GraphRAGStrategy.
     *
     * @param graphStore - Graph adapter for structural relationships.
     * @param vectorStore - Vector adapter for raw text chunk retrieval.
     * @param enabled - Whether the strategy is enabled in query planning.
     */
    constructor(
        private readonly graphStore?: IGraphAdapter | undefined,
        private readonly vectorStore?: IVectorStoreAdapter | undefined,
        private readonly enabled: boolean = true
    ) {}

    /**
     * Checks if the strategy is enabled and both graph and vector adapters are available.
     *
     * @returns True if enabled and all store dependencies are present.
     */
    public isEnabled(): boolean {
        return this.enabled && !!this.graphStore && !!this.vectorStore;
    }

    /**
     * Evaluates runtime availability against the execution context.
     *
     * @param context - Strategy execution context.
     * @returns Promise resolving to true if dependencies are satisfied.
     */
    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.isEnabled();
    }

    /**
     * Estimates monetary cost in USD for query execution.
     *
     * @param context - Execution context.
     * @returns Estimated cost per query.
     */
    public estimateCost(context: StrategyExecutionContext): number {
        return this.metadata.estimatedCostPerQuery;
    }

    /**
     * Estimates expected latency in milliseconds.
     *
     * @param context - Execution context.
     * @returns Typical latency in ms.
     */
    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    /**
     * Executes GraphRAG dual retrieval (graph paths + vector chunks).
     *
     * @param context - Execution context including query, tenantId, and topK.
     * @returns Execution result containing fused graph relation and boosted text chunk evidence.
     */
    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        if (!this.graphStore || !this.vectorStore) {
            return {
                strategyId: 'graph_rag',
                success: false,
                executionTimeMs: 0,
                evidence: [],
                confidence: 0,
                error: 'GraphRAG requires both inputs.graph and inputs.vectorStore.'
            };
        }

        const maxHops = Math.min(context.traversalDepth ?? 2, 3);
        const topK = context.topK ?? 4;
        const seedNodes = await this.graphStore.searchNodes(context.query, context.tenantId, 3);
        const evidence: EvidenceItem[] = [];
        const linkedChunkIds = new Set<string>();
        const traversalPaths: string[][] = [];

        for (const seed of seedNodes) {
            const neighborhood = await this.graphStore.getNeighbors(seed.id, context.tenantId, {
                maxDepth: maxHops,
                maxNodes: 12
            });

            // 1. Structural graph path evidence
            for (const edge of neighborhood.edges) {
                const src = neighborhood.nodes.find(n => n.id === edge.sourceId);
                const tgt = neighborhood.nodes.find(n => n.id === edge.targetId);
                const pathStr = `${src?.name || edge.sourceId} -[${edge.relation}]-> ${tgt?.name || edge.targetId}`;
                traversalPaths.push([src?.name || edge.sourceId, edge.relation, tgt?.name || edge.targetId]);

                if (edge.sourceChunkId) linkedChunkIds.add(edge.sourceChunkId);

                evidence.push({
                    id: `graphrag_rel_${edge.id}`,
                    strategyId: 'graph_rag',
                    sourceDocId: edge.sourceDocId || 'graphrag_doc',
                    sourceChunkId: edge.sourceChunkId,
                    sourceRevision: edge.revision,
                    tenantId: context.tenantId,
                    content: `Graph Relation: ${pathStr}`,
                    score: 0.85,
                    evidenceType: 'graph_path',
                    traversalPath: [src?.name || edge.sourceId, edge.relation, tgt?.name || edge.targetId]
                });
            }

            for (const n of neighborhood.nodes) {
                if (n.sourceChunkId) linkedChunkIds.add(n.sourceChunkId);
            }
        }

        // 2. Linked raw text chunk retrieval from vector store
        const vectorResults = await this.vectorStore.search(context.query, topK, { tenantId: context.tenantId });
        for (const doc of vectorResults) {
            const docIdFromMeta = typeof doc.metadata?.documentId === 'string' ? doc.metadata.documentId : undefined;
            const isGraphLinked = linkedChunkIds.has(doc.id) || (docIdFromMeta !== undefined && linkedChunkIds.has(docIdFromMeta));
            const boost = isGraphLinked ? 0.20 : 0.0;

            evidence.push({
                id: `graphrag_chunk_${doc.id}`,
                strategyId: 'graph_rag',
                sourceDocId: docIdFromMeta || doc.id,
                sourceChunkId: doc.id,
                sourceRevision: doc.version,
                tenantId: context.tenantId,
                content: doc.content,
                score: Math.min(1.0, (doc.score ?? 0.6) + boost),
                rawScore: doc.score,
                evidenceType: 'text_chunk',
                traversalPath: traversalPaths.length > 0 ? traversalPaths[0] : undefined,
                metadata: { ...doc.metadata, graphLinked: isGraphLinked }
            });
        }

        return {
            strategyId: 'graph_rag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? 0.92 : 0.30
        };
    }
}

