import fs from 'fs/promises';
import path from 'path';
import type { IFAQAdapter, FAQItem, FAQMatchResult } from '../../interfaces/faq.interface.js';
import { SMLEngine } from '../../core/sml-engine.js';
import { dotProduct } from '../../utils/math.js';

/**
 * Configuration options for the local semantic FAQ adapter.
 */
export interface LocalFaqAdapterOptions {
    /** Absolute or relative path to the FAQ JSON file. */
    filePath?: string | undefined;
    /** Optional pre-configured small model engine for embedding generation. */
    smlEngine?: SMLEngine | undefined;
    /** Minimum cosine similarity threshold to trigger a direct FAQ hit. @defaultValue 0.60 */
    defaultMatchThreshold?: number | undefined;
}

/**
 * Loads pre-computed or dynamically embedded FAQs from local storage.
 *
 * @remarks
 * Matches questions using fast local cosine similarity without invoking external LLMs,
 * achieving zero-token and sub-10ms query resolution.
 *
 * @example
 * ```typescript
 * import { LocalFaqAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const faq = new LocalFaqAdapter({ filePath: './faqs.json' });
 * await faq.init();
 *
 * const match = await faq.findBestMatch('How do I reset my password?');
 * if (match) {
 *   console.log(`Matched FAQ: ${match.answer}`);
 * }
 * ```
 */
export class LocalFaqAdapter implements IFAQAdapter {
    private filePath: string | undefined;
    private smlEngine: SMLEngine;
    private defaultThreshold: number;
    private items: FAQItem[] = [];
    private isLoaded = false;

    /**
     * Initializes a new LocalFaqAdapter instance.
     *
     * @param options - Configuration options (filePath, smlEngine, defaultMatchThreshold).
     */
    constructor(options?: LocalFaqAdapterOptions) {
        this.filePath = options?.filePath;
        this.smlEngine = options?.smlEngine || new SMLEngine();
        this.defaultThreshold = options?.defaultMatchThreshold ?? 0.60;
    }

    /**
     * Replaces or configures the small model engine used for embedding generation.
     *
     * @param engine - SMLEngine instance.
     */
    public setSMLEngine(engine: SMLEngine): void {
        this.smlEngine = engine;
    }

    /**
     * Returns the configured small model engine instance.
     *
     * @returns Current SMLEngine.
     */
    public getSMLEngine(): SMLEngine {
        return this.smlEngine;
    }

    /**
     * Initializes the adapter by reading the JSON file and caching embeddings in RAM.
     */
    public async init(): Promise<void> {
        if (this.isLoaded) return;
        // No implicit demo data or repository-relative paths in a consumer application.
        if (!this.filePath) { this.isLoaded = true; return; }

        try {
            const raw = await fs.readFile(path.resolve(this.filePath), 'utf-8');
            const data = JSON.parse(raw);
            const faqs: FAQItem[] = Array.isArray(data) ? data : data.faqs || [];

            for (const item of faqs) {
                // If embedding is not pre-computed, generate it via SML
                if (!item.embedding || item.embedding.length === 0) {
                    const rawEmbedding = await this.smlEngine.getEmbedding(item.question);
                    item.embedding = Array.from(rawEmbedding);
                }
                this.items.push(item);
            }

            this.isLoaded = true;
            console.log(`[LocalFaqAdapter] Loaded ${this.items.length} FAQs from ${this.filePath}`);
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`[LocalFaqAdapter] Could not load FAQs from ${this.filePath}: ${msg}`);
            this.items = [];
            this.isLoaded = true;
        }
    }

    public async setFaqs(items: FAQItem[]): Promise<void> {
        this.items = [];
        for (const item of items) {
            if (!item.embedding || item.embedding.length === 0) {
                const rawEmbedding = await this.smlEngine.getEmbedding(item.question);
                item.embedding = Array.from(rawEmbedding);
            }
            this.items.push(item);
        }
        this.isLoaded = true;
    }

    public async getFaqs(tenantId?: string): Promise<FAQItem[]> {
        if (!this.isLoaded) await this.init();
        return this.items.filter(item => !item.tenantId || item.tenantId === tenantId);
    }

    /**
     * Finds the best semantically matching FAQ item for a given user query within the caller's tenant boundary.
     */
    public async findBestMatch(query: string, threshold?: number, tenantId?: string): Promise<FAQMatchResult | null> {
        if (!this.isLoaded) await this.init();
        if (this.items.length === 0) return null;

        const effectiveThreshold = threshold ?? this.defaultThreshold;
        const queryEmbedding = await this.smlEngine.getEmbedding(query);
        const queryVector = Array.from(queryEmbedding);

        let bestMatch: FAQItem | null = null;
        let highestScore = -1;

        for (const item of this.items) {
            // Strict Multi-tenant boundary check: Item must either be global (!tenantId) or match the caller's tenantId
            if (item.tenantId && item.tenantId !== tenantId) {
                continue;
            }
            if (!item.embedding) continue;
            const score = dotProduct(queryVector, item.embedding);
            if (score > highestScore) {
                highestScore = score;
                bestMatch = item;
            }
        }

        if (bestMatch && highestScore >= effectiveThreshold) {
            return {
                question: bestMatch.question,
                answer: bestMatch.answer,
                score: highestScore
            };
        }

        return null;
    }
}
