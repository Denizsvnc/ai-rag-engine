import { pipeline, env, FeatureExtractionPipeline } from '@huggingface/transformers';
import { LRUCache } from 'lru-cache';
import { dotProduct } from '../utils/math';

env.cacheDir = './data/models';

export class CircuitBreakerOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}

export interface SMLEngineConfig {
    modelName?: string | undefined;
    cacheSize?: number | undefined;
    dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | undefined;
    quantized?: boolean | undefined;
    circuitBreakerThreshold?: number | undefined;
    circuitBreakerCooldownMs?: number | undefined;
}

export class SMLEngine {
    private readonly modelName: string;
    private readonly dtype: 'q8' | 'fp32' | 'fp16' | 'q4';
    private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
    private embeddingCache: LRUCache<string, Float32Array>;

    // Circuit Breaker State Machine
    private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;

    constructor(config?: SMLEngineConfig) {
        this.modelName = config?.modelName ?? 'Xenova/all-MiniLM-L6-v2';
        this.dtype = config?.dtype ?? (config?.quantized === false ? 'fp32' : 'q8');
        this.failureThreshold = config?.circuitBreakerThreshold ?? 3;
        this.cooldownMs = config?.circuitBreakerCooldownMs ?? 15000;

        this.embeddingCache = new LRUCache<string, Float32Array>({
            max: config?.cacheSize ?? 1000,
        });
    }

    /**
     * Resets the circuit breaker state (useful for testing and recovery).
     */
    public resetCircuit(): void {
        this.circuitState = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.extractorPromise = null;
    }

    public getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        if (this.circuitState === 'OPEN') {
            if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
                this.circuitState = 'HALF_OPEN';
            }
        }
        return this.circuitState;
    }

    public getFailureCount(): number {
        return this.failureCount;
    }

    /**
     * Thread-safe pipeline initializer guarded by a Circuit Breaker.
     */
    public async init(): Promise<FeatureExtractionPipeline> {
        // Evaluate circuit breaker state
        if (this.circuitState === 'OPEN') {
            const timeSinceLastFailure = Date.now() - this.lastFailureTime;
            if (timeSinceLastFailure < this.cooldownMs) {
                const remainingSec = Math.ceil((this.cooldownMs - timeSinceLastFailure) / 1000);
                throw new CircuitBreakerOpenError(
                    `[SML CircuitBreaker] Model '${this.modelName}' is temporarily tripped OPEN after ${this.failureCount} consecutive failures. Cooldown active for another ${remainingSec}s.`
                );
            }
            // Cooldown has expired, allow single probe attempt in HALF_OPEN state
            this.circuitState = 'HALF_OPEN';
            console.log(`[SML CircuitBreaker] Cooldown expired. Transitioned to HALF_OPEN for probe.`);
        }

        if (!this.extractorPromise) {
            console.log(`[SML] Loading ${this.modelName} (dtype: ${this.dtype})...`);
            this.extractorPromise = pipeline('feature-extraction', this.modelName, {
                dtype: this.dtype,
            })
                .then((pipelineInstance) => {
                    // Success: Reset circuit breaker to healthy CLOSED state
                    this.circuitState = 'CLOSED';
                    this.failureCount = 0;
                    return pipelineInstance;
                })
                .catch((err) => {
                    this.failureCount++;
                    this.lastFailureTime = Date.now();
                    this.extractorPromise = null;

                    if (this.failureCount >= this.failureThreshold) {
                        this.circuitState = 'OPEN';
                        console.error(
                            `[SML CircuitBreaker] ⚠️ Tripped to OPEN state! Model failed ${this.failureCount} times. Pausing requests for ${this.cooldownMs / 1000}s.`
                        );
                    } else {
                        console.error(`[SML] Model loading error (attempt ${this.failureCount}/${this.failureThreshold}):`, err);
                    }
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

        const rawData = output.data as Float32Array;
        // Dynamically compute embedding dimensions from model output tensor (supports any embedding model)
        const dimensions = texts.length > 0 ? Math.floor(rawData.length / texts.length) : 384;
        const results: Float32Array[] = [];

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
