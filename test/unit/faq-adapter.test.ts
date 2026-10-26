import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalFaqAdapter } from '../../src/adapters/faq/local-faq.adapter';

describe('FAQ Layer - LocalFaqAdapter', () => {
    const adapter = new LocalFaqAdapter({
        filePath: './src/utils/faq-embeddings.json',
        defaultMatchThreshold: 0.60
    });

    it('should initialize and load bilingual FAQ items', async () => {
        const faqs = await adapter.getFaqs();
        assert.ok(faqs.length >= 10);
        assert.ok(faqs.some(f => f.id === 'faq_return_policy_tr'));
        assert.ok(faqs.some(f => f.id === 'faq_return_policy_en'));
    });

    it('should find high-confidence match for paraphrased return query', async () => {
        const match = await adapter.findBestMatch('ürünü kaç gün içinde iade edebilirim?');
        assert.ok(match !== null);
        assert.ok(match.answer.includes('14 gün'));
        assert.ok(match.score > 0.60);
    });

    it('should find high-confidence match for English return query', async () => {
        const match = await adapter.findBestMatch('how many days do I have to return an item?');
        assert.ok(match !== null);
        assert.ok(match.answer.includes('14 days'));
        assert.ok(match.score > 0.60);
    });

    it('should return null for unrelated questions exceeding threshold', async () => {
        const match = await adapter.findBestMatch('Mars gezegeninin yerçekimi kuvveti nedir?');
        assert.equal(match, null);
    });
});
