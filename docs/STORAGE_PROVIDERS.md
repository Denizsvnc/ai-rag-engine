# Storage Providers Guide

Comprehensive guide to configuring, combining, and deploying storage backends in `ai-rag-engine`.

---

## 1. Zero-Dependency Local Stack (Node.js & Bun)

Runs completely in-process using native `node:sqlite` (Node.js v22.14+ / Bun) with no external database services, Docker containers, or C++ native builds.

- **Vectors:** `SqliteVectorAdapter` (Dense BLOB embeddings + FTS5 full-text + RRF hybrid)
- **Documents:** `SqliteDocumentAdapter` (ACID transactions, JSON metadata filters)
- **Blobs:** `LocalFsBlobStore` (Local filesystem with path traversal protection)
- **Ingestion:** `MemoryIngestionStore` (In-memory ledger with quota limits)

```typescript
import { RAGEngine, createStorage } from 'ai-rag-engine';
import { SqliteVectorAdapter } from 'ai-rag-engine/adapters/vector/sqlite';
import { SqliteDocumentAdapter } from 'ai-rag-engine/adapters/document/sqlite';
import { LocalFsBlobStore } from 'ai-rag-engine/adapters/blob/local-fs';
import { MemoryIngestionStore } from 'ai-rag-engine/core/ingestion/memory-ingestion-store';

const storage = createStorage({
    vectors: new SqliteVectorAdapter({
        dbPath: './data/rag-vectors.db',
        tableName: 'document_vectors'
    }),
    documents: new SqliteDocumentAdapter({
        dbPath: './data/rag-docs.db',
        tableName: 'documents'
    }),
    blob: new LocalFsBlobStore({
        baseDir: './data/uploads'
    }),
    ingestion: new MemoryIngestionStore()
});

await storage.init();

const engine = new RAGEngine({ storage });
await engine.initialize();
```

---

## 2. Production PostgreSQL Stack

Enterprise multi-node production deployment using PostgreSQL with `pgvector`, Redis caching, and BullMQ distributed queues.

```typescript
import { RAGEngine, createStorage } from 'ai-rag-engine';
import { PostgresVectorAdapter } from 'ai-rag-engine/adapters/vector/postgres';
import { PostgresIngestionStore } from 'ai-rag-engine/core/ingestion/postgres-ingestion-store';
import { RedisCacheAdapter } from 'ai-rag-engine/adapters/cache/redis';
import { BullMQJobQueue } from 'ai-rag-engine/core/queue/bullmq-queue';

const storage = createStorage({
    vectors: new PostgresVectorAdapter({
        connectionString: process.env.DATABASE_URL!,
        tableName: 'rag_embeddings',
        dimensions: 384
    }),
    ingestion: new PostgresIngestionStore(process.env.DATABASE_URL!),
    cache: new RedisCacheAdapter({
        url: process.env.REDIS_URL!,
        prefix: 'rag_cache:'
    }),
    queue: new BullMQJobQueue({
        connection: { host: 'localhost', port: 6379 },
        queueName: 'rag_ingestion'
    })
});

await storage.init();

const engine = new RAGEngine({ storage });
await engine.initialize();
```

---

## 3. Distributed Multi-Provider Cloud Stack

Combines specialized cloud engines:
- **Vectors:** Qdrant Cloud (Managed vector DB over REST HTTP)
- **Documents:** MongoDB Atlas (Document store)
- **Graph:** Neo4j Aura (Knowledge graph for GraphRAG)

### Installing Optional Drivers

Optional drivers are declared as `peerDependencies` with `optional: true`. Install only what you need:

```bash
# For MongoDB Document Store
npm install mongodb

# For MySQL Document Store
npm install mysql2

# For Neo4j Knowledge Graph Store
npm install neo4j-driver
```

### Configuration Example

```typescript
import { RAGEngine, createStorage } from 'ai-rag-engine';
import { QdrantVectorAdapter } from 'ai-rag-engine/adapters/vector/qdrant';
import { MongoDocumentAdapter } from 'ai-rag-engine/adapters/document/mongo';
import { Neo4jGraphAdapter } from 'ai-rag-engine/adapters/graph/neo4j';
import { LocalFsBlobStore } from 'ai-rag-engine/adapters/blob/local-fs';

const storage = createStorage({
    // Qdrant uses native fetch (Zero extra npm packages)
    vectors: new QdrantVectorAdapter({
        url: 'https://xyz-cluster.qdrant.tech:6333',
        apiKey: process.env.QDRANT_API_KEY,
        collectionName: 'knowledge_base',
        dimensions: 384
    }),

    // Dynamically imports 'mongodb'
    documents: new MongoDocumentAdapter({
        uri: process.env.MONGODB_URI!,
        dbName: 'enterprise_rag',
        collectionName: 'corpus'
    }),

    // Dynamically imports 'neo4j-driver'
    graph: new Neo4jGraphAdapter({
        uri: 'neo4j+s://xyz.databases.neo4j.io',
        username: 'neo4j',
        password: process.env.NEO4J_PASSWORD!
    }),

    blob: new LocalFsBlobStore({
        baseDir: '/mnt/storage/blobs'
    })
});

await storage.init();

const engine = new RAGEngine({ storage });
await engine.initialize();
```

---

## 4. Custom Storage Provider Registration

To implement a custom storage provider (e.g., Pinecone, Elasticsearch, DynamoDB), implement the respective interface (`IVectorStore`, `IDocumentStore`, etc.) and declare capabilities:

```typescript
import { IVectorStore, StorageCapabilities, VectorDocument } from 'ai-rag-engine';

export class CustomPineconeAdapter implements IVectorStore {
    readonly capabilities: StorageCapabilities = {
        denseVectorSearch: true,
        sparseRetrieval: false,
        nativeHybridSearch: false,
        metadataFiltering: true,
        namespaceIsolation: true,
        transactions: false,
        batchOperations: true
    };

    hasCapability(cap: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[cap]);
    }

    async init(): Promise<void> {
        // Initialize client
    }

    async search(vector: number[], limit: number, filter?: Record<string, unknown>): Promise<VectorDocument[]> {
        // Implement query logic
        return [];
    }

    async add(documents: VectorDocument[]): Promise<void> {
        // Implement upsert logic
    }
}
```

