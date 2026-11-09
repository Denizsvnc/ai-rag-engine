# Persistent Data Layer & Cache Invalidation

Audit date: 9 November 2026. This document specifies the persistent PostgreSQL/pgvector adapter, Redis distributed caching, and Prometheus telemetry metrics.

## Cache & Metric Behavior

When configured with Redis, `RedisCacheAdapter` does not maintain a local in-memory response copy. If connectivity fails, the default behavior is a cache miss with bypassed caching; the live query pipeline continues functioning. Setting `enableFallbackMemory: false` propagates Redis read/write errors directly. When Redis is unconfigured, local LRU mode is utilized. Failures during `delete`, `invalidate`, and `clear` reject with errors to ensure stale cache states are never reported as clean.

- Regex invalidation scans and deletes remote Redis keys matching namespaces.
- String keyword matching is case-insensitive; keys containing `*` or `?` perform wildcard lookups within the namespace.
- Key iteration uses `SCAN` in batches of up to 100 keys to avoid blocking Redis event loops. `KEYS` is only used as a fallback for custom clients lacking `SCAN`.
- `size()` reports exclusively the local memory cache count, not total keys on the remote Redis cluster.

Latency metrics provide true `_sum` totals and `_count` execution measurements across the process lifecycle. Non-finite values (`NaN`, `Infinity`, negative numbers) are rejected prior to accounting. Metric reset clears sums and histogram buckets simultaneously.

Prometheus metrics export histogram buckets via `rag_query_duration_seconds`:

```promql
histogram_quantile(0.95, sum by (le) (rate(rag_query_duration_seconds_bucket[5m])))
```

## PostgreSQL / pgvector Storage

`PostgresVectorAdapter` provides persistent dense vector retrieval alongside PostgreSQL full-text search with Reciprocal Rank Fusion (RRF). Full-text ranking uses the PostgreSQL `simple` dictionary. Exact vector search is the default; approximate HNSW indexing can be enabled with `createHnswIndex: true` during migration.

All search, deletion, and purge operations mandate a non-empty `filter.tenantId`. Documents inserted require `metadata.tenantId`. Composite primary keys `(tenant_id, id)` ensure complete tenant isolation. Direct SQL connections do not apply Row-Level Security (RLS); tenant parameters must originate from verified server contexts.

`addDocuments` performs idempotent upserts per tenant and document ID. Changing content, metadata, or embedding vectors increments the document version; identical writes do not. Batch insertions execute inside a single database transaction.

Model names and dimensions are recorded in a dedicated configuration table. Mismatches at runtime initialization are rejected to prevent index corruption.

## Installation & Migrations

```sh
npm ci
npm run build
npm run db:migrate
```

Application runtime environment:

```dotenv
VECTOR_STORE=postgres
DATABASE_URL=postgresql://runtime_user:password@localhost:5432/rag_db
VECTOR_TABLE_NAME=rag_documents
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSIONS=384
VECTOR_AUTO_MIGRATE=false
```
