export interface VectorDocument {
    id: string;
    content: string;
    metadata?: Record<string, any> | undefined;
    version?: number | undefined;
    score?: number | undefined; // Similarity score
}

export interface IVectorStoreAdapter {
    getRevision?(tenantId: string): Promise<string>;
    search(query: string, topK?: number, filter?: Record<string, any>): Promise<VectorDocument[]>;
    searchHybrid?(query: string, topK?: number, filter?: Record<string, any>): Promise<VectorDocument[]>;
    addDocuments?(docs: Omit<VectorDocument, 'score'>[]): Promise<void>;
    deleteDocument?(id: string, filter?: Record<string, any>): Promise<boolean>;
    clear?(filter?: Record<string, any>): Promise<void>;
}