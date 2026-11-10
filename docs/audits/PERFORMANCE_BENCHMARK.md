# Performance & Throughput Benchmark Report — AI-RAG-ENGINE

**Document Version:** 2.0.0  
**Audit Date:** 2026-11-10  
**Target Package:** `@denizsvnc/ai-rag-engine`  
**Host Environment:** Apple Silicon (macOS), Node.js v26.13.0, Bun v1.4.4  
**Benchmark Suite:** `test/performance/smoke-benchmark.ts`  

---

## 1. Executive Summary & Methodology Categorization

To eliminate misinterpretation between in-process microbenchmarks and real distributed I/O, benchmarks are partitioned into four explicit execution models:
1. **CPU Hot Paths:** Synchronous operations measured using high-resolution monotonic timers (`process.hrtime.bigint()`).
2. **In-Memory Async:** Asynchronous operations awaiting event loop Promise resolution.
3. **Local ONNX Neural Inference:** SML embedding vector extraction using local quantized ONNX runtime.
4. **Network I/O:** Real TCP socket roundtrips to standalone PostgreSQL 17 (pgvector cosine search) and Redis 7 (ioredis GET/SET).

Every benchmark executes JIT warm-up cycles before capturing timing, awaits asynchronous completions, and tracks p50, p95, and p99 percentiles.

---

## 2. Verified Benchmark Results

The following measurements were collected executing `npm run benchmark` with live local PostgreSQL (`127.0.0.1:5432`) and Redis (`127.0.0.1:6379`):

| Target Component | Category | Iterations | Throughput (ops/sec) | Avg Latency | p50 Latency | p95 Latency | p99 Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`TokenTracker` FinOps Recording** | CPU | 20,000 | **4,426,206** | 0.20 µs | 0.13 µs | 0.62 µs | 0.96 µs |
| **`CacheManager.get` (In-Memory Hot Path)** | In-Memory Async | 10,000 | **2,816,173** | 0.31 µs | 0.21 µs | 0.75 µs | 0.88 µs |
| **`Dot Product` (384-dim all-MiniLM-L6-v2)** | CPU | 50,000 | **2,218,430** | 0.43 µs | 0.33 µs | 0.62 µs | 0.67 µs |
| **`SMLEngine.getEmbedding` (Local ONNX, Cached)** | Local ONNX | 50 | **1,875,046** | 0.48 µs | 0.42 µs | 0.96 µs | 1.42 µs |
| **`RedisCacheAdapter.get` (In-Memory Fallback LRU)** | In-Memory Async | 10,000 | **1,225,021** | 0.78 µs | 0.21 µs | 0.50 µs | 0.71 µs |
| **`Document Chunking & Magic Bytes Gate`** | CPU | 5,000 | **1,224,127** | 0.80 µs | 0.62 µs | 1.50 µs | 2.00 µs |
| **`PIIGuard.sanitize` (TCKN+Luhn+IBAN)** | CPU | 10,000 | **238,553** | 4.13 µs | 3.79 µs | 5.04 µs | 6.83 µs |
| **`BM25Index.search` (500-Doc Sparse Corpus)** | CPU | 2,000 | **21,426** | 46.65 µs | 44.25 µs | 53.62 µs | 102.75 µs |
| **`Redis Network Roundtrip` (ioredis GET, Real TCP)** | Network I/O | 1,000 | **23,416** | 42.65 µs | 34.50 µs | 77.54 µs | 93.08 µs |
| **`PostgresVectorAdapter.search` (pgvector Real DB)** | Network I/O | 100 | **3,268** | 305.90 µs | 295.54 µs | 438.87 µs | 609.88 µs |

**Memory Footprint:** Heap delta measured at 49.36 MB (8.46 MB $\rightarrow$ 57.82 MB) including ONNX runtime model tensors and persistent database connection pools.

---

## 3. Analysis by Subsystem

### 3.1 Network I/O Realism
- Real loopback Redis TCP roundtrips sustain **~23,400 ops/sec** with median latency of **34.5 µs** and p99 of **93.1 µs**. Across external VPC networks, typical latency increases to 0.5 ms – 2.0 ms.
- Real PostgreSQL pgvector cosine similarity queries over TCP sustain **~3,270 queries/sec** with median latency of **295.5 µs** and p99 of **609.9 µs**.

### 3.2 In-Memory Semantic & Lexical Hot Paths
- Vector dot product on 384-dimensional dense vectors achieves **2.22M ops/sec** with p50 latency of 0.33 µs.
- BM25 sparse keyword retrieval on a 500-document inverted index delivers **21,426 ops/sec** with median latency of 44.25 µs.

### 3.3 Security & FinOps Hot Paths
- `PIIGuard.sanitize` achieves **~238,500 ops/sec** (p50: 3.79 µs), validating full Turkish Republic Identification Number (TCKN) modulus-10 checksums, Credit Card Luhn formula verification, IBAN masking, and email/phone obfuscation.
- `TokenTracker` records token accounting and Prometheus histograms in **0.13 µs** (p50).
