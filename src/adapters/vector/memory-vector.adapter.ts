import type { IVectorStoreAdapter, VectorDocument } from '../../interfaces/vector.interface';
import { SMLEngine } from '../../core/sml-engine';
import { dotProduct } from '../../utils/math';

interface StoredDocument extends VectorDocument {
    embedding: number[] | Float32Array;
}

export class MemoryVectorAdapter implements IVectorStoreAdapter {
    private documents: StoredDocument[] = [];

    constructor(private smlEngine: SMLEngine) { }

    /**
     * Adds documents to memory and computes their embeddings.
     */
    public async addDocuments(docs: Omit<VectorDocument, 'score'>[]): Promise<void> {
        for (const doc of docs) {
            console.log(`[MemoryVector] Vectorizing document: ${doc.id}`);
            const embedding = await this.smlEngine.getEmbedding(doc.content);
            this.documents.push({ ...doc, embedding });
        }
    }

    /**
     * Searches for the top-k most similar documents against the query vector.
     */
    public async search(query: string, topK: number = 3): Promise<VectorDocument[]> {
        if (this.documents.length === 0) return [];

        const queryEmbedding = await this.smlEngine.getEmbedding(query);

        // Score documents using dot product (embeddings are unit-normalized)
        const scoredDocs = this.documents.map(doc => ({
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
}