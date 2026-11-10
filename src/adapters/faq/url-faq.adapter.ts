import type { IFAQAdapter } from '../../interfaces/faq.interface.js';

/**
 * FAQ adapter fetching dynamic question-and-answer pairs from a remote JSON REST endpoint.
 *
 * @remarks
 * Implements {@link IFAQAdapter} to support remote centralized FAQ management services.
 *
 * @example
 * ```typescript
 * import { UrlFaqAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const faqAdapter = new UrlFaqAdapter('https://api.example.com/faqs', {
 *   Authorization: 'Bearer secret_token'
 * });
 *
 * const items = await faqAdapter.getFaqs();
 * ```
 */
export class UrlFaqAdapter implements IFAQAdapter {
    private endpoint: string;
    private headers?: Record<string, string> | undefined;

    /**
     * Initializes a new UrlFaqAdapter instance.
     *
     * @param endpoint - Remote URL returning an array of `{ question: string, answer: string }`.
     * @param headers - Optional HTTP request headers (e.g. authorization or tenant tokens).
     */
    constructor(endpoint: string, headers?: Record<string, string>) {
        this.endpoint = endpoint;
        if (headers) this.headers = headers;
    }

    /**
     * Fetches FAQ pairs from the configured remote endpoint.
     *
     * @returns Array of question and answer items, or empty array if request fails.
     */
    public async getFaqs(): Promise<Array<{ question: string; answer: string }>> {
        try {
            console.log(`[UrlFaqAdapter] Fetching FAQs from: ${this.endpoint}`);

            const response = await fetch(this.endpoint, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers
                }
            });

            if (!response.ok) {
                throw new Error(`API request failed with status code: ${response.status}`);
            }

            // Assumes the endpoint returns an array of { question: string, answer: string }
            const data = await response.json();

            console.log(`[UrlFaqAdapter] Successfully fetched ${data.length} FAQs.`);
            return data as Array<{ question: string; answer: string }>;

        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[UrlFaqAdapter] Failed to fetch FAQs:', msg);
            // Return empty array on failure to prevent pipeline failure
            return [];
        }
    }
}