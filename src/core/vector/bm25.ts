/**
 * Zero-dependency BM25 (Best Matching 25) Sparse Keyword Retrieval.
 * Provides lexical term matching (exact SKU codes, error messages, proper nouns, part numbers)
 * to complement dense semantic vector search.
 */
/**
 * In-memory document representation for BM25 lexical indexing.
 */
export interface BM25Document {
    /** Unique document identifier. */
    id: string;
    /** Text content to index. */
    content: string;
    /** Optional metadata attributes (tenantId, documentId, etc.). */
    metadata?: Record<string, unknown> | undefined;
}

/**
 * Pure TypeScript in-memory Okapi BM25 sparse keyword retrieval engine.
 *
 * @remarks
 * Complements dense vector embeddings by providing exact lexical term matching for SKU numbers,
 * error codes, part identifiers, and domain-specific terminology without external dependencies.
 *
 * @example
 * ```typescript
 * import { BM25Index } from '@denizsvnc/ai-rag-engine';
 *
 * const index = new BM25Index({ k1: 1.5, b: 0.75 });
 * index.index([
 *   { id: '1', content: 'Invoice INV-2024-9988 payment received' },
 *   { id: '2', content: 'Error CODE_504 Gateway timeout' }
 * ]);
 *
 * const results = index.search('INV-2024-9988', 1);
 * console.log(results[0].document.id); // '1'
 * ```
 */
export class BM25Index {
    private docCount = 0;
    private avgDocLength = 0;
    private docLengths: Map<string, number> = new Map();
    private docTermFreqs: Map<string, Map<string, number>> = new Map();
    private termDocFreqs: Map<string, number> = new Map();
    private documents: Map<string, BM25Document> = new Map();

    private readonly k1: number;
    private readonly b: number;

    /**
     * Initializes a new BM25Index instance.
     *
     * @param options - BM25 calibration parameters (k1 term saturation, b document length damping).
     */
    constructor(options?: { k1?: number; b?: number }) {
        this.k1 = options?.k1 ?? 1.5;
        this.b = options?.b ?? 0.75;
    }

    /**
     * Tokenizes text into lowercase normalized alphanumeric terms with diacritical support.
     */
    private tokenize(text: string): string[] {
        return text
            .replace(/İ/g, 'i')
            .replace(/I/g, 'ı')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\p{M}\s\-_]/gu, ' ')
            .split(/\s+/)
            .filter(t => t.length > 1);
    }

    /**
     * Indexes a collection of documents.
     *
     * @param docs - Array of documents to index.
     */
    public index(docs: BM25Document[]): void {
        this.clear();

        let totalLength = 0;

        const uniqueDocs = new Map(docs.map(doc => [JSON.stringify([doc.metadata?.tenantId ?? null, doc.id]), doc]));
        for (const [key, doc] of uniqueDocs) {
            this.documents.set(key, doc);
            const tokens = this.tokenize(doc.content);
            const length = tokens.length;
            this.docLengths.set(key, length);
            totalLength += length;

            const termFreq = new Map<string, number>();
            const seenTerms = new Set<string>();

            for (const token of tokens) {
                termFreq.set(token, (termFreq.get(token) || 0) + 1);
                if (!seenTerms.has(token)) {
                    seenTerms.add(token);
                    this.termDocFreqs.set(token, (this.termDocFreqs.get(token) || 0) + 1);
                }
            }

            this.docTermFreqs.set(key, termFreq);
        }

        this.docCount = uniqueDocs.size;
        this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;
    }

    /**
     * Computes the Robertson-Spärck Jones IDF for a query term.
     */
    private computeIDF(term: string): number {
        const docFreq = this.termDocFreqs.get(term) || 0;
        return Math.log(1 + (this.docCount - docFreq + 0.5) / (docFreq + 0.5));
    }

    /**
     * Scores documents against a search query using the Okapi BM25 formula.
     *
     * @param query - Search query string.
     * @param topK - Maximum number of scored matches to return. @defaultValue 3
     * @param filter - Optional metadata equality filter (e.g. `{ tenantId: 'org_1' }`).
     * @returns Array of matched documents sorted by BM25 score descending.
     */
    public search(query: string, topK: number = 3, filter?: Record<string, unknown>): Array<{ document: BM25Document; score: number }> {
        if (this.docCount === 0) return [];

        const queryTerms = this.tokenize(query);
        if (queryTerms.length === 0) return [];

        const scores: Array<{ document: BM25Document; score: number }> = [];

        for (const [docId, doc] of this.documents.entries()) {
            // Apply metadata filtering if specified (e.g. tenantId)
            if (filter) {
                const matchesFilter = Object.entries(filter).every(
                    ([key, val]) => doc.metadata?.[key] === val
                );
                if (!matchesFilter) continue;
            }

            const docLen = this.docLengths.get(docId) || 0;
            const termFreqs = this.docTermFreqs.get(docId);
            if (!termFreqs) continue;

            let score = 0;
            for (const term of queryTerms) {
                const tf = termFreqs.get(term) || 0;
                if (tf === 0) continue;

                const idf = this.computeIDF(term);
                const numerator = tf * (this.k1 + 1);
                const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));
                score += idf * (numerator / denominator);
            }

            if (score > 0) {
                scores.push({ document: doc, score });
            }
        }

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, topK);
    }

    /**
     * Clears all indexed documents, term frequencies, and lengths.
     */
    public clear(): void {
        this.docCount = 0;
        this.avgDocLength = 0;
        this.docLengths.clear();
        this.docTermFreqs.clear();
        this.termDocFreqs.clear();
        this.documents.clear();
    }
}
