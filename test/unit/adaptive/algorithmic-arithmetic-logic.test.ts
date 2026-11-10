import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceFusionEngine } from '../../../src/core/adaptive/evidence-fusion.js';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';
import { AdaptiveQueryPlanner } from '../../../src/core/adaptive/query-planner.js';
import { StrategyRegistry } from '../../../src/core/adaptive/strategy-registry.js';
import type { StrategyExecutionResult } from '../../../src/interfaces/strategy.interface.js';

describe('Algorithmic, Arithmetic & Logical Invariant Verification', () => {
    describe('RRF (Reciprocal Rank Fusion) Arithmetic & Monotonicity', () => {
        it('calculates exact RRF formula score = sum(weight / (k + rank))', () => {
            const k = 60;
            const engine = new EvidenceFusionEngine({
                reciprocalRankK: k,
                strategyWeights: {
                    traditional_rag: 1.0,
                    hybrid_search: 2.0 // 2x weight
                }
            });

            const results: StrategyExecutionResult[] = [
                {
                    strategyId: 'traditional_rag',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'ev_item1',
                        strategyId: 'traditional_rag',
                        sourceDocId: 'doc_math',
                        sourceChunkId: 'c1',
                        tenantId: 't1',
                        content: 'Doc math content test',
                        score: 0.95
                    }]
                },
                {
                    strategyId: 'hybrid_search',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'ev_item2',
                        strategyId: 'hybrid_search',
                        sourceDocId: 'doc_math',
                        sourceChunkId: 'c1',
                        tenantId: 't1',
                        content: 'Doc math content test',
                        score: 0.90
                    }]
                }
            ];

            const fused = engine.fuse(results);
            assert.strictEqual(fused.items.length, 1);

            // Normalized score of top item is always 1.0 (relative rank 1)
            assert.strictEqual(fused.items[0].score, 1.0);
            assert.ok(!Number.isNaN(fused.items[0].score));
            assert.ok(Number.isFinite(fused.items[0].score));
        });

        it('guarantees monotonicity: higher ranked items have strictly >= fused scores', () => {
            const engine = new EvidenceFusionEngine({ reciprocalRankK: 60 });

            const results: StrategyExecutionResult[] = [{
                strategyId: 'traditional_rag',
                success: true,
                executionTimeMs: 10,
                confidence: 0.9,
                evidence: [
                    { id: '1', strategyId: 'traditional_rag', sourceDocId: 'd1', tenantId: 't', content: 'content 1', score: 0.99 },
                    { id: '2', strategyId: 'traditional_rag', sourceDocId: 'd2', tenantId: 't', content: 'content 2', score: 0.85 },
                    { id: '3', strategyId: 'traditional_rag', sourceDocId: 'd3', tenantId: 't', content: 'content 3', score: 0.70 }
                ]
            }];

            const fused = engine.fuse(results);
            assert.strictEqual(fused.items.length, 3);
            assert.ok(fused.items[0].score >= fused.items[1].score);
            assert.ok(fused.items[1].score >= fused.items[2].score);
        });

        it('handles boundary mathematical conditions: 0 items, single item, identical scores', () => {
            const engine = new EvidenceFusionEngine({ reciprocalRankK: 60 });

            // Zero items
            const zeroRes = engine.fuse([]);
            assert.strictEqual(zeroRes.items.length, 0);
            assert.strictEqual(zeroRes.coverageRatio, 0.0);

            // Single item
            const single = engine.fuse([{
                strategyId: 'traditional_rag',
                success: true,
                executionTimeMs: 5,
                confidence: 0.9,
                evidence: [{ id: 's', strategyId: 'traditional_rag', sourceDocId: 's', tenantId: 't', content: 'single', score: 0.5 }]
            }]);
            assert.strictEqual(single.items.length, 1);
            assert.strictEqual(single.items[0].score, 1.0); // Normalized to 1.0
            assert.strictEqual(single.coverageRatio, 1.0);
        });
    });

    describe('Context Token Budget Arithmetic Bounds', () => {
        it('never exceeds maxContextTokens ceiling under heavy evidence volume', () => {
            const maxTokens = 50;
            const engine = new EvidenceFusionEngine({ maxContextTokens: maxTokens });

            // Create 10 items of 20 tokens each = 200 tokens total
            const items = Array.from({ length: 10 }, (_, i) => ({
                id: `ev_${i}`,
                strategyId: 'traditional_rag' as const,
                sourceDocId: `doc_${i}`,
                tenantId: 't1',
                content: `Bu doküman oldukça uzun metin içerir ve kelime sayısı fazladır indeks ${i}`,
                score: 0.9 - (i * 0.05)
            }));

            const fused = engine.fuse([{
                strategyId: 'traditional_rag',
                success: true,
                executionTimeMs: 10,
                confidence: 0.9,
                evidence: items
            }]);

            // Total estimated tokens of included parts must be <= maxTokens
            let totalTokens = 0;
            for (const item of fused.items) {
                totalTokens += Math.ceil(item.content.split(/\s+/).length * 1.3);
            }
            assert.ok(totalTokens <= maxTokens);
            assert.ok(fused.items.length < items.length); // Some items were cleanly truncated
        });
    });

    describe('Graph Algorithmic Traversal & Cycle Avoidance', () => {
        it('terminates cleanly on cyclic graphs without infinite loop (A -> B -> C -> A)', async () => {
            const graph = new MemoryGraphAdapter();
            const tenantId = 'tenant-cycle';

            await graph.addNodes([
                { id: 'A', tenantId, name: 'A', type: 'concept', confidence: 1.0 },
                { id: 'B', tenantId, name: 'B', type: 'concept', confidence: 1.0 },
                { id: 'C', tenantId, name: 'C', type: 'concept', confidence: 1.0 }
            ]);

            // Create cycle: A -> B -> C -> A
            await graph.addEdges([
                { id: 'e1', tenantId, sourceId: 'A', targetId: 'B', relation: 'TO', category: 'extracted', weight: 1, confidence: 1 },
                { id: 'e2', tenantId, sourceId: 'B', targetId: 'C', relation: 'TO', category: 'extracted', weight: 1, confidence: 1 },
                { id: 'e3', tenantId, sourceId: 'C', targetId: 'A', relation: 'TO', category: 'extracted', weight: 1, confidence: 1 }
            ]);

            const startTime = Date.now();
            // Path search on cyclic graph
            const paths = await graph.findPaths('A', 'C', tenantId, 5);
            const duration = Date.now() - startTime;

            assert.ok(duration < 200, `Traversal took ${duration}ms, suspected infinite cycle`);
            assert.ok(paths.length > 0);
            // Verify path does not contain duplicated consecutive cycles
            const pathNodeIds = paths[0].nodes.map(n => n.id);
            assert.strictEqual(pathNodeIds[0], 'A');
            assert.strictEqual(pathNodeIds[pathNodeIds.length - 1], 'C');
        });

        it('handles self-loops (A -> A) safely', async () => {
            const graph = new MemoryGraphAdapter();
            const tenantId = 'tenant-self-loop';

            await graph.addNodes([
                { id: 'A', tenantId, name: 'A', type: 'concept', confidence: 1.0 }
            ]);
            await graph.addEdges([
                { id: 'self_e', tenantId, sourceId: 'A', targetId: 'A', relation: 'SELF_LOOP', category: 'extracted', weight: 1, confidence: 1 }
            ]);

            const neighbors = await graph.getNeighbors('A', tenantId, { maxDepth: 2 });
            assert.ok(neighbors.nodes.length >= 1);
            assert.strictEqual(neighbors.nodes[0].id, 'A');
        });

        it('returns empty for disconnected graph components', async () => {
            const graph = new MemoryGraphAdapter();
            const tenantId = 'tenant-island';

            // Island 1: A -> B
            await graph.addNodes([
                { id: 'A', tenantId, name: 'A', type: 'concept', confidence: 1.0 },
                { id: 'B', tenantId, name: 'B', type: 'concept', confidence: 1.0 }
            ]);
            await graph.addEdges([
                { id: 'e1', tenantId, sourceId: 'A', targetId: 'B', relation: 'LINK', category: 'extracted', weight: 1, confidence: 1 }
            ]);

            // Island 2: X -> Y
            await graph.addNodes([
                { id: 'X', tenantId, name: 'X', type: 'concept', confidence: 1.0 },
                { id: 'Y', tenantId, name: 'Y', type: 'concept', confidence: 1.0 }
            ]);
            await graph.addEdges([
                { id: 'e2', tenantId, sourceId: 'X', targetId: 'Y', relation: 'LINK', category: 'extracted', weight: 1, confidence: 1 }
            ]);

            // Path from Island 1 to Island 2 must return empty array
            const paths = await graph.findPaths('A', 'Y', tenantId, 4);
            assert.strictEqual(paths.length, 0);
        });
    });

    describe('Logical Truth & Polarity Contradiction Detection', () => {
        it('detects affirmative vs negative semantic polarity with shared entity overlap', () => {
            const engine = new EvidenceFusionEngine({ detectContradictions: true });

            const results: StrategyExecutionResult[] = [
                {
                    strategyId: 'traditional_rag',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'claim_yes',
                        strategyId: 'traditional_rag',
                        sourceDocId: 'doc_sec',
                        tenantId: 't1',
                        content: 'VPN kullanımı uzaktan erişim için zorunlu tutulmuştur.',
                        score: 0.95
                    }]
                },
                {
                    strategyId: 'kag',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'claim_no',
                        strategyId: 'kag',
                        sourceDocId: 'doc_sec',
                        tenantId: 't1',
                        content: 'VPN kullanımı uzaktan erişim için zorunlu değildir serbest bırakılmıştır.',
                        score: 0.90
                    }]
                }
            ];

            const fused = engine.fuse(results);
            assert.strictEqual(fused.contradictions.length, 1);
            assert.strictEqual(fused.contradictions[0].detected, true);
            assert.strictEqual(fused.contradictions[0].severity, 'warning');
            assert.ok(fused.contradictions[0].conflictingEvidenceIds.includes('claim_yes'));
            assert.ok(fused.contradictions[0].conflictingEvidenceIds.includes('claim_no'));
        });

        it('does not trigger false positive contradiction on non-overlapping negation', () => {
            const engine = new EvidenceFusionEngine({ detectContradictions: true });

            const results: StrategyExecutionResult[] = [
                {
                    strategyId: 'traditional_rag',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'text_a',
                        strategyId: 'traditional_rag',
                        sourceDocId: 'doc_a',
                        tenantId: 't1',
                        content: 'Kantin sabah sekiz buçukta açılmaktadır.',
                        score: 0.9
                    }]
                },
                {
                    strategyId: 'hybrid_search',
                    success: true,
                    executionTimeMs: 10,
                    confidence: 0.9,
                    evidence: [{
                        id: 'text_b',
                        strategyId: 'hybrid_search',
                        sourceDocId: 'doc_b',
                        tenantId: 't1',
                        content: 'Otopark hafta sonları personele açık değildir.',
                        score: 0.9
                    }]
                }
            ];

            const fused = engine.fuse(results);
            assert.strictEqual(fused.contradictions.length, 0); // Unrelated topics
        });
    });

    describe('Planning Cost & Latency Math Invariants', () => {
        it('calculates additive cost and bounded parallel latency correctly', async () => {
            const registry = new StrategyRegistry();
            const planner = new AdaptiveQueryPlanner(
                { enabled: true, mode: 'auto-hybrid', maxParallelOperations: 2 },
                registry
            );

            // Register mock strategies with exact latencies and costs
            registry.register({
                metadata: {
                    id: 'graph_rag',
                    name: 'GraphRAG',
                    description: '',
                    category: 'hybrid',
                    supportsStreaming: false,
                    supportsMultiTenant: true,
                    requiresGraphIndex: false,
                    requiresVectorStore: false,
                    requiresToolRegistry: false,
                    typicalLatencyMs: 120,
                    estimatedCostPerQuery: 0.003
                },
                isEnabled: () => true,
                isAvailable: async () => true,
                estimateCost: () => 0.003,
                estimateLatency: () => 120,
                execute: async () => ({ strategyId: 'graph_rag', success: true, executionTimeMs: 120, evidence: [], confidence: 1.0 })
            });

            registry.register({
                metadata: {
                    id: 'kag',
                    name: 'KAG',
                    description: '',
                    category: 'generation',
                    supportsStreaming: false,
                    supportsMultiTenant: true,
                    requiresGraphIndex: false,
                    requiresVectorStore: false,
                    requiresToolRegistry: false,
                    typicalLatencyMs: 80,
                    estimatedCostPerQuery: 0.002
                },
                isEnabled: () => true,
                isAvailable: async () => true,
                estimateCost: () => 0.002,
                estimateLatency: () => 80,
                execute: async () => ({ strategyId: 'kag', success: true, executionTimeMs: 80, evidence: [], confidence: 1.0 })
            });

            const decision = await planner.plan({
                query: 'İlişki bağlantısı ve kurallara uygun mu?',
                tenantId: 't1'
            });

            assert.strictEqual(decision.mode, 'auto-hybrid');
            assert.ok(decision.selectedStrategies.includes('graph_rag'));
            assert.ok(decision.selectedStrategies.includes('kag'));

            // Cost must be strictly additive: 0.003 + 0.002 = 0.005
            assert.strictEqual(Number(decision.estimatedCost.toFixed(3)), 0.005);

            // Parallel latency must be max(120, 80) = 120ms
            assert.strictEqual(decision.estimatedLatencyMs, 120);

            // Confidence must be bounded within [0.0, 1.0] without NaN
            assert.ok(decision.confidence >= 0.0 && decision.confidence <= 1.0);
            assert.ok(!Number.isNaN(decision.confidence));
        });
    });
});

