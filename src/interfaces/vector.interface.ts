export interface VectorDocument {
    id: string;
    content: string;
    metadata?: Record<string, any> | undefined;
    score?: number | undefined; // Similarity score
}

export interface IVectorStoreAdapter {
    search(query: string, topK?: number, filter?: Record<string, any>): Promise<VectorDocument[]>;
    searchHybrid?(query: string, topK?: number, filter?: Record<string, any>): Promise<VectorDocument[]>;
    addDocuments?(docs: Omit<VectorDocument, 'score'>[]): Promise<void>;
    deleteDocument?(id: string): Promise<boolean>;
    clear?(): Promise<void>;
}