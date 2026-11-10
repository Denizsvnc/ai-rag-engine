import type { VectorDocument } from '../../interfaces/vector.interface.js';

/**
 * Vector document enriched with hybrid retrieval rank provenance and RRF score.
 */
export interface HybridScoredDocument extends VectorDocument {
    /** 1-based rank position within dense vector retrieval results (if present). */
    denseRank?: number | undefined;
    /** 1-based rank position within sparse lexical retrieval results (if present). */
    sparseRank?: number | undefined;
    /** Composite Reciprocal Rank Fusion score. */
    rrfScore: number;
}

/**
 * Reciprocal Rank Fusion (RRF) algorithm combining dense vector and sparse lexical results.
 *
 * @remarks
 * Merges heterogeneous ranking lists without requiring score scale normalization:
 * `RRF_score(d) = sum_{m in models} weight_m / (k + rank_m(d))`
 *
 * @param denseResults - Candidate documents ranked by dense vector similarity.
 * @param sparseResults - Candidate documents ranked by sparse BM25 lexical relevance.
 * @param topK - Maximum number of top-ranked documents to return. @defaultValue 3
 * @param rrfK - Smoothing constant damping the influence of high-ranking outliers. @defaultValue 60
 * @param weights - Optional weighting multiplier for dense and sparse models.
 * @returns Array of deduplicated and re-ranked {@link HybridScoredDocument} objects.
 *
 * @example
 * ```typescript
 * import { reciprocalRankFusion } from '@denizsvnc/ai-rag-engine';
 *
 * const fused = reciprocalRankFusion(vectorDocs, bm25Docs, 5, 60, {
 *   dense: 1.0,
 *   sparse: 0.8
 * });
 * ```
 */
export function reciprocalRankFusion(
    denseResults: VectorDocument[],
    sparseResults: VectorDocument[],
    topK: number = 3,
    rrfK: number = 60,
    weights?: { dense?: number; sparse?: number }
): HybridScoredDocument[] {
    const denseWeight = weights?.dense ?? 1.0;
    const sparseWeight = weights?.sparse ?? 1.0;
    const scoredDocs = new Map<
        string,
        {
            doc: VectorDocument;
            denseRank?: number | undefined;
            sparseRank?: number | undefined;
            rrfScore: number;
        }
    >();

    // 1. Process Dense Vector results
    denseResults.forEach((doc, index) => {
        const rank = index + 1;
        const key = JSON.stringify([doc.metadata?.tenantId ?? null, doc.id]);
        const existing = scoredDocs.get(key) || { doc, rrfScore: 0 };
        existing.denseRank = rank;
        existing.rrfScore += denseWeight / (rrfK + rank);
        scoredDocs.set(key, existing);
    });

    // 2. Process Sparse BM25 results
    sparseResults.forEach((doc, index) => {
        const rank = index + 1;
        const key = JSON.stringify([doc.metadata?.tenantId ?? null, doc.id]);
        const existing = scoredDocs.get(key) || { doc, rrfScore: 0 };
        existing.sparseRank = rank;
        existing.rrfScore += sparseWeight / (rrfK + rank);
        scoredDocs.set(key, existing);
    });

    // 3. Sort by fused RRF score descending with deterministic tie-breaking
    const fusedList = Array.from(scoredDocs.values());
    fusedList.sort((a, b) => {
        const diff = b.rrfScore - a.rrfScore;
        if (Math.abs(diff) > 1e-9) return diff;
        // In ties, prioritize exact lexical match (sparse rank) over continuous vector distance
        return (a.sparseRank ?? Infinity) - (b.sparseRank ?? Infinity);
    });

    return fusedList.slice(0, topK).map(({ doc, denseRank, sparseRank, rrfScore }) => ({
        ...doc,
        denseRank,
        sparseRank,
        rrfScore,
        score: rrfScore
    }));
}
