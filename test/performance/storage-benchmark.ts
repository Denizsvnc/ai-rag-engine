import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryVectorAdapter } from '../../src/adapters/vector/memory-vector.adapter.js';
import { SqliteVectorAdapter } from '../../src/adapters/vector/sqlite-vector.adapter.js';
import { SqliteDocumentAdapter } from '../../src/adapters/document/sqlite-document.adapter.js';
import { MemoryIngestionStore } from '../../src/core/ingestion/memory-ingestion-store.js';
import { MemoryBlobStore } from '../../src/adapters/blob/memory-blob.adapter.js';
import { LocalFsBlobStore } from '../../src/adapters/blob/local-fs-blob.adapter.js';

interface BenchResult {
    name: string;
    category: 'In-Memory RAM' | 'Local Persistent SQLite' | 'Local Disk I/O';
    iterations: number;
    totalMs: number;
    opsPerSec: number;
    avgLatencyUs: number;
    p50LatencyUs: number;
    p95LatencyUs: number;
    p99LatencyUs: number;
}

async function runAsyncBench(
    name: string,
    category: 'In-Memory RAM' | 'Local Persistent SQLite' | 'Local Disk I/O',
    iterations: number,
    fn: () => Promise<unknown>,
    warmup = 20
): Promise<BenchResult> {
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
    console.log('⚡ AI-RAG-ENGINE Storage Provider Micro-Benchmark');
    console.log('='.repeat(80));

    const heapStart = process.memoryUsage().heapUsed;
    const results: BenchResult[] = [];

    // 1. MemoryVectorAdapter Search
    const memVector = new MemoryVectorAdapter();
    for (let i = 0; i < 50; i++) {
        await memVector.addDocuments([{
            id: `doc_${i}`,
            content: `Enterprise knowledge chunk ${i} regarding cloud security policies and retention guidelines.`,
            metadata: { tenantId: 'tenant_bench' }
        }]);
    }

    const memVecBench = await runAsyncBench(
        'MemoryVectorAdapter.search (50 Chunks, In-Memory RAM)',
        'In-Memory RAM',
        1000,
        async () => {
            await memVector.search('cloud security policies', 5, { tenantId: 'tenant_bench' });
        }
    );
    results.push(memVecBench);

    // 2. SqliteVectorAdapter Search (Node.js native node:sqlite)
    const sqlitePath = path.resolve(process.cwd(), 'bench-vectors.sqlite');
    if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
    const sqliteVector = new SqliteVectorAdapter({ filePath: sqlitePath });
    await sqliteVector.init();
    for (let i = 0; i < 50; i++) {
        await sqliteVector.addDocuments([{
            id: `doc_${i}`,
            content: `Enterprise knowledge chunk ${i} regarding cloud security policies and retention guidelines.`,
            metadata: { tenantId: 'tenant_bench' }
        }]);
    }

    const sqliteVecBench = await runAsyncBench(
        'SqliteVectorAdapter.search (50 Chunks, Local Persistent SQLite)',
        'Local Persistent SQLite',
        1000,
        async () => {
            await sqliteVector.search('cloud security policies', 5, { tenantId: 'tenant_bench' });
        }
    );
    results.push(sqliteVecBench);
    await sqliteVector.close();
    if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);

    // 3. SqliteDocumentAdapter Put & Get (ACID Transactions)
    const docStore = new SqliteDocumentAdapter({ filePath: ':memory:' });
    await docStore.init();

    const docBench = await runAsyncBench(
        'SqliteDocumentAdapter.putDocument + getDocument (ACID in-memory SQLite)',
        'Local Persistent SQLite',
        2000,
        async () => {
            await docStore.putDocument({
                id: 'doc_bench_1',
                tenantId: 'tenant_bench',
                content: 'Full legal text payload for enterprise compliance.',
                metadata: { type: 'compliance' }
            });
            await docStore.getDocument('doc_bench_1', 'tenant_bench');
        }
    );
    results.push(docBench);
    await docStore.close();

    // 4. MemoryIngestionStore Put & Deduplication
    const ingestionStore = new MemoryIngestionStore();
    const payload = Buffer.from('Binary buffer text payload for document chunking benchmark.');

    const ingBench = await runAsyncBench(
        'MemoryIngestionStore.put (Quota + SHA256 Deduplication)',
        'In-Memory RAM',
        2000,
        async () => {
            await ingestionStore.put({
                tenantId: 'tenant_bench',
                userId: 'user_bench',
                documentId: 'doc_ingest_1',
                filename: 'benchmark.txt',
                content: payload,
                settings: { chunkSize: 200, chunkOverlap: 20 }
            }, { maxPending: 10000, maxStoredBytes: 50 * 1024 * 1024 });
        }
    );
    results.push(ingBench);

    // 5. MemoryBlobStore Put & Get
    const memBlob = new MemoryBlobStore();
    const blobPayload = Buffer.from('x'.repeat(1024)); // 1KB blob

    const blobMemBench = await runAsyncBench(
        'MemoryBlobStore.put + get (1KB Buffer, In-Memory RAM)',
        'In-Memory RAM',
        5000,
        async () => {
            await memBlob.put('bench/file.bin', blobPayload, 'tenant_bench');
            await memBlob.get('bench/file.bin', 'tenant_bench');
        }
    );
    results.push(blobMemBench);

    // 6. LocalFsBlobStore Put & Get
    const blobDir = path.resolve(process.cwd(), 'bench-blobs');
    const fsBlob = new LocalFsBlobStore({ baseDir: blobDir });

    const blobFsBench = await runAsyncBench(
        'LocalFsBlobStore.put + get (1KB File on Local Disk)',
        'Local Disk I/O',
        500,
        async () => {
            await fsBlob.put('bench/file.bin', blobPayload, 'tenant_bench');
            await fsBlob.get('bench/file.bin', 'tenant_bench');
        }
    );
    results.push(blobFsBench);
    if (fs.existsSync(blobDir)) fs.rmSync(blobDir, { recursive: true, force: true });

    const heapEnd = process.memoryUsage().heapUsed;

    console.log('');
    console.table(
        results.map(r => ({
            'Target': r.name,
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
    console.log(`Heap memory footprint: ${(heapStart / 1024 / 1024).toFixed(2)} MB -> ${(heapEnd / 1024 / 1024).toFixed(2)} MB`);
    console.log('Methodology note: Explicit separation between pure in-memory RAM, local persistent SQLite, and local filesystem disk I/O.');
    console.log('='.repeat(80));
}

main().catch(err => {
    console.error('Storage benchmark failure:', err);
    process.exit(1);
});

