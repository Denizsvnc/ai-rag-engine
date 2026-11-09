# Durable Ingestion Queue & Independent Consumer Verification

Audit date: 9 November 2026. This module details the worker and ingestion queue implementation, crash resilience, and transactional outbox guarantees.

## Operating Model

The HTTP API operates strictly as a producer. File and document uploads are committed first to a PostgreSQL `bytea` storage column and a transactional job ledger/outbox entry. Only lightweight job identifiers and tenant references are dispatched to Redis. A separate background worker (`ai-rag-worker`) reads the shared file from the database, calculates cryptographic checksums, validates file safety, executes PII sanitization prior to chunking, and computes dense vector embeddings. No `/tmp` or filesystem sharing between containers is required.

If Redis dispatch fails following the PostgreSQL commit, the upload remains in `pending` state. The worker periodically scans the outbox table and enqueues missing jobs. Even if Redis state is lost, pending/queued/processing jobs are recovered. BullMQ provides at-least-once job delivery. A transactional document version manifest and atomic chunk replacement ensure idempotent ingestion. An older document revision cannot overwrite a newer revision; stale chunks from shrinking documents are pruned automatically. Tenant cache revision is incremented within the same transaction to invalidate cached queries.

- `Idempotency-Key` headers return the existing job for identical tenant/payload combinations; payload mismatches return HTTP 409. If omitted, matching hashes deduplicate repeat submissions. Re-uploads (A → B → A) create new sequential versions.
- Default configuration: 3 retry attempts with exponential backoff; global concurrency 4, per-worker concurrency 2.
- Failed jobs are retained in BullMQ's failed set (7 days / 10,000 max). PostgreSQL result ledgers persist indefinitely. Successful raw upload payloads are pruned immediately; failed payloads expire after 7 days.
- `POST /api/ingest/status/:jobId/retry` allows authorized tenants to re-enqueue failed jobs. Expired raw payloads must be re-uploaded.
- Default upload limits: 5 MiB file size, 100 pending jobs per tenant, 50 MiB retained raw payload per tenant. Redis Lua sliding-window limiter enforces 120 requests/minute/tenant (returns HTTP 503 on limiter failure).
- SIGTERM/SIGINT signals trigger graceful draining with a 30-second shutdown deadline. Abrupt process termination (SIGKILL) is recovered via BullMQ stall detection locks.
- PDF text extraction is limited to extractable text streams without OCR; scanned or non-text PDFs fail explicitly rather than indexing empty documents.

## Configuration & Deployment

From repository checkout, run `npm ci && npm run build`. PostgreSQL with `pgvector` and Redis are required. Apply database migrations using an administrative account:

```sh
DATABASE_URL=postgresql://owner:password@localhost/rag npm run db:migrate
```

Providing `RUNTIME_DB_USER` and a 32+ character `RUNTIME_DB_PASSWORD` creates a dedicated, unprivileged application role with DML grants. The runtime role cannot alter table schemas (DDL). Direct SQL access does not enforce Row-Level Security (RLS); tenant isolation must be established via authenticated application contexts.

Environment settings for API and worker:

```dotenv
NODE_ENV=production
VECTOR_STORE=postgres
VECTOR_AUTO_MIGRATE=false
INGESTION_QUEUE=bullmq
DATABASE_URL=postgresql://runtime:password@localhost/rag
REDIS_URL=redis://localhost:6379
JWT_SECRET=<independent-random-32+-bytes>
CONFIRMATION_SECRET=<distinct-random-32+-bytes>
PRIVATE_LLM_ENDPOINT=http://localhost:8000/v1/chat/completions
```

Launch standalone services:

```sh
npm start
# In a separate process or container:
npm run start:worker
```

When installed from npm, binary commands are available as `npx ai-rag-migrate`, `npx ai-rag-server`, and `npx ai-rag-worker`. SDK exports include `PostgresIngestionStore`, `QueuedIngestionService`, `IngestionWorker`, and `BullMQJobQueue`.

Matching values for `INGESTION_QUEUE_NAME`, `INGESTION_TABLE_NAME`, and `VECTOR_TABLE_NAME` must be configured across API, worker, and migration jobs. Embedding model and dimensions must match migration settings. In-memory queue mode is suitable only for single-process local development and does not survive restarts.

## Verification Evidence

Local test suite execution: **168 automated tests, 24 suites, 0 failures, 0 regressions**. Integration suites cover tenant isolation, outbox recovery after dispatch failures, manual retries, version manifest concurrency, global worker limits, and graceful shutdown draining.

`npm run test:consumer` packages the library into a standalone `.tgz` tarball and installs it into an isolated temporary directory outside the repository tree, validating `NodeNext` strict types, exact file parity, and runtime execution.
