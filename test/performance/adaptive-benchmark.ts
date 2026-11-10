import { AdaptiveQueryPlanner } from '../../src/core/adaptive/query-planner.js';
import { StrategyRegistry } from '../../src/core/adaptive/strategy-registry.js';
import { EvidenceFusionEngine } from '../../src/core/adaptive/evidence-fusion.js';
import { MemoryGraphAdapter } from '../../src/adapters/graph/memory-graph.adapter.js';
import type { StrategyExecutionResult } from '../../src/interfaces/strategy.interface.js';

async function runAdaptiveBenchmark() {
    console.log('================================================================================');
    console.log('🚀 AI-RAG-ENGINE Adaptive Multi-Strategy Micro-Benchmark');
    console.log('================================================================================');

    const registry = new StrategyRegistry();
    const planner = new AdaptiveQueryPlanner({ enabled: true, mode: 'auto' }, registry);
    const fusion = new EvidenceFusionEngine({ reciprocalRankK: 60, maxContextTokens: 2500 });
    const graph = new MemoryGraphAdapter();

    // Warm up graph
    for (let i = 0; i < 100; i++) {
        await graph.addNodes([
            { id: `node_${i}`, tenantId: 'tenant-bench', name: `Node ${i}`, type: 'entity', confidence: 1.0 }
        ]);
        if (i > 0) {
            await graph.addEdges([
                { id: `edge_${i}`, tenantId: 'tenant-bench', sourceId: `node_${i - 1}`, targetId: `node_${i}`, relation: 'LINK', category: 'extracted', weight: 1.0, confidence: 1.0 }
            ]);
        }
    }

    const startMem = process.memoryUsage().heapUsed;

    // 1. Benchmark QueryPlanner Signal Extraction
    const iterationsSignals = 20_000;
    const t0 = performance.now();
    for (let i = 0; i < iterationsSignals; i++) {
        planner.extractSignals('Sipariş no TR1234567 kural ve şartlara göre bağlantı zinciri nasıl?');
    }
    const tSignals = performance.now() - t0;
    const opsSignals = Math.round((iterationsSignals / tSignals) * 1000);

    // 2. Benchmark EvidenceFusion RRF Deduplication
    const mockResults: StrategyExecutionResult[] = [
        {
            strategyId: 'traditional_rag',
            success: true,
            executionTimeMs: 10,
            confidence: 0.9,
            evidence: [
                { id: 'ev1', strategyId: 'traditional_rag', sourceDocId: 'doc1', tenantId: 't1', content: 'Enterprise return policy allows returns within 14 days.', score: 0.88 }
            ]
        },
        {
            strategyId: 'hybrid_search',
            success: true,
            executionTimeMs: 8,
            confidence: 0.95,
            evidence: [
                { id: 'ev2', strategyId: 'hybrid_search', sourceDocId: 'doc1', tenantId: 't1', content: 'Enterprise return policy allows returns within 14 days with receipt.', score: 0.92 }
            ]
        }
    ];

    const iterationsFusion = 10_000;
    const t1 = performance.now();
    for (let i = 0; i < iterationsFusion; i++) {
        fusion.fuse(mockResults);
    }
    const tFusion = performance.now() - t1;
    const opsFusion = Math.round((iterationsFusion / tFusion) * 1000);

    // 3. Benchmark Graph Traversal (Neighbors)
    const iterationsGraph = 5_000;
    const t2 = performance.now();
    for (let i = 0; i < iterationsGraph; i++) {
        await graph.getNeighbors('node_50', 'tenant-bench', { maxDepth: 2, maxNodes: 20 });
    }
    const tGraph = performance.now() - t2;
    const opsGraph = Math.round((iterationsGraph / tGraph) * 1000);

    const endMem = process.memoryUsage().heapUsed;

    const rows = [
        {
            Target: 'QueryPlanner.extractSignals (Regex Stems TR/EN)',
            Iterations: iterationsSignals.toLocaleString(),
            'Throughput (ops/sec)': opsSignals.toLocaleString(),
            'Avg Latency': `${(tSignals / iterationsSignals * 1000).toFixed(2)} µs`
        },
        {
            Target: 'EvidenceFusionEngine.fuse (RRF + Deduplication)',
            Iterations: iterationsFusion.toLocaleString(),
            'Throughput (ops/sec)': opsFusion.toLocaleString(),
            'Avg Latency': `${(tFusion / iterationsFusion * 1000).toFixed(2)} µs`
        },
        {
            Target: 'MemoryGraphAdapter.getNeighbors (2-hop BFS)',
            Iterations: iterationsGraph.toLocaleString(),
            'Throughput (ops/sec)': opsGraph.toLocaleString(),
            'Avg Latency': `${(tGraph / iterationsGraph * 1000).toFixed(2)} µs`
        }
    ];

    console.table(rows);
    console.log('================================================================================');
    console.log(`Heap memory: ${(startMem / 1024 / 1024).toFixed(2)} MB -> ${(endMem / 1024 / 1024).toFixed(2)} MB`);
    console.log('================================================================================');
}

runAdaptiveBenchmark().catch(console.error);

