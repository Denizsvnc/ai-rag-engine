export interface VectorDocument {
    id: string;
    content: string;
    metadata?: Record<string, any>;
    score?: number; // Similarity score
}

export interface IVectorStoreAdapter {
    search(query: string, topK?: number, filter?: Record<string, any>): Promise<VectorDocument[]>;
    addDocuments?(docs: Omit<VectorDocument, 'score'>[]): Promise<void>;
}