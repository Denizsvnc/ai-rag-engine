import { LRUCache } from 'lru-cache';
import { dotProduct } from '../utils/math.js';

/** Stable SDK boundary: transformer implementation types are kept private. */
export interface EmbeddingExtractor {
    (text: string | string[], options: { pooling: 'mean'; normalize: boolean }): Promise<{ data: Float32Array; dims: number[] }>;
}

/**
 * Error thrown when an SML model operation is attempted while the internal Circuit Breaker is in the `OPEN` state.
 *
 * @remarks
 * Occurs after consecutive load failures reach `circuitBreakerThreshold`. The circuit breaker
 * prevents cascading failures and remote hanging by rejecting requests immediately during the cooldown period.
 */
export class CircuitBreakerOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}

/**
 * Industry-standard ONNX embedding model presets for the Small Machine Learning (SML) engine.
 * Powered by `@huggingface/transformers` without requiring Python or external API keys.
 */
export const SMLModelPresets = {
    /**
     * Ultra-fast English embedding model (~30MB q8 ONNX).
     * Ideal for English-only workloads, low-latency semantic routing, and minimal RAM footprint.
     */
    ENGLISH_FAST: 'Xenova/all-MiniLM-L6-v2',

    /**
     * Highly recommended balanced multilingual model (~117MB q8 ONNX).
     * Provides exceptional semantic similarity across 50+ languages including Turkish, German, English, French, and Spanish.
     */
    MULTILINGUAL: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',

    /**
     * Heavyweight high-accuracy multilingual foundation model (1024-dim, long context, 100+ languages).
     * Highest precision across mixed-language corpora, but requires higher memory and CPU allocation.
     */
    MULTILINGUAL_ACCURATE: 'Xenova/bge-m3',
} as const;

export type SMLModelPreset = typeof SMLModelPresets[keyof typeof SMLModelPresets];

export interface SMLEngineConfig {
    /** Directory where downloaded ONNX models are cached. Defaults to process.env.RAG_MODEL_CACHE_DIR or './data/models'. */
    cacheDir?: string | undefined;
    /** When true, only loads models already present on local disk and prevents external network fetching. */
    localFilesOnly?: boolean | undefined;
    /**
     * Hugging Face ONNX model identifier.
     * Use a preset (e.g. `SMLModelPresets.MULTILINGUAL`) or pass any custom HuggingFace model string (e.g. `'my-org/my-custom-model'`).
     * Defaults to `'Xenova/all-MiniLM-L6-v2'`.
     */
    modelName?: string | SMLModelPreset | undefined;
    /** Maximum number of precomputed query/document embeddings retained in RAM LRU cache. Defaults to 1000. */
    cacheSize?: number | undefined;
    /** Model quantization data type: 'q8' (default), 'fp32', 'fp16', or 'q4'. */
    dtype?: 'q8' | 'fp32' | 'fp16' | 'q4' | undefined;
    /** Legacy flag for quantization: false forces 'fp32'. */
    quantized?: boolean | undefined;
    /** Number of consecutive load failures before tripping the circuit breaker OPEN. Defaults to 3. */
    circuitBreakerThreshold?: number | undefined;
    /** Cooldown period in milliseconds before re-testing model recovery. Defaults to 15000 (15s). */
    circuitBreakerCooldownMs?: number | undefined;
}

/**
 * In-process Small Machine Learning (SML) engine for local embedding computation and semantic routing.
 *
 * @remarks
 * Uses `@huggingface/transformers` to execute quantized ONNX models locally without Python or external APIs.
 * Includes an integrated Circuit Breaker state machine (CLOSED -> OPEN -> HALF_OPEN) to prevent DOS and hanging.
 *
 * @example
 * ```typescript
 * const sml = new SMLEngine({
 *   modelName: SMLModelPresets.MULTILINGUAL,
 *   dtype: 'q8'
 * });
 * await sml.init();
 * const vector = await sml.getEmbedding('What is our return policy?');
 * console.log(`Embedding dimensions: ${vector.length}`);
 * ```
 */
export class SMLEngine {
    private static initLockChain: Promise<void> = Promise.resolve();

    private static async acquireInitLock(): Promise<() => void> {
        let releaseLock: () => void = () => {};
        const nextLock = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        const currentLock = SMLEngine.initLockChain;
        SMLEngine.initLockChain = currentLock.then(() => nextLock);
        await currentLock;
        return releaseLock;
    }

    private readonly modelName: string;
    private readonly cacheDir: string;
    private readonly localFilesOnly: boolean;
    private readonly dtype: 'q8' | 'fp32' | 'fp16' | 'q4';
    private extractorPromise: Promise<EmbeddingExtractor> | null = null;
    private embeddingCache: LRUCache<string, Float32Array>;

    // Circuit Breaker State Machine
    private circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;

    constructor(config?: SMLEngineConfig) {
        this.cacheDir = config?.cacheDir ?? process.env.RAG_MODEL_CACHE_DIR ?? './data/models';
        this.localFilesOnly = config?.localFilesOnly ?? false;
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

    /**
     * Retrieves the current state of the internal Circuit Breaker.
     *
     * @returns `'CLOSED'` (healthy), `'OPEN'` (failing fast during cooldown), or `'HALF_OPEN'` (probing).
     */
    public getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
        if (this.circuitState === 'OPEN') {
            if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
                this.circuitState = 'HALF_OPEN';
            }
        }
        return this.circuitState;
    }

    /**
     * Retrieves the current number of consecutive model load failures.
     *
     * @returns Non-negative failure count.
     */
    public getFailureCount(): number {
        return this.failureCount;
    }

    /**
     * Thread-safe pipeline initializer guarded by the internal Circuit Breaker.
     *
     * @returns A promise resolving to the underlying `EmbeddingExtractor` function.
     * @throws `CircuitBreakerOpenError` if the circuit is currently OPEN.
     * @throws `Error` if the model cannot be loaded from disk or network.
     */
    public async init(): Promise<EmbeddingExtractor> {
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
            this.extractorPromise = (async () => {
                const releaseLock = await SMLEngine.acquireInitLock();
                try {
                    console.log(`[SML] Loading ${this.modelName} (dtype: ${this.dtype})...`);
                    const { pipeline, env } = await import('@huggingface/transformers');
                    const previousCacheDir = env.cacheDir;
                    const previousAllowRemote = env.allowRemoteModels;
                    const previousLocalModelPath = env.localModelPath;

                    try {
                        if (this.cacheDir) {
                            env.cacheDir = this.cacheDir;
                        }
                        if (this.localFilesOnly !== undefined) {
                            env.allowRemoteModels = !this.localFilesOnly;
                        }

                        const pipelineOptions: Record<string, unknown> = {
                            dtype: this.dtype,
                        };
                        if (this.cacheDir) {
                            pipelineOptions.cache_dir = this.cacheDir;
                        }
                        if (this.localFilesOnly !== undefined) {
                            pipelineOptions.local_files_only = this.localFilesOnly;
                        }

                        const pipelineInstance = await pipeline('feature-extraction', this.modelName, pipelineOptions);

                        // Success: Reset circuit breaker to healthy CLOSED state
                        this.circuitState = 'CLOSED';
                        this.failureCount = 0;
                        const extract: EmbeddingExtractor = async (text, options) => {
                            const output = await pipelineInstance(text, options);
                            const values: ArrayLike<number | bigint> = output.data;
                            const data = output.data instanceof Float32Array ? output.data
                                : Float32Array.from({ length: values.length }, (_, index) => Number(values[index]));
                            return { data, dims: output.dims };
                        };
                        return extract;
                    } finally {
                        env.cacheDir = previousCacheDir;
                        env.allowRemoteModels = previousAllowRemote;
                        env.localModelPath = previousLocalModelPath;
                    }
                } catch (err) {
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
                } finally {
                    releaseLock();
                }
            })();
        }
        return this.extractorPromise;
    }

    /**
     * Generates a unit-normalized embedding vector for a single text input (with RAM LRU caching).
     *
     * @param text - The input text to vectorize. Must not be empty.
     * @returns A `Float32Array` containing the computed normalized embedding vector.
     * @throws `Error` if the input text is blank or model extraction fails.
     *
     * @example
     * ```typescript
     * const vec = await sml.getEmbedding('Corporate travel expense policy');
     * ```
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
     * Generates normalized embedding vectors for an array of texts in high-throughput batch mode.
     *
     * @param texts - Array of string inputs to vectorize.
     * @returns Array of `Float32Array` embedding vectors corresponding to the input order.
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
     * Compares an input query against a list of target items with precomputed embeddings
     * and returns the highest scoring match above the cosine similarity threshold.
     *
     * @typeParam T - Target item type extending `{ id: string; embedding: number[] | Float32Array }`.
     * @param query - The query text to evaluate.
     * @param targets - Array of target items containing precomputed embeddings.
     * @param threshold - Minimum cosine similarity threshold (0.0 to 1.0). Defaults to 0.65.
     * @returns The best matching target and its score, or `null` if no target exceeds the threshold.
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
