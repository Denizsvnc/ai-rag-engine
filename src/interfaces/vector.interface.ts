/**
 * Document chunk stored in a vector database with content, embedding metadata, and relevance score.
 */
export interface VectorDocument {
    /** Unique identifier of the document chunk. */
    id: string;
    /** Raw text content of the chunk. */
    content: string;
    /** Arbitrary document metadata (e.g., `tenantId`, `sourceDocId`, `title`, `author`). */
    metadata?: Record<string, unknown> | undefined;
    /** Monotonically increasing revision or version number. */
    version?: number | undefined;
    /** Cosine similarity or fused relevance score in range [0.0 - 1.0]. */
    score?: number | undefined;
}

/**
 * Common contract for vector store adapters (e.g. `MemoryVectorAdapter`, `PostgresVectorAdapter`).
 *
 * @example
 * ```typescript
 * const store: IVectorStoreAdapter = new MemoryVectorAdapter();
 * await store.addDocuments?.([{
 *   id: 'chunk_1',
 *   content: 'Corporate refund window is 14 days.',
 *   metadata: { tenantId: 'tenant_1' }
 * }]);
 * const matches = await store.search('How long do I have to return an item?', 3, { tenantId: 'tenant_1' });
 * ```
 */
export interface IVectorStoreAdapter {
    /** Retrieves current vector store revision or transaction hash for cache invalidation. */
    getRevision?(tenantId: string): Promise<string>;
    /**
     * Executes dense semantic vector search.
     *
     * @param query - Natural language search query.
     * @param topK - Maximum number of documents to return. Defaults to 5.
     * @param filter - Metadata filter (e.g. `{ tenantId: 'acme' }`).
     * @returns Array of matching `VectorDocument` items with similarity scores.
     */
    search(query: string, topK?: number, filter?: Record<string, unknown>): Promise<VectorDocument[]>;
    /**
     * Executes hybrid dense vector + sparse BM25 retrieval with Reciprocal Rank Fusion.
     *
     * @param query - Natural language search query.
     * @param topK - Maximum number of documents to return.
     * @param filter - Metadata filter.
     * @returns Array of `VectorDocument` items ranked by fused RRF score.
     */
    searchHybrid?(query: string, topK?: number, filter?: Record<string, unknown>): Promise<VectorDocument[]>;
    /** Indexes document chunks into the vector store. */
    addDocuments?(docs: Omit<VectorDocument, 'score'>[]): Promise<void>;
    /** Deletes a document chunk by ID with optional tenant scoping. */
    deleteDocument?(id: string, filter?: Record<string, unknown>): Promise<boolean>;
    /** Clears all indexed documents matching the filter. */
    clear?(filter?: Record<string, unknown>): Promise<void>;
}