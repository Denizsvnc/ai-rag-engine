import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RAGEvaluator } from '../../../src/core/metrics/rag-evaluator.js';
import { MemoryVectorAdapter } from '../../../src/adapters/vector/memory-vector.adapter.js';

describe('Real RAG Quality Evaluation: Bilingual Labeled Benchmark Dataset', () => {
    // Ground Truth Dataset: Turkish & English Enterprise Knowledge Base
    const goldCorpus = [
        // Turkish Domain
        {
            id: 'tr_corp_01',
            tenantId: 'enterprise_corp',
            content: 'Kurumsal iade süresi satın alma tarihinden itibaren 14 iş günüdür. İade kargo ücreti alıcıya aittir.',
            tags: ['iade', 'sure', 'kargo']
        },
        {
            id: 'tr_corp_02',
            tenantId: 'enterprise_corp',
            content: 'Garanti süresi tüm elektronik cihazlar için 24 aydır. Kullanıcı kaynaklı sıvı teması garanti dışıdır.',
            tags: ['garanti', 'sure', 'kapsam']
        },
        {
            id: 'tr_corp_03',
            tenantId: 'enterprise_corp',
            content: 'Ödeme yöntemleri: Kredi kartı, banka havalesi ve kapıda nakit ödeme desteklenmektedir.',
            tags: ['odeme', 'kart', 'havale']
        },
        // English Domain
        {
            id: 'en_corp_01',
            tenantId: 'enterprise_corp',
            content: 'Enterprise SLA guarantees 99.99% uptime for Tier-1 multi-region cloud services.',
            tags: ['sla', 'uptime', 'cloud']
        },
        {
            id: 'en_corp_02',
            tenantId: 'enterprise_corp',
            content: 'Data retention policy strictly purges cold storage logs after 180 calendar days.',
            tags: ['retention', 'compliance', 'purge']
        }
    ];

    it('should achieve Precision@1 >= 0.8 and HitRate == 1.0 across labeled bilingual query dataset', async () => {
        const vectorStore = new MemoryVectorAdapter();

        // Seed knowledge base with real content (MemoryVectorAdapter automatically computes embeddings and indexes BM25)
        await vectorStore.addDocuments(
            goldCorpus.map((doc) => ({
                id: doc.id,
                content: doc.content,
                metadata: { tenantId: doc.tenantId, tags: doc.tags }
            }))
        );

        // Labeled Evaluation Query Matrix
        const queryMatrix = [
            {
                query: 'İade süresi kaç gündür?',
                expectedDocId: 'tr_corp_01',
                expectedAnswer: 'Kurumsal iade süresi satın alma tarihinden itibaren 14 iş günüdür.'
            },
            {
                query: 'Cihaz garanti süresi ne kadar?',
                expectedDocId: 'tr_corp_02',
                expectedAnswer: 'Garanti süresi elektronik cihazlar için 24 aydır.'
            },
            {
                query: 'Hangi ödeme yöntemleri var?',
                expectedDocId: 'tr_corp_03',
                expectedAnswer: 'Kredi kartı, banka havalesi ve kapıda nakit ödeme desteklenmektedir.'
            },
            {
                query: 'What is the enterprise uptime SLA?',
                expectedDocId: 'en_corp_01',
                expectedAnswer: 'Enterprise SLA guarantees 99.99% uptime for Tier-1 services.'
            },
            {
                query: 'How long are logs retained before purge?',
                expectedDocId: 'en_corp_02',
                expectedAnswer: 'Cold storage logs are purged after 180 calendar days.'
            }
        ];

        let totalHits = 0;
        let totalMrrSum = 0;

        for (const item of queryMatrix) {
            // Use searchHybrid which fuses dense ONNX neural embeddings with BM25 sparse retrieval
            const searchResults = await vectorStore.searchHybrid(item.query, 3, { tenantId: 'enterprise_corp' });
            const retrievedIds = searchResults.map(r => r.id);

            const pAt1 = RAGEvaluator.precisionAtK(retrievedIds, [item.expectedDocId], 1);
            const rAt3 = RAGEvaluator.recallAtK(retrievedIds, [item.expectedDocId], 3);
            const mrr = RAGEvaluator.reciprocalRank(retrievedIds, [item.expectedDocId]);

            assert.equal(pAt1, 1.0, `Precision@1 failed for query: "${item.query}". Retrieved: ${retrievedIds.join(', ')}`);
            assert.equal(rAt3, 1.0, `Recall@3 failed for query: "${item.query}"`);
            assert.equal(mrr, 1.0, `MRR failed for query: "${item.query}"`);

            if (pAt1 > 0) totalHits++;
            totalMrrSum += mrr;

            // Faithfulness & Groundedness Evaluation
            const contextText = searchResults.map(r => r.content);
            const evalResult = RAGEvaluator.evaluateFaithfulness(item.expectedAnswer, contextText);

            assert.ok(
                evalResult.score >= 0.7,
                `Groundedness score ${evalResult.score} too low for "${item.query}"`
            );
            assert.equal(
                evalResult.contradictionsDetected.length,
                0,
                `Contradiction falsely detected in truthful answer for "${item.query}"`
            );
        }

        const avgHitRate = totalHits / queryMatrix.length;
        const meanReciprocalRank = totalMrrSum / queryMatrix.length;

        assert.equal(avgHitRate, 1.0, 'Hit rate must be 1.0 across gold standard dataset');
        assert.equal(meanReciprocalRank, 1.0, 'Mean Reciprocal Rank must be 1.0 across gold standard dataset');
    });

    it('should correctly detect ungrounded answers and flag numerical contradictions in both Turkish and English', () => {
        const turkishContext = ['Kullanıcılar siparişlerini 14 gün içinde ücretsiz iade edebilir.'];
        const englishContext = ['Enterprise licenses include 500 team member seats and 24/7 dedicated phone support.'];

        // Turkish numerical contradiction (14 -> 30)
        const trHallucinatedAnswer = 'Kullanıcılar siparişlerini 30 gün içinde iade edebilir.';
        const trEval = RAGEvaluator.evaluateFaithfulness(trHallucinatedAnswer, turkishContext);
        assert.ok(
            trEval.contradictionsDetected.some(c => c.includes('30')),
            'Must flag 30 as a numerical contradiction against context (14)'
        );

        // English numerical contradiction (500 -> 1000)
        const enHallucinatedAnswer = 'The enterprise license grants 1000 member seats.';
        const enEval = RAGEvaluator.evaluateFaithfulness(enHallucinatedAnswer, englishContext);
        assert.ok(
            enEval.contradictionsDetected.some(c => c.includes('1000')),
            'Must flag 1000 as a numerical contradiction against context (500)'
        );
    });

    it('should correctly flag ungrounded negative claims when context makes an affirmative assertion', () => {
        const affirmativeContext = ['Sunucularımız haftalık olarak yedeklenmektedir.'];
        const negativeAnswer = 'Sunucularımız asla yedeklenmez ve yedek yok.';

        const evalResult = RAGEvaluator.evaluateFaithfulness(negativeAnswer, affirmativeContext);
        assert.ok(
            evalResult.contradictionsDetected.some(c => c.includes('Polarity Warning')),
            'Must flag negation polarity warning when context does not support negative claim'
        );
    });
});
