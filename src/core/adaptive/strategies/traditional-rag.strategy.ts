import type { IStrategy, StrategyCapabilityMetadata, StrategyExecutionContext, StrategyExecutionResult } from '../../../interfaces/strategy.interface.js';
import type { IVectorStoreAdapter } from '../../../interfaces/vector.interface.js';
import type { EvidenceItem } from '../../../interfaces/evidence.interface.js';

/**
 * Traditional dense retrieval strategy using cosine similarity against document chunk embeddings.
 */
export class TraditionalRAGStrategy implements IStrategy {
    public readonly metadata: StrategyCapabilityMetadata = {
        id: 'traditional_rag',
        name: 'Traditional RAG',
        description: 'Standard dense embedding retrieval using vector similarity against indexed document chunks.',
        category: 'retrieval',
        supportsStreaming: true,
        supportsMultiTenant: true,
        requiresGraphIndex: false,
        requiresVectorStore: true,
        requiresToolRegistry: false,
        typicalLatencyMs: 45,
        estimatedCostPerQuery: 0.001
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
        const topK = context.topK ?? 5;
        const threshold = context.similarityThreshold ?? 0.0;

        if (context.signal?.aborted) {
            throw context.signal.reason || new Error('Aborted');
        }

        if (!this.vectorStore) {
            return {
                strategyId: 'traditional_rag',
                success: false,
                executionTimeMs: Date.now() - startTime,
                evidence: [],
                confidence: 0,
                error: 'VectorStore not configured'
            };
        }

        const filter: Record<string, unknown> = { tenantId: context.tenantId };
        const docs = await this.vectorStore.search(context.query, topK, filter);

        const evidence: EvidenceItem[] = docs
            .filter(d => (d.score ?? 0) >= threshold)
            .map(d => ({
                id: `trad_rag_${d.id}`,
                strategyId: 'traditional_rag',
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
            strategyId: 'traditional_rag',
            success: true,
            executionTimeMs: Date.now() - startTime,
            evidence,
            confidence: evidence.length > 0 ? (evidence[0]?.score ?? 0.7) : 0.2
        };
    }
}

