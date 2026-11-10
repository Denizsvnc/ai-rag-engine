# Changelog

This file follows Semantic Versioning.

## 2.3.0 — 2026-11-10

### Added

- **Reciprocal Rank Fusion (RRF) Tie-Breaking & Dense/Sparse Weights:** Introduced deterministic sparse lexical match prioritization on RRF score ties and optional configurable `weights: { dense, sparse }` parameter in `reciprocalRankFusion`.
- **Unicode Combining Diacritics & Turkish Case Normalization in BM25:** Added `\p{M}` combining character preservation and Turkish `İ`/`ı` case handling in `BM25Index.tokenize`.
- **PDF Security Hardening:** Strict rejection of encrypted/password-protected PDFs (`/Encrypt`), bounded zlib output ceiling (50MB) against zip-bomb denial of service, and explicit error throwing on scanned raster-only PDFs.
- **Formal Invariant & Mutation Verification Suite:** Added property-based bounds testing, metamorphic relations (foreign tenant invariance, idempotent ingestion, BM25 monotonicity), FSM state machine invariants (circuit breaker, single-use ticket), 100% systematic mutation kill rate, and labeled bilingual RAG quality evaluation dataset.
- **4-Category Performance Benchmark:** Separated CPU hot paths, in-memory async, local ONNX, and real network I/O with p50/p95/p99 percentiles.

### Fixed

- **Release Workflow CI Hardening:** Integrated Docker service containers (`pgvector/pgvector:pg17` and `redis:7-alpine`) in `.github/workflows/release.yml` with fail-closed quality gates before publishing.
- **SML Concurrency Cache Isolation:** Proven that independent engines with empty cache directory and `localFilesOnly: true` strictly fail and cannot access models from parallel instances.

## 2.2.4 — 2026-11-10

### Fixed

- **Silent PDF Poisoning Prevention:** Hardened `DocumentIngestionService.extractPdfText` to strictly reject unparseable/scanned PDFs with an explicit `Error`, preventing empty placeholders or structural metadata (`1 0 EOF`) from being chunked into the vector database.
- **Active Gemini Catalog Models:** Standardized default fast model to `gemini-2.0-flash` across `GeminiAdapter`, `env.ts`, TSDoc, and README code examples.
- **PostgreSQL vs. BM25 Disambiguation:** Clarified in architecture documentation that PostgreSQL hybrid retrieval fuses dense vectors with native `tsvector`/`websearch_to_tsquery` via RRF, while Okapi BM25 operates on in-memory collections (`BM25Index`).
- **Benchmark Async Timing & Heap Tracking:** Integrated `runAsyncBench` to properly await async cache calls in `smoke-benchmark.ts`, labeled in-memory fallback LRU clearly, and measured actual V8 heap memory deltas.

### Security & CI

- **Release Quality Gate:** Added mandatory `npm test` execution to `.github/workflows/release.yml` preceding package publication.
- **SML Multi-Tenant Concurrency Tests:** Added multi-instance concurrency test with distinct isolated tenant cache symlink paths in `tmp/`, verifying that Transformers.js global `env` settings revert to baseline.

## 2.2.3 — 2026-11-10

### Fixed

- **Transformers.js Concurrency Lock:** Implemented static Promise lock chain (`acquireInitLock`) in `SMLEngine` to serialize `init()` calls across independent instances and isolate mutable Transformers.js global `env`. Model inference remains fully concurrent.
- **LLM Adapter Constructor Flexibility:** Dual constructor signatures added to `GeminiAdapter`, `OpenAIAdapter`, and `OpenRouterAdapter` accepting both `{ apiKey, model, temperature }` configuration objects and positional parameters.
- **Document Chunking Bounds & Streaming UTF-8 Decoder:** Enforced `RangeError` on invalid chunk boundaries (`chunkSize > 0`, `overlap < chunkSize`). Added `StringDecoder('utf-8')` to prevent split multi-byte characters (e.g. Turkish `ş`, `ğ`) across stream chunks.
- **Native zlib PDF FlateDecode Ingestion:** Integrated Node's native `zlib.inflateSync` & `inflateRawSync` for zero-dependency decompression of vector PDF streams.
- **RAGEvaluator Heuristics & Polarity:** Ensured empty answers score 0.0; deduplicated retrieved IDs; added English & Turkish negation and polarity contradiction checks.

### Added

- **Bun Runtime Compatibility:** Dedicated Bun test suite (`test/bun/bun-compat.test.ts`) and npm script `npm run test:bun` verifying ONNX embeddings, PII masking, vector math, and RAG execution under Bun v1.4.4+.
- **CI Workflow Hardening:** Added automated Bun compatibility verification job in GitHub Actions CI workflow.
- **Engineering & Security Audits:** Comprehensive audit documentation covering Baseline, Architecture, Security (OWASP Top 10 LLM), Invariants, Performance Benchmarks, RAG Evaluation, and Node/Bun Compatibility in `docs/audits/`.

## 2.2.2 — 2026-11-10

### Fixed

- **Document Ingestion:** Resolved infinite decaying chunk loop in `DocumentIngestionService.chunkText` when `endIndex >= text.length`.
- **Security & Prompt Injection:** Resolved regex boundary and preposition issues in `InjectionDetector` for English DAN jailbreak attacks (`in DAN mode`) and Turkish Unicode word boundaries (`ş, ç`).
- **LLM Failover Logging:** Replaced generic `Object failed` error message in `FallbackLLMProvider` with dynamic provider, model, or constructor resolution.
- **Rules Adapter:** Extended `StaticRulesAdapter` to accept structured rule objects (`{ id, rule }`) alongside plain string arrays via polymorphic `RuleInput`.
- **Performance & SML Sharing:** Prevented redundant ONNX model downloads and duplicate memory footprint by sharing `SMLEngine` instances across `RAGEngine`, `LocalFaqAdapter`, and `MemoryVectorAdapter`.

### Added

- Exported `JobStatusValues` constants in `job-queue.interface.ts` to prevent casing mismatches.
- Exported `RuleInput` type in root exports.

## 2.2.1 — 2026-11-10

### Documentation

- Updated `README.md`, `README_tr.md`, and `README_de.md` with verified, type-safe production examples featuring `GeminiAdapter`, `PostgresVectorAdapter`, `RedisCacheAdapter`, `LocalFaqAdapter`, and `SecurityConfig`.
- Removed legacy pre-publication disclaimers and streamlined installation documentation for live npm consumption.

## 2.2.0 — 2026-11-10

### Added

- Scoped npm distribution preparation for `@denizsvnc/ai-rag-engine`, explicit Node.js/ESM contract and package metadata.
- Package allowlist verification and independent JavaScript/strict TypeScript consumer tests.
- PostgreSQL/pgvector retrieval, document version manifests and revision-aware shared query caching.
- Separate BullMQ ingestion worker, shared PostgreSQL upload/outbox, tenant quotas, retries and crash recovery.
- Redis tenant rate limiting, provider timeouts and latency histogram accounting.

### Fixed

- Root import no longer eagerly loads Transformers or mutates its global cache configuration.
- Builds clean stale artifacts, target Node-compatible JavaScript and omit broken declaration maps/demo data.
- Public declarations resolve under NodeNext; runtime TypeScript tools are unnecessary.
- Newly written local cache and tool-registry files use POSIX mode 0600.

### Migration notes

- Package identity changes from the repository's unscoped `ai-rag-engine` to `@denizsvnc/ai-rag-engine`. Update imports and installation commands. Registry scope ownership remains unverified until the owner authenticates.
- Node.js 20 is no longer in the supported matrix; use Node.js 22.14+.
- `LocalFaqAdapter()` starts empty. Supply `filePath` or call `setFaqs()`; checkout demo FAQs are not business defaults.
- Internal `dist/` files are private; public entry points remain the root API and the documented CLI commands.
- `SMLEngine.cacheDir` / `RAG_MODEL_CACHE_DIR` applies per instance; the SDK no longer sets Transformers `env.cacheDir` globally.
- Persistent ingestion/vector storage requires migrations and shared settings across API/worker.

## 2.1.0 — Repository history (not verified as an npm release)

- JWT authentication and RBAC, tenant boundaries and signed single-use tool confirmation.
- Semantic routing, FAQ matching, hybrid retrieval, local queue and telemetry APIs.

The public registry returned 404 for scoped and unscoped names during this preparation. This is not proof of namespace ownership or publish authorization.
