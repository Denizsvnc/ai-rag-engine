# Changelog

This file follows Semantic Versioning.

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
