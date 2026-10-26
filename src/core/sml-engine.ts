import { pipeline, env, FeatureExtractionPipeline } from '@huggingface/transformers';
import { LRUCache } from 'lru-cache';
import { dotProduct } from '../utils/math';

env.cacheDir = './data/models';

export interface SMLEngineConfig {
    modelName?: string | undefined;
    cacheSize?: number | undefined;
    dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | undefined;
    quantized?: boolean | undefined;
}

export class SMLEngine {
    private readonly modelName: string;
    private readonly dtype: 'q8' | 'fp32' | 'fp16' | 'q4';
    private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
    private embeddingCache: LRUCache<string, Float32Array>;

    constructor(config?: SMLEngineConfig) {
        this.modelName = config?.modelName ?? 'Xenova/all-MiniLM-L6-v2';
        this.dtype = config?.dtype ?? (config?.quantized === false ? 'fp32' : 'q8');

        this.embeddingCache = new LRUCache<string, Float32Array>({
            max: config?.cacheSize ?? 1000,
        });
    }

    /**
     * Thread-safe pipeline initializer.
     */
    public async init(): Promise<FeatureExtractionPipeline> {
        if (!this.extractorPromise) {
            console.log(`[SML] Loading ${this.modelName} (dtype: ${this.dtype})...`);
            this.extractorPromise = pipeline('feature-extraction', this.modelName, {
                dtype: this.dtype,
            }).catch((err) => {
                this.extractorPromise = null; // Allow retry on failure
                console.error('[SML] Model loading error:', err);
                throw err;
            });
        }
        return this.extractorPromise;
    }

    /**
     * Generates a normalized embedding vector for a single text input (with LRU caching).
     */
    public async getEmbedding(text: string): Promise<Float32Array> {
        const cleanedText = text.trim();
        if (!cleanedText) {
            throw new Error('Text input cannot be empty.');
        }

        const cached = this.embeddingCache.get(cleanedText);
        if (cached) return cached;

        const extractor = await this.init();
        const output = await extractor(cleanedText, {
            pooling: 'mean',
            normalize: true,
        });

        const embedding = output.data as Float32Array;
        this.embeddingCache.set(cleanedText, embedding);
        return embedding;
    }

    /**
     * Generates embedding vectors for multiple texts in batch mode.
     */
    public async getBatchEmbeddings(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        const extractor = await this.init();

        const output = await extractor(texts, {
            pooling: 'mean',
            normalize: true,
        });

        // Slice batched output into per-text 384-dimensional vectors
        const dimensions = 384; // Default dimension for MiniLM
        const results: Float32Array[] = [];
        const rawData = output.data as Float32Array;

        for (let i = 0; i < texts.length; i++) {
            const start = i * dimensions;
            results.push(rawData.subarray(start, start + dimensions));
        }

        return results;
    }

    /**
     * Compares the query against target embeddings and returns the highest scoring match above the threshold.
     */
    public async findBestMatch<T extends { id: string; embedding: number[] | Float32Array }>(
        query: string,
        targets: T[],
        threshold: number = 0.65
    ): Promise<{ target: T; score: number } | null> {
        if (targets.length === 0) return null;

        const queryVec = await this.getEmbedding(query);
        let bestTarget: T | null = null;
        let highestScore = -1;

        for (let i = 0; i < targets.length; i++) {
            const target = targets[i]!;
            // For unit-normalized vectors, cosine similarity equals the dot product
            const score = dotProduct(
                queryVec as unknown as number[],
                target.embedding as unknown as number[]
            );

            if (score > highestScore) {
                highestScore = score;
                bestTarget = target;
            }
        }

        if (bestTarget && highestScore >= threshold) {
            return { target: bestTarget, score: highestScore };
        }

        return null;
    }
}
