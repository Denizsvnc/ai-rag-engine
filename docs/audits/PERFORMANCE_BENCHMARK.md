# Performance & Throughput Benchmark Report — AI-RAG-ENGINE

**Document Version:** 1.0.0  
**Audit Date:** 2026-11-10  
**Target Package:** `@denizsvnc/ai-rag-engine`  
**Host Environment:** Apple M-Series (macOS), Node.js v26.13.0, Bun v1.4.4  
**Benchmark Suite:** `test/performance/smoke-benchmark.ts`  

---

## 1. Executive Summary

AI-RAG-ENGINE is engineered for high-throughput, low-latency enterprise workloads. Critical path hot spots—such as vector similarity calculations, PII masking, cache retrieval, and document token chunking—are optimized to avoid memory allocations and unnecessary synchronous blocking.

---

## 2. Verified Benchmark Results

The following measurements were collected on 2026-11-10 executing 107,000 total iterations across hot-path components (`npm run benchmark`):

| Component / Target | Iterations | Measured Throughput (ops/sec) | Avg Latency | p95 Latency | Nature / Execution Model |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`TokenTracker` FinOps Recording** | 20,000 | **3,269,933 ops/s** | 0.28 µs | 0.62 µs | Synchronous CPU (O(1) Map) |
| **`CacheManager.get` (In-Memory Hot Path)** | 10,000 | **2,688,322 ops/s** | 0.32 µs | 0.71 µs | Asynchronous Promise Awaited |
| **`Dot Product` (384-dim all-MiniLM-L6-v2)** | 50,000 | **2,182,806 ops/s** | 0.43 µs | 0.62 µs | Synchronous Float32 Math |
| **`RedisCacheAdapter.get` (Fallback LRU)** | 10,000 | **1,471,408 ops/s** | 0.64 µs | 1.08 µs | Asynchronous In-Memory Fallback |
| **`Document Chunking & Magic Bytes Gate`** | 5,000 | **1,150,406 ops/s** | 0.85 µs | 1.50 µs | Synchronous String / Buffer Scan |
| **`PIIGuard.sanitize` (TCKN+Luhn+IBAN)** | 10,000 | **234,821 ops/s** | 4.19 µs | 5.00 µs | Synchronous Multi-Regex & Modulus |
| **`BM25Index.search` (500-Doc Sparse Corpus)** | 2,000 | **21,441 ops/s** | 46.61 µs | 56.29 µs | Synchronous Inverted Index Walk |

**Memory Footprint:** Heap delta measured at 10.14 MB (8.61 MB -> 18.76 MB) over 107,000 iterations without memory leakage.

---

## 3. Analysis by Subsystem & Benchmark Methodology

> [!IMPORTANT]
> **Methodology Boundary: Micro-benchmarks vs. Distributed System Latency**  
> Micro-benchmarks measure exclusively **in-process CPU hot paths and in-memory async operations**.  
> - `RedisCacheAdapter.get` was measured using its built-in in-memory fallback LRU. In production, remote network I/O to a standalone Redis instance or cluster typically incurs 0.5 ms – 2.5 ms network latency, depending on VPC topology.
> - LLM synthesis latency (e.g. Gemini, OpenAI) is bound by external API network transport and LLM token generation rates (typically 200 ms – 1500 ms).
> - Asynchronous functions (`cache.get`, `redisCache.get`) are measured using `runAsyncBench`, strictly awaiting each Promise resolution rather than profiling raw Promise allocation.

### 3.1 Vector Similarity & Math Operations
- **Throughput:** Over 2.18 million vector dot-product computations per second on 384-dimensional embeddings.
- **Latency:** Average latency of 0.43 microseconds (p95: 0.62 µs).
- **Optimization:** Array bounds caching and flat Float32Array continuous memory layout.

### 3.2 PII Masking Pipeline
- **Throughput:** ~234,000 operations per second under complex Turkish and international PII checks (TCKN modulus-10 verification, Credit Card Luhn formula, IBAN, email, phone).
- **Latency:** Average latency of 4.19 µs per payload.

### 3.3 Semantic Cache Retrieval
- **Throughput:** ~2.68 million in-memory lookups per second.
- **Impact:** Queries hitting the semantic cache bypass vector search and LLM invocation entirely, delivering answers with sub-millisecond in-process latency while reducing token expenditure to zero.

### 3.4 Sparse BM25 Search
- **Throughput:** ~21,400 queries per second searching across a 500-document in-memory inverted index.
- **Latency:** Average search latency of 46.61 µs, providing instantaneous keyword grounding for Reciprocal Rank Fusion.

