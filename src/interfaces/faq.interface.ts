export interface IFAQAdapter {
    getFaqs(): Promise<Array<{ question: string; answer: string }>>;
}