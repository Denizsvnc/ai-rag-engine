import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceFusionEngine } from '../../../src/core/adaptive/evidence-fusion.js';
import type { StrategyExecutionResult } from '../../../src/interfaces/strategy.interface.js';

describe('EvidenceFusionEngine RRF & Contradiction Detection', () => {
    it('deduplicates identical chunks from multiple strategies and boosts RRF score', () => {
        const engine = new EvidenceFusionEngine({ reciprocalRankK: 60 });

        const results: StrategyExecutionResult[] = [
            {
                strategyId: 'traditional_rag',
                success: true,
                executionTimeMs: 20,
                confidence: 0.9,
                evidence: [{
                    id: 'ev1',
                    strategyId: 'traditional_rag',
                    sourceDocId: 'doc_annual_leave',
                    sourceChunkId: 'chunk_1',
                    tenantId: 'tenant-1',
                    content: 'Yıllık izin hakkı 1 yıl çalışanlar için 14 gündür.',
                    score: 0.85
                }]
            },
            {
                strategyId: 'hybrid_search',
                success: true,
                executionTimeMs: 15,
                confidence: 0.95,
                evidence: [{
                    id: 'ev2',
                    strategyId: 'hybrid_search',
                    sourceDocId: 'doc_annual_leave',
                    sourceChunkId: 'chunk_1',
                    tenantId: 'tenant-1',
                    content: 'Yıllık izin hakkı 1 yıl çalışanlar için 14 gündür ve devredilemez.',
                    score: 0.90
                }]
            }
        ];

        const fused = engine.fuse(results);

        // Deduplicated to 1 item
        assert.strictEqual(fused.items.length, 1);
        assert.strictEqual(fused.citations.length, 1);
        assert.strictEqual(fused.citations[0].docId, 'doc_annual_leave');
        // Kept more detailed content
        assert.ok(fused.items[0].content.includes('devredilemez'));
    });

    it('enforces context token budget limit', () => {
        const engine = new EvidenceFusionEngine({ maxContextTokens: 20 }); // Very low budget

        const results: StrategyExecutionResult[] = [
            {
                strategyId: 'semantic_search',
                success: true,
                executionTimeMs: 10,
                confidence: 0.9,
                evidence: [
                    {
                        id: 'ev1',
                        strategyId: 'semantic_search',
                        sourceDocId: 'doc_1',
                        tenantId: 'tenant-1',
                        content: 'Bu çok uzun bir kurumsal politika metnidir ve birçok detay barındırmaktadır.',
                        score: 0.95
                    },
                    {
                        id: 'ev2',
                        strategyId: 'semantic_search',
                        sourceDocId: 'doc_2',
                        tenantId: 'tenant-1',
                        content: 'İkinci metin bütçeyi aştığı için dahil edilmemelidir.',
                        score: 0.80
                    }
                ]
            }
        ];

        const fused = engine.fuse(results);
        assert.strictEqual(fused.items.length, 1);
        assert.strictEqual(fused.items[0].sourceDocId, 'doc_1');
    });

    it('detects direct contradictions between evidence items', () => {
        const engine = new EvidenceFusionEngine({ detectContradictions: true });

        const results: StrategyExecutionResult[] = [
            {
                strategyId: 'traditional_rag',
                success: true,
                executionTimeMs: 10,
                confidence: 0.9,
                evidence: [{
                    id: 'ev_affirmative',
                    strategyId: 'traditional_rag',
                    sourceDocId: 'doc_v1',
                    tenantId: 'tenant-1',
                    content: 'Uzaktan çalışma sistemi cuma günleri tüm personele serbesttir.',
                    score: 0.90
                }]
            },
            {
                strategyId: 'kag',
                success: true,
                executionTimeMs: 15,
                confidence: 0.95,
                evidence: [{
                    id: 'ev_negative',
                    strategyId: 'kag',
                    sourceDocId: 'doc_v2',
                    tenantId: 'tenant-1',
                    content: 'Uzaktan çalışma sistemi cuma günleri tüm personele serbest değildir yasak uygulanır.',
                    score: 0.92
                }]
            }
        ];

        const fused = engine.fuse(results);
        assert.strictEqual(fused.contradictions.length, 1);
        assert.strictEqual(fused.contradictions[0].detected, true);
        assert.ok(fused.contradictions[0].conflictingEvidenceIds.includes('ev_affirmative'));
        assert.ok(fused.contradictions[0].conflictingEvidenceIds.includes('ev_negative'));
    });
});

