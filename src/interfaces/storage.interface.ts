import type { VectorDocument, IVectorStoreAdapter } from './vector.interface.js';
import type { IGraphAdapter } from './graph.interface.js';
import type { IngestionSettings } from './ingestion.interface.js';
import type { JobStatus } from '../core/queue/job-queue.interface.js';
import type { ICacheAdapter } from './cache.interface.js';
import type { IJobQueue } from '../core/queue/job-queue.interface.js';

/**
 * Storage provider capability flags.
 *
 * @remarks
 * Used by the storage capability registry and adaptive query planner to discover
 * and negotiate supported operations at runtime without guessing database features.
 */
export interface StorageCapabilities {
    /** Supports dense semantic vector k-NN search using distance metrics (cosine, inner product, L2). */
    denseVectorSearch?: boolean | undefined;
    /** Supports sparse keyword retrieval (e.g. BM25, SPLADE). */
    sparseRetrieval?: boolean | undefined;
    /** Supports database-native dense + sparse hybrid search with fused scoring. */
    nativeHybridSearch?: boolean | undefined;
    /** Supports structured metadata predicate filtering (JSON, SQL WHERE, or key-value). */
    metadataFiltering?: boolean | undefined;
    /** Enforces strict tenant/namespace cryptographic or logical data isolation. */
    namespaceIsolation?: boolean | undefined;
    /** Supports ACID transactional guarantees (commit, rollback, isolation). */
    transactions?: boolean | undefined;
    /** Supports atomic document revision replacement without read interruptions or orphaned chunks. */
    atomicDocumentReplacement?: boolean | undefined;
    /** Tracks monotonically increasing revision/version numbers per document entity. */
    versioning?: boolean | undefined;
    /** Supports multi-hop node and edge graph traversal and neighborhood extraction. */
    graphTraversal?: boolean | undefined;
    /** Supports efficient batched multi-record insertions and updates. */
    batchOperations?: boolean | undefined;
    /** Supports accelerated native database indexing (HNSW, IVFFlat, B-Tree, GIN, Inverted Index). */
    nativeIndexes?: boolean | undefined;
    /** Supports linguistic or lexical full-text search operators. */
    fullTextSearch?: boolean | undefined;
    /** Supports raw binary/blob payload storage for uploaded document sources. */
    blobStorage?: boolean | undefined;
}

/**
 * Interface implemented by storage adapters that advertise supported capabilities.
 */
export interface IStorageCapabilities {
    /** The static or dynamically calibrated capabilities of this storage provider. */
    readonly capabilities: StorageCapabilities;
    /**
     * Checks if the provider explicitly supports a specific capability.
     *
     * @param capability - The capability key to verify.
     */
    hasCapability(capability: keyof StorageCapabilities): boolean;
}

/**
 * Error thrown when an operation requires a storage capability not supported by the provider.
 */
export class UnsupportedStorageCapabilityError extends Error {
    constructor(
        public readonly providerName: string,
        public readonly capability: keyof StorageCapabilities,
        details?: string
    ) {
        super(
            `[StorageCapability] Provider "${providerName}" does not support capability "${capability}".${details ? ` ${details}` : ''}`
        );
        this.name = 'UnsupportedStorageCapabilityError';
    }
}

/**
 * Document entity stored in a document or relational database.
 */
export interface StoredDocumentEntity {
    /** Unique document identifier. */
    id: string;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** Raw or formatted textual content. */
    content: string;
    /** Arbitrary structured metadata. */
    metadata?: Record<string, unknown> | undefined;
    /** Monotonically increasing revision or version number. */
    version?: number | undefined;
    /** Creation timestamp in milliseconds. */
    createdAt?: number | undefined;
    /** Last update timestamp in milliseconds. */
    updatedAt?: number | undefined;
}

/**
 * Dedicated document storage contract for non-vectorized persistent content.
 */
export interface IDocumentStore extends IStorageCapabilities {
    /** Initializes connection pools and verifies schema migrations. */
    init?(): Promise<void>;
    /** Closes active connection handles. */
    close?(): Promise<void>;
    /** Persists a single document entity scoped to its tenant. */
    putDocument(doc: StoredDocumentEntity): Promise<void>;
    /** Persists multiple document entities in a single batch. */
    putDocuments(docs: StoredDocumentEntity[]): Promise<void>;
    /** Retrieves a document by ID and tenantId. Returns null if not found. */
    getDocument(id: string, tenantId: string): Promise<StoredDocumentEntity | null>;
    /** Retrieves multiple documents by IDs within a tenant boundary. */
    getDocuments(ids: string[], tenantId: string): Promise<StoredDocumentEntity[]>;
    /** Deletes a document by ID within a tenant boundary. Returns true if deleted. */
    deleteDocument(id: string, tenantId: string): Promise<boolean>;
    /** Queries documents matching a metadata filter. */
    queryDocuments?(filter: Record<string, unknown>, limit?: number): Promise<StoredDocumentEntity[]>;
}

/**
 * Extensible vector store contract supporting capability negotiation and atomic replacement.
 */
export interface IVectorStore extends IVectorStoreAdapter, IStorageCapabilities {
    /**
     * Replaces all chunks belonging to a document under a specific version atomically.
     *
     * @param documentId - Root document ID.
     * @param tenantId - Tenant identifier.
     * @param version - Proposed version number.
     * @param documents - New chunks to persist.
     * @returns 'applied' if replaced, 'unchanged' if identical digest, 'superseded' if older version.
     */
    replaceDocument?(
        documentId: string,
        tenantId: string,
        version: number,
        documents: Omit<VectorDocument, 'score'>[]
    ): Promise<'applied' | 'unchanged' | 'superseded'>;
    /** Initializes database tables and indexes. */
    init?(): Promise<void>;
    /** Closes open database connections or pools. */
    close?(): Promise<void>;
}

/**
 * Extensible graph store contract for knowledge graph extraction and GraphRAG.
 */
export interface IGraphStore extends IGraphAdapter, IStorageCapabilities {
    /** Initializes graph tables, constraints, and indexes. */
    init(): Promise<void>;
    /** Closes open connections. */
    close?(): Promise<void>;
}

/**
 * Uploaded document payload tracked in the durable ingestion ledger.
 */
export interface StoredUpload {
    /** SHA-256 derived ingestion job ID. */
    id: string;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** User identifier of the uploader. */
    userId: string;
    /** Canonical logical document ID. */
    documentId: string;
    /** Original file name. */
    filename: string;
    /** Version assigned to this document ingestion. */
    version: number;
    /** SHA-256 digest of original buffer content. */
    digest: string;
    /** Chunk size and overlap settings used for splitting. */
    settings: IngestionSettings;
    /** Raw binary file content; null if processed or purged. */
    content: Buffer | null;
    /** Current processing state. */
    status: JobStatus;
    /** Final processing results, chunk counts, or diagnostic metrics. */
    result: Record<string, unknown> | null;
    /** Error message if processing failed. */
    error: string | null;
    /** Created epoch timestamp in milliseconds. */
    createdAt: number;
    /** Last updated epoch timestamp in milliseconds. */
    updatedAt: number;
}

/**
 * Durable ingestion ledger and state store contract.
 */
export interface IIngestionStore extends IStorageCapabilities {
    /** Verifies that ingestion tables/collections are ready. */
    ready(): Promise<void>;
    /** Applies required schema migrations or collections. */
    migrate?(): Promise<void>;
    /** Closes underlying connection pools. */
    close?(): Promise<void>;
    /**
     * Inserts an upload record with quota check and idempotency deduplication.
     */
    put(
        input: {
            tenantId: string;
            userId: string;
            documentId: string;
            filename: string;
            content: Buffer;
            settings: IngestionSettings;
            idempotencyKey?: string | undefined;
        },
        limits: { maxPending: number; maxStoredBytes: number }
    ): Promise<StoredUpload>;
    /** Retrieves an upload by ID and tenantId. */
    get(id: string, tenantId?: string): Promise<StoredUpload | null>;
    /** Returns pending/processing uploads for dispatcher recovery. */
    dispatchable(limit?: number): Promise<Array<{ id: string; tenantId: string }>>;
    /** Transitions an upload to queued, processing, or failed status. */
    mark(id: string, status: 'queued' | 'processing' | 'failed', error?: string): Promise<void>;
    /** Completes an upload, stores results, and frees heavy blob content. */
    complete(id: string, result: Record<string, unknown>): Promise<void>;
    /** Resets a failed job to pending state for retry. */
    resetFailed(id: string, tenantId: string): Promise<void>;
    /** Purges expired blob buffers for failed uploads past retention days. */
    expireFailedBlobs(retentionDays?: number): Promise<void>;
}

/**
 * Dedicated blob/object storage contract for persisting document uploads and model weights.
 */
export interface IBlobStore extends IStorageCapabilities {
    /** Writes a blob under a tenant-isolated key. */
    put(key: string, data: Buffer, tenantId: string): Promise<{ uri: string; sizeBytes: number }>;
    /** Retrieves a blob by key within a tenant boundary. Returns null if not found. */
    get(key: string, tenantId: string): Promise<Buffer | null>;
    /** Deletes a blob by key within a tenant boundary. Returns true if deleted. */
    delete(key: string, tenantId: string): Promise<boolean>;
    /** Verifies whether a blob exists under a tenant key. */
    exists(key: string, tenantId: string): Promise<boolean>;
}

/**
 * Portable embedding model provider contract independent of storage persistence.
 */
export interface IEmbeddingProvider {
    /** Unique identifier of the embedding model (e.g. 'all-MiniLM-L6-v2', 'text-embedding-3-small'). */
    readonly modelName: string;
    /** Output embedding dimensionality (e.g. 384, 768, 1536). */
    readonly dimensions: number;
    /** Computes dense vector embedding for single text. */
    getEmbedding(text: string): Promise<Float32Array | number[]>;
    /** Computes dense vector embeddings for batch of texts. */
    getBatchEmbeddings?(texts: string[]): Promise<Array<Float32Array | number[]>>;
}

/**
 * Unified multi-provider storage container configuration.
 */
export interface StorageContainerConfig {
    /** Primary or secondary document storage backend. */
    documents?: IDocumentStore | undefined;
    /** Vector database adapter for dense and hybrid semantic retrieval. */
    vectors?: IVectorStore | IVectorStoreAdapter | undefined;
    /** Knowledge graph database adapter for GraphRAG and entity traversal. */
    graph?: IGraphStore | IGraphAdapter | undefined;
    /** Caching layer for responses, prompts, and embeddings. */
    cache?: ICacheAdapter | undefined;
    /** Durable ingestion ledger and job outbox store. */
    ingestion?: IIngestionStore | undefined;
    /** Distributed or in-memory job queue for asynchronous background processing. */
    queue?: IJobQueue<any> | undefined;
    /** Object/blob storage for document sources and large artifacts. */
    blob?: IBlobStore | undefined;
    /** Custom named adapters. */
    custom?: Record<string, unknown> | undefined;
}

/**
 * Resolved unified storage container providing coordinated lifecycle and capability discovery.
 */
export interface StorageContainer {
    readonly config: StorageContainerConfig;
    /** Initializes all configured storage adapters concurrently. */
    init(): Promise<void>;
    /** Closes all configured storage adapters gracefully. */
    close(): Promise<void>;
    /** Runs health checks across all configured adapters. */
    healthCheck(): Promise<Record<string, { status: 'healthy' | 'unhealthy'; latencyMs?: number; error?: string }>>;
    /** Validates that configured providers fulfill required capabilities. */
    validateCapabilities(requirements: Partial<Record<keyof StorageContainerConfig, Array<keyof StorageCapabilities>>>): boolean;
}
