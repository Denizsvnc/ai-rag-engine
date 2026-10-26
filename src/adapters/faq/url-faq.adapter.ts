import type { IFAQAdapter } from '../../interfaces/faq.interface';

export class UrlFaqAdapter implements IFAQAdapter {
    private endpoint: string;
    private headers?: Record<string, string> | undefined;

    /**
     * @param endpoint Remote URL returning FAQ JSON data
     * @param headers Optional request headers (e.g. authorization tokens)
     */
    constructor(endpoint: string, headers?: Record<string, string>) {
        this.endpoint = endpoint;
        if (headers) this.headers = headers;
    }

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

        } catch (error: any) {
            console.error('[UrlFaqAdapter] Failed to fetch FAQs:', error.message);
            // Return empty array on failure to prevent pipeline failure
            return [];
        }
    }
}