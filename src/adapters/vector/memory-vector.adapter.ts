import type { VectorDocument } from '../../interfaces/vector.interface.js';
import type { IVectorStore, StorageCapabilities } from '../../interfaces/storage.interface.js';
import { SMLEngine } from '../../core/sml-engine.js';
import { dotProduct } from '../../utils/math.js';
import { BM25Index } from '../../core/vector/bm25.js';
import { reciprocalRankFusion, type HybridScoredDocument } from '../../core/vector/hybrid-search.js';

interface StoredDocument extends VectorDocument {
    embedding: number[] | Float32Array;
}

/**
 * In-memory vector store adapter with integrated BM25 keyword index and Reciprocal Rank Fusion.
 *
 * @remarks
 * Ideal for development, testing, and edge microservices that vectorize documents in RAM.
 * Automatically synchronizes dense vector embeddings via `SMLEngine` and sparse BM25 tokens.
 *
 * @example
 * ```typescript
 * const store = new MemoryVectorAdapter();
 * await store.addDocuments([{
 *   id: 'doc_1',
 *   content: 'Corporate travel policy allows economy flights under 6 hours.',
 *   metadata: { tenantId: 'tenant_1' }
 * }]);
 * const results = await store.searchHybrid('flight duration rule', 3, { tenantId: 'tenant_1' });
 * ```
 */
export class MemoryVectorAdapter implements IVectorStore {
    public readonly capabilities: StorageCapabilities = {
        denseVectorSearch: true,
        sparseRetrieval: true,
        nativeHybridSearch: true,
        metadataFiltering: true,
        namespaceIsolation: true,
        transactions: false,
        atomicDocumentReplacement: true,
        versioning: true,
        batchOperations: true,
        fullTextSearch: true
    };

    private documents: StoredDocument[] = [];
    private bm25Index: BM25Index = new BM25Index();
    private tenantRevisions = new Map<string, number>();

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    constructor(private smlEngine: SMLEngine = new SMLEngine()) { }

    public async getRevision(tenantId: string): Promise<string> {
        return String(this.tenantRevisions.get(tenantId) ?? 0);
    }

    public setSMLEngine(engine: SMLEngine): void {
        this.smlEngine = engine;
    }

    public getSMLEngine(): SMLEngine {
        return this.smlEngine;
    }

    /**
     * Replaces all chunks belonging to a document under a specific version atomically.
     */
    public async replaceDocument(
        documentId: string,
        tenantId: string,
        version: number,
        documents: Omit<VectorDocument, 'score'>[]
    ): Promise<'applied' | 'unchanged' | 'superseded'> {
        const existingDocs = this.documents.filter(d =>
            d.metadata?.tenantId === tenantId &&
            d.metadata?.sourceDocId === documentId
        );
        const maxExistingVersion = existingDocs.reduce((max, d) => Math.max(max, d.version ?? 0), 0);

        if (maxExistingVersion > version) {
            return 'superseded';
        }

        // Remove previous chunks for this document
        this.documents = this.documents.filter(d =>
            !(d.metadata?.tenantId === tenantId && d.metadata?.sourceDocId === documentId)
        );

        // Vectorize and insert new version chunks
        await this.addDocuments(documents.map(d => ({
            ...d,
            version,
            metadata: { ...d.metadata, tenantId, sourceDocId: documentId }
        })));

        this.tenantRevisions.set(tenantId, (this.tenantRevisions.get(tenantId) ?? 0) + 1);
        return 'applied';
    }

    /**
     * Adds documents to memory, computes their embeddings, and indexes them in BM25.
     */
    public async addDocuments(docs: Omit<VectorDocument, 'score'>[]): Promise<void> {
        const prepared: StoredDocument[] = [];
        for (const doc of docs) {
            console.log(`[MemoryVector] Vectorizing document: ${doc.id}`);
            const embedding = await this.smlEngine.getEmbedding(doc.content);
            prepared.push({ ...doc, embedding });
        }
        for (const doc of prepared) {
            const index = this.documents.findIndex(existing => existing.id === doc.id && existing.metadata?.tenantId === doc.metadata?.tenantId);
            if (index < 0) this.documents.push(doc);
            else this.documents[index] = doc;
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
        filter?: Record<string, unknown>
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
        filter?: Record<string, unknown>
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
    public async deleteDocument(id: string, filter?: Record<string, unknown>): Promise<boolean> {
        const initialLen = this.documents.length;
        this.documents = this.documents.filter(d => d.id !== id || !this.matchesFilter(d, filter));
        this.bm25Index = new BM25Index();
        this.bm25Index.index(this.documents);
        return this.documents.length < initialLen;
    }

    /**
     * Clears all stored documents.
     */
    public async clear(filter?: Record<string, unknown>): Promise<void> {
        this.documents = this.documents.filter(doc => !this.matchesFilter(doc, filter));
        this.bm25Index.index(this.documents);
    }

    private matchesFilter(doc: VectorDocument, filter?: Record<string, unknown>): boolean {
        return !filter || Object.entries(filter).every(([key, value]) => doc.metadata?.[key] === value);
    }
}