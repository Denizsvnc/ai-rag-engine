export interface FAQItem {
    id?: string | undefined;
    tenantId?: string | undefined;
    question: string;
    answer: string;
    category?: string | undefined;
    embedding?: number[] | undefined;
}

export interface FAQMatchResult {
    question: string;
    answer: string;
    score: number;
}

export interface IFAQAdapter {
    getFaqs(tenantId?: string): Promise<FAQItem[]>;
    findBestMatch?(query: string, threshold?: number, tenantId?: string): Promise<FAQMatchResult | null>;
}