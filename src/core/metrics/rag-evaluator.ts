export interface RetrievalEvalResult {
    k: number;
    precisionAtK: number;
    recallAtK: number;
    hitRate: number;
    reciprocalRank: number;
}

export interface FaithfulnessEvalResult {
    score: number; // 0.0 to 1.0 (Composite groundedness score)
    lexicalGroundingScore: number; // Lexical token overlap heuristic
    totalSentences: number;
    groundedSentences: number;
    contradictionsDetected: string[]; // Sentences containing numbers/claims absent from context
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
    public static evaluateGrounding(
        answer: string,
        context: string | string[]
    ): FaithfulnessEvalResult & { grounded: boolean; groundingScore: number } {
        const contextTexts = Array.isArray(context) ? context : [context];
        const res = this.evaluateFaithfulness(answer, contextTexts);
        return {
            ...res,
            grounded: res.score >= 0.7 && res.contradictionsDetected.length === 0,
            groundingScore: res.score
        };
    }

    public static evaluateFaithfulness(
        answer: string,
        contextTexts: string[]
    ): FaithfulnessEvalResult {
        const combinedContext = contextTexts.join(' ').toLowerCase();
        const contextClean = combinedContext.replace(/[^\p{L}\p{N}\s]/gu, ' ');
        const contextWordTokens = new Set(contextClean.split(/\s+/).filter(w => w.length > 2));

        // Extract context numerical literals (e.g. 24, 100, 3.5)
        const contextNumbers = new Set(
            (combinedContext.match(/\b\d+(?:[\.,]\d+)?\b/g) || []).map(n => n.replace(',', '.'))
        );

        const sentences = answer
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 10);

        if (sentences.length === 0) {
            return {
                score: 1.0,
                lexicalGroundingScore: 1.0,
                totalSentences: 0,
                groundedSentences: 0,
                contradictionsDetected: [],
                ungroundedClaims: []
            };
        }

        const ungroundedClaims: string[] = [];
        const contradictionsDetected: string[] = [];
        let groundedCount = 0;
        let totalLexicalOverlapSum = 0;

        for (const sentence of sentences) {
            const lowerSentence = sentence.toLowerCase();

            // 1. Numerical Contradiction Check (detects numbers not present in context)
            const sentenceNumbers = (lowerSentence.match(/\b\d+(?:[\.,]\d+)?\b/g) || []).map(n => n.replace(',', '.'));
            let hasNumberContradiction = false;
            for (const num of sentenceNumbers) {
                if (contextNumbers.size > 0 && !contextNumbers.has(num)) {
                    hasNumberContradiction = true;
                    contradictionsDetected.push(
                        `Contradiction: Number '${num}' in "${sentence}" contradicts context.`
                    );
                    break;
                }
            }

            // 2. Lexical Substantive Term Overlap
            const words = lowerSentence
                .replace(/[^\p{L}\p{N}\s]/gu, ' ')
                .split(/\s+/)
                .filter(w => w.length > 2);

            if (words.length === 0) {
                if (!hasNumberContradiction) groundedCount++;
                totalLexicalOverlapSum += 1.0;
                continue;
            }

            const groundedWords = words.filter(word => contextWordTokens.has(word) || combinedContext.includes(word));
            const overlapRatio = groundedWords.length / words.length;
            totalLexicalOverlapSum += overlapRatio;

            // Sentence is grounded if at least 40% lexical overlap AND no number contradiction
            if (overlapRatio >= 0.4 && !hasNumberContradiction) {
                groundedCount++;
            } else {
                ungroundedClaims.push(sentence);
            }
        }

        const lexicalGroundingScore = Number((totalLexicalOverlapSum / sentences.length).toFixed(4));
        const score = Number((groundedCount / sentences.length).toFixed(4));

        return {
            score,
            lexicalGroundingScore,
            totalSentences: sentences.length,
            groundedSentences: groundedCount,
            contradictionsDetected,
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
