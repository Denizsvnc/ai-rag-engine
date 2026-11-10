# Runtime Compatibility Matrix: Node.js & Bun — AI-RAG-ENGINE

**Document Version:** 2.0.0  
**Audit Date:** 2026-11-10  
**Target Package:** `@denizsvnc/ai-rag-engine`  
**Verified Runtimes:**
- Node.js `v26.13.0` (V8 engine, npm `11.20.0`)
- Bun `1.4.4` (JavaScriptCore engine)

---

## 1. Executive Summary

AI-RAG-ENGINE is engineered to run seamlessly across modern Node.js and Bun runtimes without runtime-specific code forks. Native standard APIs (`node:crypto`, `node:zlib`, `node:string_decoder`, `Float32Array`, `fetch`) provide cross-engine interoperability.

---

## 2. Test Execution & Verified Features

### 2.1 Node.js Runtime Verification (`v26.13.0`)
- **Execution Command:** `npm test` (with live PostgreSQL & Redis)
- **Results:** 43 test suites, 238 tests total:
  - **238 Passed**
  - **0 Failed**
  - **0 Skipped**
- **Verified Capabilities:**
  - Full TypeScript ESM import resolution via `tsx`
  - ONNX runtime embedding inference via `@huggingface/transformers`
  - `zlib.inflateSync` & `inflateRawSync` native PDF stream decompression
  - Strict bounded decompression (50MB) and encrypted PDF rejection
  - Live PostgreSQL 17 + `pgvector` dense vector indexing and cosine retrieval
  - Live Redis 7 distributed caching, outbox queueing, and multi-process ticket consumption
  - High-throughput smoke benchmark (`npm run benchmark`)
  - Standalone consumer verification (`npm run test:package`, `npm run test:consumer`, `npm run test:consumer:integration`)

### 2.2 Bun Runtime Verification (`1.4.4`)
- **Execution Command:** `npm run test:bun` (`bun test test/bun/bun-compat.test.ts`)
- **Results:**
  - **6 Test Suites Passed**
  - **30 Assertions (`expect()`) Passed**
  - **Duration:** 777ms
- **Verified Capabilities:**
  - Native ESM module resolution from compiled `dist/` and `src/`
  - Real 384-dimensional ONNX embedding vector generation (`SMLEngine`)
  - Vector cosine similarity and Euclidean distance math operations
  - PII screening and Turkish TCKN masking under JavaScriptCore
  - Synchronous zlib decompression of `/FlateDecode` streams under Bun's native zlib binding
  - End-to-end `RAGEngine` initialization, vector search, and LLM synthesis
  - `RAGEvaluator` precision and groundedness metrics calculation

---

## 3. Explicit Scope & Verification Boundaries

| Runtime | Tier | Verified Scope | Recommended Production Workloads |
| :--- | :--- | :--- | :--- |
| **Node.js (v22.x – v26.x)** | **Tier 1 (Reference)** | 100% full SDK surface: Core RAG, in-memory adapters, BullMQ workers, PostgreSQL/pgvector, Redis, Express API server, CLI migration tools. | All enterprise production workloads, distributed clusters, durable worker services, and Kubernetes deployments. |
| **Bun (1.4+)** | **Tier 2 (Supported & Verified Core)** | In-process core SDK: ESM packaging, ONNX neural inference, vector similarity, PII/security defenses, PDF extraction, in-memory caching/vector, and RAG evaluation. | Microservices, CLI tooling, serverless functions, edge runtimes, and embedded in-process RAG pipelines. |

*Boundary Note:* Multi-process BullMQ worker recovery and external database daemons (live PostgreSQL pgvector, Redis distributed clusters) are verified and hardened under Node.js. For Bun, external driver integration remains compatible but Node.js serves as the formal CI integration target.
