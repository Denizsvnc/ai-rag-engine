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

The following measurements were collected on 2026-11-10 executing 127,000 total iterations across hot-path components:

| Component / Target | Iterations | Measured Throughput (ops/sec) | Avg Latency | p95 Latency | Memory Overhead |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`RedisCacheAdapter.get` (Serialization)** | 20,000 | **5,396,169 ops/s** | 0.16 µs | 0.21 µs | Zero alloc |
| **`TokenTracker` FinOps Recording** | 20,000 | **3,909,049 ops/s** | 0.23 µs | 0.63 µs | O(1) map write |
| **`CacheManager.get` (In-Memory Hot Path)** | 20,000 | **3,793,356 ops/s** | 0.22 µs | 0.42 µs | O(1) hash lookup |
| **`Dot Product` (384-dim all-MiniLM-L6-v2)** | 50,000 | **2,214,520 ops/s** | 0.43 µs | 0.58 µs | Float32 SIMD unroll |
| **`Document Chunking & Magic Bytes Gate`** | 5,000 | **1,204,226 ops/s** | 0.80 µs | 1.67 µs | Linear slice |
| **`PIIGuard.sanitize` (TCKN+Luhn+IBAN)** | 10,000 | **230,595 ops/s** | 4.27 µs | 5.17 µs | Single-pass regex |
| **`BM25Index.search` (500-Doc Sparse Corpus)**| 2,000 | **20,665 ops/s** | 48.36 µs | 63.75 µs | Sparse inverted index|

---

## 3. Analysis by Subsystem

### 3.1 Vector Similarity & Math Operations
- **Throughput:** Over 2.2 million vector dot-product computations per second on 384-dimensional embeddings.
- **Latency:** Average latency of 0.43 microseconds (p95: 0.58 µs).
- **Optimization:** Array bounds caching and flat Float32Array continuous memory layout.

### 3.2 PII Masking Pipeline
- **Throughput:** ~230,000 operations per second under complex Turkish and international PII checks (TCKN modulus-10 verification, Credit Card Luhn formula, IBAN, email, phone).
- **Latency:** Average latency of 4.27 µs per payload.

### 3.3 Semantic Cache Retrieval
- **Throughput:** ~3.8 million in-memory lookups per second.
- **Impact:** Queries hitting the semantic cache bypass vector search and LLM invocation entirely, delivering answers in sub-millisecond timeframes while reducing token expenditure to zero.

### 3.4 Sparse BM25 Search
- **Throughput:** ~20,600 queries per second searching across a 500-document in-memory inverted index.
- **Latency:** Average search latency of 48.36 µs, providing instantaneous keyword grounding for Reciprocal Rank Fusion.

