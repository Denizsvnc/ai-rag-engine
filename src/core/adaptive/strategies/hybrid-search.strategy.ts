import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IVectorStoreAdapter } from '../../../interfaces/vector.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Hybrid search strategy executing parallel dense vector and sparse BM25 retrieval fused via RRF.
 */
export class HybridSearchStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'hybrid_search',
        name: 'Hybrid Search (Dense + BM25 RRF)',
        description: 'Combines dense semantic vector retrieval with sparse BM25 keyword matching via Reciprocal Rank Fusion.',
        category: 'retrieval',
        supportsStreaming: true,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: true,
        requiresToolRegistry: false,
        typicalLatencyMs: 40,
        estimatedCostPerQuery: 0.0012
    };

    constructor(
        private readonly vectorStore: IVectorStoreAdapter,
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
        const topK = context.topK ?? 5;

        if (context.signal?.aborted) {
            throw context.signal.reason || new Error('Aborted');
        }

        const filter: Record<string, unknown> = { tenantId: context.tenantId };
        let docs: import('../../../interfaces/vector.interface.js').VectorDocument[] = [];

        if (typeof this.vectorStore.searchHybrid === 'function') {
            docs = await this.vectorStore.searchHybrid(context.query, topK, filter);
        } else {
            docs = await this.vectorStore.search(context.query, topK, filter);
        }

        const evidence: EvidenceItem[] = docs.map(d => ({
            id: `hybrid_${d.id}`,
            strategyId: 'hybrid_search',
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
            strategyId: 'hybrid_search',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? 0.85 : 0.3
        };
    }
}

