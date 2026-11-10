import type { VectorDocument } from '../../interfaces/vector.interface.js';

export interface HybridScoredDocument extends VectorDocument {
    denseRank?: number | undefined;
    sparseRank?: number | undefined;
    rrfScore: number;
}

/**
 * Reciprocal Rank Fusion (RRF) algorithm.
 * Combines dense vector semantic rankings and sparse BM25 lexical rankings into
 * a single high-precision ranking without needing score normalization.
 *
 * Formula: RRF_score(d) = sum_{m in models} 1 / (k + rank_m(d))
 * Standard constant k = 60
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
