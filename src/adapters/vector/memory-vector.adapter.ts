import type { IVectorStoreAdapter, VectorDocument } from '../../interfaces/vector.interface';
import { SMLEngine } from '../../core/sml-engine';
import { dotProduct } from '../../utils/math';
import { BM25Index } from '../../core/vector/bm25';
import { reciprocalRankFusion, type HybridScoredDocument } from '../../core/vector/hybrid-search';

interface StoredDocument extends VectorDocument {
    embedding: number[] | Float32Array;
}

export class MemoryVectorAdapter implements IVectorStoreAdapter {
    private documents: StoredDocument[] = [];
    private bm25Index: BM25Index = new BM25Index();

    constructor(private smlEngine: SMLEngine = new SMLEngine()) { }

    /**
     * Adds documents to memory, computes their embeddings, and indexes them in BM25.
     */
    public async addDocuments(docs: Omit<VectorDocument, 'score'>[]): Promise<void> {
        for (const doc of docs) {
            console.log(`[MemoryVector] Vectorizing document: ${doc.id}`);
            const embedding = await this.smlEngine.getEmbedding(doc.content);
            this.documents.push({ ...doc, embedding });
        }
        // Update BM25 lexical index
        this.bm25Index.index(this.documents);
    }

    public async insert(doc: Omit<VectorDocument, 'score'>): Promise<void> {
        await this.addDocuments([doc]);
    }

    /**
     * Searches for the top-k most similar documents against the query vector,
     * with optional metadata filtering (e.g. tenantId).
     */
    public async search(
        query: string,
        topK: number = 3,
        filter?: Record<string, any>
    ): Promise<VectorDocument[]> {
        if (this.documents.length === 0) return [];

        let candidates = this.documents;
        if (filter) {
            candidates = candidates.filter(doc =>
                Object.entries(filter).every(([key, val]) => doc.metadata?.[key] === val)
            );
        }

        if (candidates.length === 0) return [];

        const queryEmbedding = await this.smlEngine.getEmbedding(query);

        // Score documents using dot product (embeddings are unit-normalized)
        const scoredDocs = candidates.map(doc => ({
            ...doc,
            score: dotProduct(
                queryEmbedding as unknown as number[],
                doc.embedding as unknown as number[]
            )
        }));

        // Sort by similarity score descending and take top-k
        scoredDocs.sort((a, b) => (b.score || 0) - (a.score || 0));

        return scoredDocs.slice(0, topK).map(({ embedding, ...rest }) => rest);
    }

    /**
     * Hybrid Search combining Dense ONNX Vector search with Sparse BM25 lexical search
     * via Reciprocal Rank Fusion (RRF).
     */
    public async searchHybrid(
        query: string,
        topK: number = 3,
        filter?: Record<string, any>
    ): Promise<HybridScoredDocument[]> {
        if (this.documents.length === 0) return [];

        // 1. Dense vector candidate retrieval (retrieve 2x topK for fusion)
        const candidateK = Math.max(topK * 2, 6);
        const denseResults = await this.search(query, candidateK, filter);

        // 2. Sparse BM25 lexical candidate retrieval
        const bm25Results = this.bm25Index
            .search(query, candidateK, filter)
            .map(res => ({
                id: res.document.id,
                content: res.document.content,
                metadata: res.document.metadata,
                score: res.score
            }));

        // 3. Fuse via Reciprocal Rank Fusion
        return reciprocalRankFusion(denseResults, bm25Results, topK);
    }

    /**
     * Deletes a document by ID from both Dense memory and BM25 index.
     */
    public async deleteDocument(id: string): Promise<boolean> {
        const initialLen = this.documents.length;
        this.documents = this.documents.filter(d => d.id !== id);
        this.bm25Index = new BM25Index();
        this.bm25Index.index(this.documents);
        return this.documents.length < initialLen;
    }

    /**
     * Clears all stored documents.
     */
    public async clear(): Promise<void> {
        this.documents = [];
        this.bm25Index.clear();
    }
}