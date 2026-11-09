# SDK Usage and Operations

## Runtime and module contract

Install `@denizsvnc/ai-rag-engine` after publication, or its local `.tgz` before publication. Use ESM (`"type": "module"` in the application). CommonJS `require()` is not a supported contract; CommonJS applications can use asynchronous `import()`. Node.js 22.14+ is required; Node 22/24 are the explicit test matrix. TypeScript 5.8+ is recommended; NodeNext and Bundler resolution are validated with strict checking. `skipLibCheck` is not required. Supported exports are the root API and `./package.json`; internal `dist/` paths are private. CLI commands are separate entry points.

The library never automatically loads `.env`. Applications may call `dotenv.config()` themselves. The server/worker/migration CLIs explicitly load `.env`. Importing the root library creates no server, connection, model download, or background worker. Native Transformers is imported lazily on the first embedding initialization.

## Lifecycle and defaults

Construct `RAGEngine` with `llmProvider` and `inputs`. `init()` is idempotent and shares concurrent initialization; `query()` also initializes automatically. Default SML initialization loads MiniLM, so set `smlConfig: { enabled: false }` for adapters that do not use local routing. A vector adapter or FAQ can still explicitly load its own embedding model. Default cache uses `./data/query-cache.json` relative to the application working directory; disable it or supply an adapter/path explicitly. New cache files are OS-user private (`0600` on POSIX); existing cache files should be reviewed separately. Cache/registry paths are trusted host configuration, never HTTP/user input.

`LocalFaqAdapter()` is initially empty. Call `setFaqs()` with application data or pass an explicit `filePath`. No sample business policies are loaded or shipped. This changes the old checkout-only default `./src/utils/faq-embeddings.json`.

The engine does not own externally supplied pools/clients. Close PostgreSQL adapters, queues and Redis clients when the host shuts down. Durable worker `close()` drains active tasks. The HTTP and worker CLIs install SIGTERM/SIGINT handlers with a shutdown deadline. Explicit SDK callers own their lifecycle.

## Provider configuration

```js
import { RAGEngine, CustomLLMAdapter } from '@denizsvnc/ai-rag-engine';
const provider = new CustomLLMAdapter({
  endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
  model: 'your-deployed-model'
});
const engine = new RAGEngine({
  llmProvider: provider, inputs: {},
  smlConfig: { enabled: false }, cache: { enabled: false }
});
```

The private endpoint is an explicit data destination; review it before sending proprietary data. API keys belong in secret management, not source control. Other constructors: `new OpenAIAdapter(apiKey, model)`, `new GeminiAdapter(apiKey, model)`, `new OllamaAdapter({ host, model })`. `FallbackLLMProvider` accepts providers in order; `TieredLLMProvider.createFromEnv()` builds configured fast/smart chains. Configure `LLM_TIMEOUT_MS` (1–300000; default 30000) to bound HTTP calls. Providers can still fail; catch errors and return an application-appropriate failure without disclosing credentials or raw upstream responses. The SDK does not implement a provider-wide distributed token budget.

OpenRouter fallback from `createFromEnv()` requires `ALLOW_PUBLIC_OPENSOURCE_LLM=true`. Set this flag to `false` in restricted environments. Review all explicitly supplied endpoints/providers independently. PII filtering is pattern/algorithm based and cannot guarantee every sensitive field is detected.

## Local embeddings, FAQ and routing

```js
import { SMLEngine, LocalFaqAdapter } from '@denizsvnc/ai-rag-engine';
const embeddings = new SMLEngine({
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './models',
  localFilesOnly: false // true after provisioning a local cache for offline use
});
const faq = new LocalFaqAdapter({ smlEngine: embeddings });
await faq.setFaqs([
  { id: 'support', question: 'When is support available?', answer: 'Weekdays.', tenantId: 'acme' }
]);
```

FAQ entries without `tenantId` are deliberately global. Model weights are separate downloads with their own licenses and storage requirements. The SDK includes Transformers/ONNX as a direct dependency to preserve default local embedding behavior; these native dependencies increase installation size. `RAG_MODEL_CACHE_DIR` supplies the default per-instance cache directory without mutating Transformers global state. Two SMLEngine instances can have different cache settings. Tools use descriptions for local routing; provide precise descriptions and persist their registry at a trusted writable path.

## Vector adapters and retrieval

`MemoryVectorAdapter` supports tenant/ID upsert and in-memory dense/sparse/hybrid retrieval. Its `search()` also supports context-free data; only use tenant-tagged documents and trusted filters in multi-tenant applications. Restart loses state. SDK users can implement `IVectorStoreAdapter` for other stores without Express.

```js
import { PostgresVectorAdapter, RAGEngine } from '@denizsvnc/ai-rag-engine';
const vectors = new PostgresVectorAdapter({
  connectionString: process.env.DATABASE_URL,
  tableName: 'rag_documents', modelName: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384, autoMigrate: false
});
await vectors.init();
await vectors.addDocuments([{ id: 'policy', content: 'Returns: 14 days.', metadata: { tenantId: 'acme' } }]);
const engine = new RAGEngine({
  llmProvider: provider, inputs: { vectorStore: vectors },
  smlConfig: { enabled: false }, cache: { enabled: false },
  retrieval: { strategy: 'hybrid', topK: 3 }
});
// Authenticate the caller before producing this context.
const answer = await engine.query('What is the return policy?', { tenantId: 'acme', userId: 'u1', roles: ['viewer'] });
// Close when the host finishes all requests:
await vectors.close();
```

This snippet assumes `provider` is configured as above. Run `ai-rag-migrate` with an owner role first. Runtime needs table DML and schema USAGE; use a separate restricted role. Model/dimension mismatches reject initialization. New model configurations need new tables and reindexing. PostgreSQL hybrid retrieval combines dense vectors and the `simple` full-text dictionary using reciprocal rank fusion; it is not BM25 or Turkish morphological analysis. Exact search is the default; optional HNSW requires recall evaluation with actual tenant filters. Direct DB access is not protected by tenant RLS.

## Secure tools and tenant context

Import `IAgentTool` for types and use Zod schemas for validation:

```ts
import { z } from 'zod';
import type { IAgentTool } from '@denizsvnc/ai-rag-engine';
const reserve: IAgentTool<{ sku: string }> = {
  name: 'reserve_item', description: 'Reserve inventory for an authenticated customer',
  parameters: { type: 'object', properties: { sku: { type: 'string', description: 'Inventory SKU' } }, required: ['sku'] },
  zodSchema: z.object({ sku: z.string().min(1) }),
  requiredRoles: ['editor'], isMutating: true,
  async execute(args, context) {
    // Enforce ownership/tenant constraints again in the application's transaction.
    return { sku: args.sku, tenantId: context?.tenantId };
  }
};
```

The example demonstrates the tool contract, not an inventory database implementation. A returned `confirmationRequests` proposal must be shown to the authenticated user; only after approval should the application resubmit the same action with `context.confirmationTicket`. Boolean confirmation is not authorization. Tickets bind tool, exact arguments, tenant and user, expire and are atomically consumed once. Production requires a 32+ byte independent `CONFIRMATION_SECRET` and `RedisConfirmationNonceStore`; use a shared Redis namespace with no eviction. Do not silently use memory on Redis failures. Tool handlers are trusted application code; the SDK is not a sandbox and cannot make arbitrary callbacks safe.

Direct SDK callers must authenticate context themselves. Never accept tenant/user/roles directly from untrusted JSON. Express integrations should use `createApiRoutes` or authenticated middleware so only verified `req.auth` supplies identity. Production rejects anonymous development auth and missing/known/weak secrets. JWT identity is HMAC signed; rotate keys operationally and keep issuer/audience configuration consistent. Read-only viewer and mutating editor/admin policies must match the application's own authorization rules.

## Standalone API, worker and migrations

Installed commands: `ai-rag-server`, `ai-rag-worker`, `ai-rag-migrate`. Do not import CLI files into an application. Production mode defaults to BullMQ ingestion and a shared PostgreSQL vector store. Development memory mode is single-process and not durable.

| Setting | Default / purpose |
| --- | --- |
| `NODE_ENV` | Host environment; production enforces strict secrets |
| `JWT_SECRET`, `CONFIRMATION_SECRET` | Independent random secrets, 32+ bytes in production |
| `DATABASE_URL` | PostgreSQL runtime connection; pgvector migrations required |
| `REDIS_URL` | Shared queue/cache/rate-limit connection |
| `CONFIRMATION_REDIS_URL` | Optional separate shared nonce Redis connection |
| `VECTOR_STORE` | `postgres` with durable queue; otherwise `memory` |
| `VECTOR_TABLE_NAME` | `rag_documents` |
| `VECTOR_AUTO_MIGRATE` | `false`; DDL should run separately |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | MiniLM, 384; migration/runtime must match |
| `INGESTION_QUEUE` | Production `bullmq`, development `memory` |
| `INGESTION_QUEUE_NAME`, `INGESTION_TABLE_NAME` | `rag-ingestion-queue`, `rag_ingestion` |
| `INGESTION_CONCURRENCY`, `INGESTION_GLOBAL_CONCURRENCY` | 2 per worker, 4 shared |
| `INGESTION_ATTEMPTS` | 3, exponential backoff |
| `INGESTION_MAX_UPLOAD_BYTES` | 5242880 |
| `INGESTION_MAX_PENDING_PER_TENANT` | 100 |
| `INGESTION_MAX_STORED_BYTES_PER_TENANT` | 52428800 |
| `API_RATE_LIMIT` | 120 authenticated requests/tenant/minute |
| `SHUTDOWN_TIMEOUT_MS` | 30000 |
| `PRIVATE_LLM_ENDPOINT`, `PRIVATE_LLM_MODEL_FAST/SMART` | Explicit OpenAI-compatible private destination/model |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST` | Enable corresponding configured provider |
| `ALLOW_PUBLIC_OPENSOURCE_LLM` | Public router fallback disabled unless explicitly true |
| `RAG_MODEL_CACHE_DIR` | `./data/models`; writable trusted model cache |
| `FAQ_FILE_PATH` | No FAQ file by default |
| `CACHE_KEY_PREFIX`, `API_RATE_KEY_PREFIX` | Table-specific default namespaces |

Keep DB/table/model/queue settings identical across API and workers. Migration can provision `RUNTIME_DB_USER/PASSWORD`; existing role passwords are not reset. Redis persistence, noeviction, backups and capacity monitoring are deployment requirements. Upload content is stored in PostgreSQL before dispatch. Outbox polling recovers missing queue entries. Successful raw content is removed; failed raw content expires after 7 days, while result/idempotency ledgers persist. Archive growing ledgers operationally. `Idempotency-Key` conflicts return 409, quota/rate-limit failures 429, limiter outages 503. Failed retained jobs can be retried with `POST /api/ingest/status/:jobId/retry` under their tenant's authorization.

Worker delivery is at least once. Transactional document version manifests prevent old/repeated work from replacing newer data, remove stale chunks and bump a cache revision. The SDK does not claim exactly-once message delivery. SIGKILL recovery uses BullMQ stalled-job detection. The limited PDF parser does not include OCR and rejects PDFs without extractable text.

## Errors and troubleshooting

- Import errors: use ESM and a supported Node version; install the `.tgz`, not a symlink to unbuilt source.
- Type errors: use NodeNext/Bundler and a current TypeScript compiler. Consumer fixtures verify strict declaration resolution without `skipLibCheck`.
- Unexpected model download: disable SML when unused; FAQ/vector adapters can still need embeddings. Preload models and use `SMLEngine.localFilesOnly` where appropriate.
- No FAQ answer: provide actual FAQ data explicitly; tune thresholds on a representative labeled dataset.
- Queue stays pending: run the separate worker, verify shared Redis/DB settings and migration permissions.
- Schema/model mismatch: run matching migrations; do not force reuse of incompatible embedding tables.
- Authentication rejection: provision independent secrets and consistent issuer/audience; never relax production checks to resolve deployment errors.
- Permission denied on cache: select an explicit writable directory owned by the runtime user. Do not make credential/cache files world-writable.
- Provider failures: validate endpoint, model and timeout without logging secrets. Local small-model checks do not establish general answer quality.

No production throughput, universal PII masking, complete prompt-injection prevention, full OCR, or broad multilingual answer-quality guarantee is made.
