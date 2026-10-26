import fs from 'fs/promises';
import path from 'path';
import type { IFAQAdapter, FAQItem, FAQMatchResult } from '../../interfaces/faq.interface';
import { SMLEngine } from '../../core/sml-engine';
import { dotProduct } from '../../utils/math';

export interface LocalFaqAdapterOptions {
    filePath?: string | undefined;
    smlEngine?: SMLEngine | undefined;
    defaultMatchThreshold?: number | undefined;
}

/**
 * Loads pre-computed or dynamically embedded FAQs from a local JSON file.
 * Enables zero-token, sub-10ms semantic question answering via local cosine similarity.
 */
export class LocalFaqAdapter implements IFAQAdapter {
    private filePath: string;
    private smlEngine: SMLEngine;
    private defaultThreshold: number;
    private items: FAQItem[] = [];
    private isLoaded = false;

    constructor(options?: LocalFaqAdapterOptions) {
        this.filePath = options?.filePath || './src/utils/faq-embeddings.json';
        this.smlEngine = options?.smlEngine || new SMLEngine();
        this.defaultThreshold = options?.defaultMatchThreshold ?? 0.60;
    }

    /**
     * Initializes the adapter by reading the JSON file and caching embeddings in RAM.
     */
    public async init(): Promise<void> {
        if (this.isLoaded) return;

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
        } catch (error: any) {
            console.warn(`[LocalFaqAdapter] Could not load FAQs from ${this.filePath}: ${error.message}`);
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
