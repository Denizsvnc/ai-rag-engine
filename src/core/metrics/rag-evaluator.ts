export interface RetrievalEvalResult {
    k: number;
    precisionAtK: number;
    recallAtK: number;
    hitRate: number;
    reciprocalRank: number;
}

export interface FaithfulnessEvalResult {
    score: number; // 0.0 to 1.0 (1.0 = completely grounded)
    totalSentences: number;
    groundedSentences: number;
    ungroundedClaims: string[];
}

export interface FullRAGEvaluationReport {
    retrieval: RetrievalEvalResult;
    faithfulness: FaithfulnessEvalResult;
    overallPass: boolean;
}

/**
 * Pure TypeScript RAG Evaluation Engine.
 * Evaluates retrieval quality (Precision@K, Recall@K, MRR) and generation faithfulness
 * (hallucination detection) without calling external paid LLMs.
 */
export class RAGEvaluator {
    /**
     * Measures Retrieval Precision@K:
     * Proportion of retrieved documents in the top-K that are genuinely relevant.
     */
    public static precisionAtK(
        retrievedIds: string[],
        relevantIds: string[],
        k: number = 3
    ): number {
        const topK = retrievedIds.slice(0, k);
        if (topK.length === 0) return 0;

        const relevantSet = new Set(relevantIds);
        const hits = topK.filter(id => relevantSet.has(id)).length;
        return Number((hits / topK.length).toFixed(4));
    }

    /**
     * Measures Retrieval Recall@K:
     * Proportion of all existing relevant documents that were captured in the top-K.
     */
    public static recallAtK(
        retrievedIds: string[],
        relevantIds: string[],
        k: number = 3
    ): number {
        if (relevantIds.length === 0) return 1.0;
        const topK = retrievedIds.slice(0, k);
        const relevantSet = new Set(relevantIds);
        const hits = topK.filter(id => relevantSet.has(id)).length;
        return Number((hits / relevantIds.length).toFixed(4));
    }

    /**
     * Measures Mean Reciprocal Rank (MRR):
     * 1 / rank of the first relevant document retrieved.
     */
    public static reciprocalRank(
        retrievedIds: string[],
        relevantIds: string[]
    ): number {
        const relevantSet = new Set(relevantIds);
        for (let i = 0; i < retrievedIds.length; i++) {
            const id = retrievedIds[i];
            if (id && relevantSet.has(id)) {
                return Number((1 / (i + 1)).toFixed(4));
            }
        }
        return 0;
    }

    /**
     * Evaluates Answer Faithfulness / Hallucination Rate:
     * Deconstructs the generated response into discrete sentences/claims,
     * and checks whether the salient terms in each sentence are grounded
     * in the retrieved context documents.
     */
    public static evaluateFaithfulness(
        answer: string,
        contextTexts: string[]
    ): FaithfulnessEvalResult {
        const combinedContext = contextTexts.join(' ').toLowerCase();
        const sentences = answer
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 10);

        if (sentences.length === 0) {
            return {
                score: 1.0,
                totalSentences: 0,
                groundedSentences: 0,
                ungroundedClaims: []
            };
        }

        const ungroundedClaims: string[] = [];
        let groundedCount = 0;

        for (const sentence of sentences) {
            const words = sentence
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .split(/\s+/)
                .filter(w => w.length > 3);

            if (words.length === 0) {
                groundedCount++;
                continue;
            }

            // Count words grounded in retrieved context
            const groundedWords = words.filter(word => combinedContext.includes(word));
            const overlapRatio = groundedWords.length / words.length;

            // Threshold: sentence is considered grounded if at least 40% of substantive terms appear in context
            if (overlapRatio >= 0.4) {
                groundedCount++;
            } else {
                ungroundedClaims.push(sentence);
            }
        }

        const score = Number((groundedCount / sentences.length).toFixed(4));

        return {
            score,
            totalSentences: sentences.length,
            groundedSentences: groundedCount,
            ungroundedClaims
        };
    }

    /**
     * Conducts a full RAG evaluation given a query, generated answer, retrieved docs, and ground truth IDs.
     */
    public static evaluate(options: {
        retrievedIds: string[];
        relevantIds: string[];
        answer: string;
        contextTexts: string[];
        k?: number;
    }): FullRAGEvaluationReport {
        const k = options.k ?? 3;
        const pAtK = this.precisionAtK(options.retrievedIds, options.relevantIds, k);
        const rAtK = this.recallAtK(options.retrievedIds, options.relevantIds, k);
        const rr = this.reciprocalRank(options.retrievedIds, options.relevantIds);
        const hit = pAtK > 0 ? 1 : 0;

        const faithfulness = this.evaluateFaithfulness(options.answer, options.contextTexts);

        return {
            retrieval: {
                k,
                precisionAtK: pAtK,
                recallAtK: rAtK,
                hitRate: hit,
                reciprocalRank: rr
            },
            faithfulness,
            overallPass: pAtK > 0 && faithfulness.score >= 0.7
        };
    }
}
