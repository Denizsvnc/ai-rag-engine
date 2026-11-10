import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IVectorStoreAdapter } from '../../../interfaces/vector.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Pure semantic search strategy focused on multilingual vector similarity without full RAG synthesis.
 */
export class SemanticSearchStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'semantic_search',
        name: 'Semantic Search',
        description: 'Dense vector semantic search focused on conceptual paraphrases and multilingual vector space alignment.',
        category: 'retrieval',
        supportsStreaming: true,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: true,
        requiresToolRegistry: false,
        typicalLatencyMs: 35,
        estimatedCostPerQuery: 0.0008
    };

    constructor(
        private readonly vectorStore?: IVectorStoreAdapter | null | undefined,
        private readonly enabled: boolean = true
    ) {}

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async isAvailable(context: StrategyExecutionContext): Promise<boolean> {
        return this.enabled && !!this.vectorStore;
    }

    public estimateCost(context: StrategyExecutionContext): number {
        return this.metadata.estimatedCostPerQuery;
    }

    public estimateLatency(context: StrategyExecutionContext): number {
        return this.metadata.typicalLatencyMs;
    }

    public async execute(context: StrategyExecutionContext): Promise<StrategyExecutionResult> {
        const startTime = Date.now();
        const topK = context.topK ?? 4;
        const threshold = context.similarityThreshold ?? 0.35;

        if (context.signal?.aborted) {
            throw context.signal.reason || new Error('Aborted');
        }

        if (!this.vectorStore) {
            return {
                strategyId: 'semantic_search',
                success: false,
                executionTimeMs: Date.now() - startTime,
                evidence: [],
                confidence: 0,
                error: 'VectorStore not configured'
            };
        }

        const filter: Record<string, unknown> = { tenantId: context.tenantId };
        const docs = await this.vectorStore.search(context.query, topK * 2, filter);

        const evidence: EvidenceItem[] = docs
            .filter(d => (d.score ?? 0) >= threshold)
            .slice(0, topK)
            .map(d => ({
                id: `semantic_${d.id}`,
                strategyId: 'semantic_search',
                sourceDocId: typeof d.metadata?.documentId === 'string' ? d.metadata.documentId : d.id,
                sourceChunkId: d.id,
                sourceRevision: d.version,
                tenantId: context.tenantId,
                content: d.content,
                score: Math.min(1.0, Math.max(0.0, d.score ?? 0.5)),
                rawScore: d.score,
                evidenceType: 'text_chunk',
                extractionProvenance: { method: 'vector_cosine' },
                metadata: d.metadata
            }));

        return {
            strategyId: 'semantic_search',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? (evidence[0]?.score ?? 0.75) : 0.25
        };
    }
}

