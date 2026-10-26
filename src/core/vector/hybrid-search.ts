import type { VectorDocument } from '../../interfaces/vector.interface';

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
    rrfK: number = 60
): HybridScoredDocument[] {
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
        const existing = scoredDocs.get(doc.id) || { doc, rrfScore: 0 };
        existing.denseRank = rank;
        existing.rrfScore += 1 / (rrfK + rank);
        scoredDocs.set(doc.id, existing);
    });

    // 2. Process Sparse BM25 results
    sparseResults.forEach((doc, index) => {
        const rank = index + 1;
        const existing = scoredDocs.get(doc.id) || { doc, rrfScore: 0 };
        existing.sparseRank = rank;
        existing.rrfScore += 1 / (rrfK + rank);
        scoredDocs.set(doc.id, existing);
    });

    // 3. Sort by fused RRF score descending
    const fusedList = Array.from(scoredDocs.values());
    fusedList.sort((a, b) => b.rrfScore - a.rrfScore);

    return fusedList.slice(0, topK).map(({ doc, denseRank, sparseRank, rrfScore }) => ({
        ...doc,
        denseRank,
        sparseRank,
        rrfScore,
        score: rrfScore
    }));
}
