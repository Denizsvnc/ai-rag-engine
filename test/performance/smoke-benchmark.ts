import { performance } from 'node:perf_hooks';
import { PIIGuard } from '../../src/core/security/pii-guard.js';
import { CacheManager } from '../../src/core/cache-manager.js';
import { DocumentIngestionService } from '../../src/services/document-ingestion.service.js';
import { TokenTracker } from '../../src/core/metrics/token-tracker.js';
import { dotProduct } from '../../src/utils/math.js';

interface BenchResult {
    name: string;
    category: 'CPU' | 'In-Memory Async' | 'Local ONNX' | 'Network I/O';
    iterations: number;
    totalMs: number;
    opsPerSec: number;
    avgLatencyUs: number;
    p50LatencyUs: number;
    p95LatencyUs: number;
    p99LatencyUs: number;
}

function runBench(name: string, iterations: number, fn: () => void, warmup = 100): BenchResult {
    // Warm-up JIT
    for (let w = 0; w < warmup; w++) {
        fn();
    }

    const times: number[] = new Array(iterations);

    const startTotal = performance.now();
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        fn();
        times[i] = (performance.now() - t0) * 1000; // microseconds
    }
    const endTotal = performance.now();
    const totalMs = endTotal - startTotal;

    times.sort((a, b) => a - b);
    const avgLatencyUs = Number((times.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p50LatencyUs = Number(times[Math.floor(iterations * 0.5)]!.toFixed(2));
    const p95LatencyUs = Number(times[Math.floor(iterations * 0.95)]!.toFixed(2));
    const p99LatencyUs = Number(times[Math.floor(iterations * 0.99)]!.toFixed(2));
    const opsPerSec = Math.floor((iterations / totalMs) * 1000);

    return {
        name,
        category: 'CPU',
        iterations,
        totalMs: Number(totalMs.toFixed(2)),
        opsPerSec,
        avgLatencyUs,
        p50LatencyUs,
        p95LatencyUs,
        p99LatencyUs
    };
}

async function runAsyncBench(
    name: string,
    category: 'In-Memory Async' | 'Local ONNX' | 'Network I/O',
    iterations: number,
    fn: () => Promise<unknown>,
    warmup = 50
): Promise<BenchResult> {
    // Warm-up JIT and caches
    for (let w = 0; w < warmup; w++) {
        await fn();
    }

    const times: number[] = new Array(iterations);

    const startTotal = performance.now();
    for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        await fn();
        times[i] = (performance.now() - t0) * 1000; // microseconds
    }
    const endTotal = performance.now();
    const totalMs = endTotal - startTotal;

    times.sort((a, b) => a - b);
    const avgLatencyUs = Number((times.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p50LatencyUs = Number(times[Math.floor(iterations * 0.5)]!.toFixed(2));
    const p95LatencyUs = Number(times[Math.floor(iterations * 0.95)]!.toFixed(2));
    const p99LatencyUs = Number(times[Math.floor(iterations * 0.99)]!.toFixed(2));
    const opsPerSec = Math.floor((iterations / totalMs) * 1000);

    return {
        name,
        category,
        iterations,
        totalMs: Number(totalMs.toFixed(2)),
        opsPerSec,
        avgLatencyUs,
        p50LatencyUs,
        p95LatencyUs,
        p99LatencyUs
    };
}

async function main() {
    console.log('='.repeat(80));
    console.log('🚀 AI-RAG-ENGINE In-Memory Micro-Benchmark');
    console.log('='.repeat(80));

    const heapStartBytes = process.memoryUsage().heapUsed;

    // 1. PII Guard Sanitization Benchmark (Synchronous CPU)
    const sampleText =
        'Müşteri Mehmet Bey, T.C. Kimlik No: 10000000146 ve Kart: 4532-0150-1234-5671 ile ödeme yaptı. ' +
        'İletişim: mehmet@firma.com, Tel: 05321234567, IBAN: TR330006100512345678901234.';

    const piiBench = runBench('PIIGuard.sanitize (TCKN+Luhn+IBAN)', 10000, () => {
        PIIGuard.sanitize(sampleText);
    });

    // 2. Cache Lookup Benchmark (Asynchronous In-Memory)
    const cache = new CacheManager(undefined, 1, 5000, 3600000);
    await cache.init();
    await cache.set('fiyat nedir', { answer: '150 TL', intent: 'FAQ', resolvedBy: 'CACHE', latencyMs: 0 });

    const cacheBench = await runAsyncBench('CacheManager.get (In-Memory Hot Path, Async)', 'In-Memory Async', 10000, async () => {
        await cache.get('fiyat nedir');
    });

    // 3. Dot Product Vector Scoring (384-dimensional unit vectors, Synchronous CPU)
    const vecA = new Float32Array(384).map(() => Math.random() - 0.5);
    const vecB = new Float32Array(384).map(() => Math.random() - 0.5);
    const dotBench = runBench('Dot Product (384-dim all-MiniLM-L6-v2)', 50000, () => {
        dotProduct(vecA as unknown as number[], vecB as unknown as number[]);
    });

    // 4. Document Text Chunking (Synchronous CPU)
    const sampleDoc = ('Paragraf 1 metin içeriği ve kurumsal detaylar.\n\n').repeat(20);
    const chunkBench = runBench('Document Chunking & Magic Bytes Gate', 5000, () => {
        DocumentIngestionService.chunkText(sampleDoc, 200, 30);
    });

    // 5. Token Tracker FinOps Tracking (Synchronous in-memory Map)
    const tracker = new TokenTracker();
    const tokenBench = runBench('TokenTracker FinOps Recording', 20000, () => {
        tracker.trackQuery({
            source: 'CACHE',
            userPrompt: sampleText,
            answer: 'Ödeme onaylandı.',
            latencyMs: 1.2
        });
    });

    // 6. BM25 Lexical Keyword Search (In-Memory Inverted Index)
    const { BM25Index } = await import('../../src/core/vector/bm25.js');
    const bm25 = new BM25Index();
    const docs = [];
    for (let i = 0; i < 500; i++) {
        docs.push({
            id: `doc_${i}`,
            content: `Product LAPTOP-X${i} with 32GB RAM, 1TB NVMe SSD, and high-performance processor.`
        });
    }
    bm25.index(docs);
    const bm25Bench = runBench('BM25Index.search (500-Doc Sparse Corpus)', 2000, () => {
        bm25.search('LAPTOP-X42 32GB NVMe', 5);
    });

    // 7. RedisCacheAdapter In-Memory Fallback Path (Asynchronous, no remote network I/O)
    const { RedisCacheAdapter } = await import('../../src/adapters/cache/redis-cache.adapter.js');
    const redisCache = new RedisCacheAdapter({ enableFallbackMemory: true });
    await redisCache.set('hot_item', { sku: 'PRO-100', stock: 45, priceUsd: 1299.99 });
    const redisBench = await runAsyncBench('RedisCacheAdapter.get (In-Memory Fallback LRU, Async)', 'In-Memory Async', 10000, async () => {
        await redisCache.get('hot_item');
    });

    const results = [piiBench, cacheBench, dotBench, chunkBench, tokenBench, bm25Bench, redisBench];

    // 8. Local ONNX Embedding Inference Benchmark (SMLEngine)
    try {
        const { SMLEngine } = await import('../../src/core/sml-engine.js');
        const sml = new SMLEngine();
        await sml.init();
        const onnxBench = await runAsyncBench(
            'SMLEngine.getEmbedding (Local ONNX, 384-dim)',
            'Local ONNX',
            50,
            async () => {
                await sml.getEmbedding('Müşteri iade politikası ve garanti süresi');
            },
            5
        );
        results.push(onnxBench);
    } catch (e: any) {
        console.warn(`[Benchmark] Skipping Local ONNX inference benchmark: ${e.message}`);
    }

    // 9. Real Redis Network Roundtrip Benchmark (Conditional on REDIS_TEST_URL)
    if (process.env.REDIS_TEST_URL) {
        try {
            const { Redis } = await import('ioredis');
            const redisClient = new Redis(process.env.REDIS_TEST_URL);
            await redisClient.set('bench:network_key', 'benchmark_payload');
            const redisNetBench = await runAsyncBench(
                'Redis Network Roundtrip (ioredis GET, Real TCP)',
                'Network I/O',
                1000,
                async () => {
                    await redisClient.get('bench:network_key');
                },
                50
            );
            results.push(redisNetBench);
            await redisClient.quit();
        } catch (e: any) {
            console.warn(`[Benchmark] Skipping Redis Network benchmark: ${e.message}`);
        }
    }

    // 10. Real PostgreSQL pgvector Cosine Search Benchmark (Conditional on PG_TEST_URL)
    if (process.env.PG_TEST_URL) {
        try {
            const { PostgresVectorAdapter } = await import('../../src/adapters/vector/postgres-vector.adapter.js');
            const pgAdapter = new PostgresVectorAdapter({
                connectionString: process.env.PG_TEST_URL,
                tableName: 'benchmark_embeddings'
            });
            await pgAdapter.init();
            const benchVec = new Array(384).fill(0.05);
            await pgAdapter.addDocuments([{
                id: 'bench_doc_1',
                content: 'Benchmark document for cosine search evaluation',
                metadata: { tenantId: 'bench_tenant' }
            }]);
            const pgBench = await runAsyncBench(
                'PostgresVectorAdapter.search (pgvector Cosine, Real DB)',
                'Network I/O',
                100,
                async () => {
                    await pgAdapter.search('Benchmark document', 5, { tenantId: 'bench_tenant' });
                },
                10
            );
            results.push(pgBench);
            await pgAdapter.close();
        } catch (e: any) {
            console.warn(`[Benchmark] Skipping Postgres pgvector benchmark: ${e.message}`);
        }
    }

    const heapEndBytes = process.memoryUsage().heapUsed;
    const heapDeltaMb = ((heapEndBytes - heapStartBytes) / (1024 * 1024)).toFixed(2);

    console.log('');
    console.table(
        results.map(r => ({
            'Benchmark Target': r.name,
            'Category': r.category,
            'Iterations': r.iterations.toLocaleString(),
            'Throughput (ops/sec)': r.opsPerSec.toLocaleString(),
            'Avg Latency': `${r.avgLatencyUs} µs`,
            'p50 Latency': `${r.p50LatencyUs} µs`,
            'p95 Latency': `${r.p95LatencyUs} µs`,
            'p99 Latency': `${r.p99LatencyUs} µs`
        }))
    );

    console.log('='.repeat(80));
    console.log(`Heap memory footprint: ${(heapStartBytes / 1024 / 1024).toFixed(2)} MB -> ${(heapEndBytes / 1024 / 1024).toFixed(2)} MB (Delta: ${heapDeltaMb} MB)`);
    console.log('Methodology note: Explicit separation between CPU hot-paths, in-memory async, local ONNX neural inference, and real network I/O.');
    console.log('='.repeat(80));
}

main().catch(err => {
    console.error('[Benchmark Failure]', err);
    process.exit(1);
});
