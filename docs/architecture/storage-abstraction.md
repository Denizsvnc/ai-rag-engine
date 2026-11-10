# Storage Abstraction Architecture

## 1. Overview & Architectural Principles

The AI-RAG-ENGINE storage layer decouples core orchestration logic from concrete database implementations. Rather than forcing a single database or monolithic `IDatabaseAdapter` interface, the architecture follows the **Interface Segregation Principle (ISP)** and **Dependency Inversion Principle (DIP)**.

High-level engine components (`RAGEngine`, `QueryPlanner`, `QueuedIngestionService`, `IngestionWorker`) depend strictly on small, focused, capability-driven storage contracts.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                               RAGEngine                                 │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │    StorageContainer    │
                        │    (createStorage)     │
                        └────────────┬───────────┘
                                     │
     ┌──────────────┬──────────────┼──────────────┬──────────────┬──────────────┐
     ▼              ▼              ▼              ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│IDocument │  │ IVector  │  │  IGraph  │  │IIngestion│  │  IBlob   │  │  ICache  │
│  Store   │  │  Store   │  │  Store   │  │  Store   │  │  Store   │  │ Adapter  │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

## 2. Separation of Storage Concerns

Each persistence concern is isolated into its own TypeScript contract:

| Contract | Purpose | Default / Reference Implementations |
| :--- | :--- | :--- |
| `IVectorStore` | Dense semantic vector and hybrid search, chunk lifecycle management | `MemoryVectorAdapter`, `SqliteVectorAdapter`, `PostgresVectorAdapter`, `QdrantVectorAdapter` |
| `IDocumentStore` | Raw document entity persistence, metadata querying, revision tracking | `SqliteDocumentAdapter`, `MongoDocumentAdapter`, `MySQLDocumentAdapter` |
| `IGraphStore` | Knowledge graph entity and relation extraction, multi-hop GraphRAG | `MemoryGraphAdapter`, `PostgresGraphAdapter`, `Neo4jGraphAdapter` |
| `IIngestionStore` | Durable ingestion ledger, outbox state, tenant quota tracking | `MemoryIngestionStore`, `PostgresIngestionStore` |
| `IBlobStore` | Binary payload storage for document uploads and artifacts | `MemoryBlobStore`, `LocalFsBlobStore` |
| `ICacheStore` | Low-latency response, query plan, and embedding caching | `MemoryCacheAdapter`, `RedisCacheAdapter` |
| `IJobQueue` | Asynchronous task and ingestion dispatch | `InMemoryQueue`, `BullMQQueue` |
| `IEmbeddingProvider` | Dense embedding generation independent of vector persistence | `SMLEngine` (Transformers.js), `OpenAIEmbeddingAdapter` |

## 3. Capability-Driven Architecture

Storage providers declare supported features at runtime via `IStorageCapabilities` and `StorageCapabilities`.

### Dynamic Capability Negotiation

Instead of hardcoding provider checks (`if (db instanceof PostgresVectorAdapter)`), consuming services query capabilities:

```typescript
export interface StorageCapabilities {
    denseVectorSearch?: boolean;
    sparseRetrieval?: boolean;
    nativeHybridSearch?: boolean;
    metadataFiltering?: boolean;
    namespaceIsolation?: boolean;
    transactions?: boolean;
    atomicDocumentReplacement?: boolean;
    versioning?: boolean;
    graphTraversal?: boolean;
    batchOperations?: boolean;
    nativeIndexes?: boolean;
    fullTextSearch?: boolean;
    blobStorage?: boolean;
}
```

### StorageCapabilityRegistry

The `StorageCapabilityRegistry` manages provider registrations, validates capability requirements, and negotiates optimal query execution paths:

- **Native Hybrid (`native_hybrid`):** Selected when the vector store supports both dense search and native hybrid search (e.g., PostgreSQL with pgvector + tsvector, SQLite with dense BLOB + FTS5).
- **Engine Hybrid (`engine_hybrid`):** Selected when the vector store supports dense search and sparse retrieval separately, allowing the engine to execute both and perform Reciprocal Rank Fusion (RRF) in memory.
- **Dense Only (`dense`):** Selected when only dense semantic retrieval is available.
- **Sparse Only (`sparse`):** Selected when only keyword search is available.

If an operation requires a capability unsupported by the configured provider, an `UnsupportedStorageCapabilityError` is thrown immediately with descriptive diagnostics.

## 4. Unified Storage Orchestration (`createStorage`)

The `createStorage` factory unifies multi-provider configuration, concurrent initialization, graceful shutdown, health monitoring, and capability verification.

```typescript
import { createStorage } from 'ai-rag-engine';
import { SqliteVectorAdapter } from 'ai-rag-engine/adapters/vector/sqlite';
import { SqliteDocumentAdapter } from 'ai-rag-engine/adapters/document/sqlite';
import { MemoryBlobStore } from 'ai-rag-engine/adapters/blob/memory';
import { MemoryIngestionStore } from 'ai-rag-engine/core/ingestion/memory-ingestion-store';

const storage = createStorage({
    vectors: new SqliteVectorAdapter({ dbPath: './data/vectors.db' }),
    documents: new SqliteDocumentAdapter({ dbPath: './data/docs.db' }),
    blob: new MemoryBlobStore(),
    ingestion: new MemoryIngestionStore()
});

// Concurrent lifecycle initialization
await storage.init();

// Unified health check across all sub-stores
const health = await storage.healthCheck();
// {
//   vectors: { status: 'healthy', latencyMs: 1.2 },
//   documents: { status: 'healthy', latencyMs: 0.8 },
//   ...
// }

// Validate required capabilities before starting RAG queries
storage.validateCapabilities({
    vectors: ['denseVectorSearch', 'namespaceIsolation'],
    documents: ['transactions']
});

// Graceful teardown
await storage.close();
```

## 5. Backward Compatibility Guarantee

Existing consumers using legacy `new RAGEngine({ inputs: { vectorStore } })` configurations remain 100% compatible. When `storage` is passed to `RAGEngine`, it automatically extracts the underlying vector store, graph store, cache, and queue, while legacy direct vector store inputs are internally adapted without deprecation warnings or breaking changes.

