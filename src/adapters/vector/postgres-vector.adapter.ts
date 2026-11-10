import { Pool, type PoolClient } from 'pg';
import type { VectorDocument } from '../../interfaces/vector.interface.js';
import type { IVectorStore, StorageCapabilities } from '../../interfaces/storage.interface.js';
import { SMLEngine } from '../../core/sml-engine.js';
import { reciprocalRankFusion } from '../../core/vector/hybrid-search.js';

/**
 * Lightweight contract for embedding providers passed to vector adapters.
 */
export interface EmbeddingProvider {
    /** Computes an embedding vector for a given text. */
    getEmbedding(text: string): Promise<ArrayLike<number>>;
}

/**
 * Configuration options for PostgreSQL `pgvector` store adapter.
 */
export interface PostgresVectorOptions {
    /** PostgreSQL connection URI (e.g. `postgresql://user:pass@host:5432/dbname`). */
    connectionString?: string | undefined;
    /** Existing `pg.Pool` instance to reuse connections. */
    pool?: Pool | undefined;
    /** Base table name for vector documents. Defaults to `'rag_documents'`. */
    tableName?: string | undefined;
    /** Model identifier metadata stored in configuration table. */
    modelName?: string | undefined;
    /** Vector embedding dimensions. Defaults to 384. Must match embedding model. */
    dimensions?: number | undefined;
    /** Custom embedding provider. If omitted, uses local `SMLEngine`. */
    embeddingProvider?: EmbeddingProvider | undefined;
    /** Disable after migrations have been applied by a database owner. Defaults to `true`. */
    autoMigrate?: boolean | undefined;
    /** Optional approximate HNSW index for high scale. Exact cosine search is the default. */
    createHnswIndex?: boolean | undefined;
}

/**
 * Production-ready PostgreSQL `pgvector` storage adapter.
 *
 * @remarks
 * Enforces strict multi-tenant data boundaries at the SQL query level.
 * Supports exact cosine distance (`<=>`), hybrid search with PostgreSQL full-text search (`tsvector`),
 * and approximate nearest neighbor search via HNSW indexing.
 *
 * @example
 * ```typescript
 * const pgVector = new PostgresVectorAdapter({
 *   connectionString: process.env.DATABASE_URL,
 *   dimensions: 384
 * });
 * await pgVector.init();
 * ```
 */
export class PostgresVectorAdapter implements IVectorStore {
    public readonly capabilities: StorageCapabilities = {
        denseVectorSearch: true,
        sparseRetrieval: false,
        nativeHybridSearch: false,
        metadataFiltering: true,
        namespaceIsolation: true,
        transactions: true,
        atomicDocumentReplacement: true,
        versioning: true,
        batchOperations: true,
        nativeIndexes: true,
        fullTextSearch: false
    };

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    private readonly pool: Pool;
    private readonly table: string;
    private readonly configTable: string;
    private readonly manifests: string;
    private readonly epochs: string;
    private readonly modelName: string;
    private readonly dimensions: number;
    private readonly embeddings: EmbeddingProvider;
    private initPromise: Promise<void> | undefined;

    constructor(private readonly options: PostgresVectorOptions) {
        const name = options.tableName ?? 'rag_documents';
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new Error('Invalid vector table name.');
        this.table = `"${name}"`;
        this.configTable = `"${name}_config"`;
        this.manifests = `"${name}_manifests"`;
        this.epochs = `"${name}_epochs"`;
        this.dimensions = options.dimensions ?? 384;
        if (!Number.isInteger(this.dimensions) || this.dimensions < 1 || this.dimensions > 2000) {
            throw new Error('Vector dimensions must be an integer between 1 and 2000.');
        }
        this.modelName = options.modelName ?? 'Xenova/all-MiniLM-L6-v2';
        if (!options.pool && !options.connectionString) throw new Error('PostgreSQL connectionString or pool is required.');
        this.pool = options.pool ?? new Pool({
            connectionString: options.connectionString, max: 5,
            connectionTimeoutMillis: 5000, statement_timeout: 10000
        });
        if (!options.pool) {
            this.pool.on('error', error => console.error('[PostgresVectorAdapter] Idle connection failed:', error.message));
        }
        this.embeddings = options.embeddingProvider ?? new SMLEngine({ modelName: this.modelName });
    }

    public async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.initialize().catch(error => { this.initPromise = undefined; throw error; });
        }
        return this.initPromise;
    }

    private async initialize(): Promise<void> {
        await this.transaction(async client => {
            if (this.options.autoMigrate !== false) {
                // Serialize DDL across instances, including first-time extension creation.
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rag-vector-schema']);
                await client.query('CREATE EXTENSION IF NOT EXISTS vector');
                await client.query(`CREATE TABLE IF NOT EXISTS ${this.configTable} (
                    singleton boolean PRIMARY KEY CHECK (singleton), model_name text NOT NULL, dimensions integer NOT NULL
                )`);
                await client.query(`INSERT INTO ${this.configTable} VALUES (true, $1, $2) ON CONFLICT DO NOTHING`, [this.modelName, this.dimensions]);
                await client.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
                    tenant_id text NOT NULL, id text NOT NULL, content text NOT NULL, metadata jsonb NOT NULL,
                    embedding vector(${this.dimensions}) NOT NULL, version integer NOT NULL DEFAULT 1,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    search_text tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
                    PRIMARY KEY (tenant_id, id)
                )`);
                await client.query(`CREATE TABLE IF NOT EXISTS ${this.manifests} (
                    tenant_id text NOT NULL, document_id text NOT NULL, version integer NOT NULL,
                    PRIMARY KEY (tenant_id, document_id)
                )`);
                await client.query(`CREATE TABLE IF NOT EXISTS ${this.epochs} (
                    tenant_id text PRIMARY KEY, revision bigint NOT NULL
                )`);
                const name = this.options.tableName ?? 'rag_documents';
                await client.query(`CREATE INDEX IF NOT EXISTS "${name}_metadata_idx" ON ${this.table} USING gin (metadata)`);
                await client.query(`CREATE INDEX IF NOT EXISTS "${name}_text_idx" ON ${this.table} USING gin (search_text)`);
                if (this.options.createHnswIndex) {
                    await client.query(`CREATE INDEX IF NOT EXISTS "${name}_vector_idx" ON ${this.table} USING hnsw (embedding vector_cosine_ops)`);
                }
            }
            const result = await client.query(`SELECT model_name, dimensions FROM ${this.configTable} WHERE singleton = true`);
            const config = result.rows[0];
            if (!config || config.model_name !== this.modelName || config.dimensions !== this.dimensions) {
                throw new Error('Embedding model/dimensions mismatch. Reindex into a new table before changing models.');
            }
        });
    }

    /** Upserts are atomic per batch and IDs are unique within a tenant. */
    public async addDocuments(documents: Omit<VectorDocument, 'score'>[]): Promise<void> {
        const rows = await this.prepare(documents);
        if (!rows.length) return;
        await this.init();
        await this.transaction(async client => {
            for (const tenant of await this.write(client, rows)) await this.bumpRevision(client, tenant);
        });
    }

    /** Atomically replaces all chunks; retries and older document revisions cannot overwrite newer work. */
    public async replaceDocument(documentId: string, tenantId: string, version: number, documents: Omit<VectorDocument, 'score'>[]): Promise<'applied' | 'unchanged' | 'superseded'> {
        this.tenant({ tenantId });
        if (!documentId || !Number.isSafeInteger(version) || version < 1 || !documents.length) throw new Error('Invalid document replacement.');
        if (documents.some(doc => doc.metadata?.tenantId !== tenantId || doc.metadata?.documentId !== documentId)) {
            throw new Error('Replacement tenant/document mismatch.');
        }
        const rows = await this.prepare(documents);
        await this.init();
        return this.transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([this.table, tenantId, documentId])]);
            const previous = await client.query(`SELECT version FROM ${this.manifests} WHERE tenant_id=$1 AND document_id=$2`, [tenantId, documentId]);
            if (previous.rows[0] && previous.rows[0].version >= version) return previous.rows[0].version === version ? 'unchanged' : 'superseded';
            await client.query(`DELETE FROM ${this.table} WHERE tenant_id=$1 AND metadata @> $2::jsonb`, [tenantId, JSON.stringify({ documentId })]);
            await this.write(client, rows);
            await client.query(`INSERT INTO ${this.manifests} VALUES ($1,$2,$3)
                ON CONFLICT (tenant_id,document_id) DO UPDATE SET version=EXCLUDED.version`, [tenantId, documentId, version]);
            await this.bumpRevision(client, tenantId);
            return 'applied';
        });
    }

    public async getRevision(tenantId: string): Promise<string> {
        this.tenant({ tenantId }); await this.init();
        const result = await this.pool.query(`SELECT revision::text FROM ${this.epochs} WHERE tenant_id=$1`, [tenantId]);
        return result.rows[0]?.revision ?? '0';
    }

    private async prepare(documents: Omit<VectorDocument, 'score'>[]) {
        const rows: Array<{ doc: Omit<VectorDocument, 'score'>; tenant: string; metadata: string; vector: string }> = [];
        for (const doc of documents) {
            if (typeof doc.id !== 'string' || !doc.id.trim() || typeof doc.content !== 'string' || !doc.content.trim()) {
                throw new Error('Document id and content must be non-empty strings.');
            }
            rows.push({ doc, tenant: this.tenant(doc.metadata), metadata: JSON.stringify(doc.metadata ?? {}), vector: this.vector(await this.embeddings.getEmbedding(doc.content)) });
        }
        return rows;
    }

    private async write(client: PoolClient, rows: Awaited<ReturnType<PostgresVectorAdapter['prepare']>>): Promise<Set<string>> {
        const changed = new Set<string>();
        for (const { doc, tenant, metadata, vector } of rows) {
            const result = await client.query(`INSERT INTO ${this.table} AS current (tenant_id,id,content,metadata,embedding)
                VALUES ($1,$2,$3,$4::jsonb,$5::vector)
                ON CONFLICT (tenant_id,id) DO UPDATE SET content=EXCLUDED.content,metadata=EXCLUDED.metadata,embedding=EXCLUDED.embedding,
                    version=current.version+1,updated_at=now()
                WHERE current.content IS DISTINCT FROM EXCLUDED.content OR current.metadata IS DISTINCT FROM EXCLUDED.metadata
                   OR current.embedding IS DISTINCT FROM EXCLUDED.embedding`, [tenant,doc.id,doc.content,metadata,vector]);
            if (result.rowCount) changed.add(tenant);
        }
        return changed;
    }

    private async bumpRevision(client: PoolClient, tenant: string): Promise<void> {
        await client.query(`INSERT INTO ${this.epochs} VALUES ($1,1) ON CONFLICT (tenant_id) DO UPDATE SET revision=${this.epochs}.revision+1`, [tenant]);
    }

    public async search(query: string, topK = 3, filter?: Record<string, unknown>): Promise<VectorDocument[]> {
        const tenant = this.tenant(filter);
        this.validateTopK(topK);
        const vector = this.vector(await this.embeddings.getEmbedding(query));
        await this.init();
        const result = await this.pool.query(`SELECT id, content, metadata, version,
                1 - (embedding <=> $3::vector) AS score FROM ${this.table}
            WHERE tenant_id = $1 AND metadata @> $2::jsonb
            ORDER BY embedding <=> $3::vector, id LIMIT $4`,
            [tenant, JSON.stringify(filter), vector, topK]);
        return result.rows.map(row => ({ ...row, score: Number(row.score) }));
    }

    /** PostgreSQL lexical search + dense search, fused with RRF. This is not BM25. */
    public async searchHybrid(query: string, topK = 3, filter?: Record<string, unknown>): Promise<VectorDocument[]> {
        const tenant = this.tenant(filter);
        this.validateTopK(topK);
        const candidates = Math.min(1000, Math.max(20, topK * 3));
        const dense = await this.search(query, candidates, filter);
        const sparse = await this.pool.query(`SELECT id, content, metadata, version,
                ts_rank_cd(search_text, websearch_to_tsquery('simple', $3)) AS score FROM ${this.table}
            WHERE tenant_id = $1 AND metadata @> $2::jsonb
              AND search_text @@ websearch_to_tsquery('simple', $3)
            ORDER BY score DESC, id LIMIT $4`, [tenant, JSON.stringify(filter), query, candidates]);
        return reciprocalRankFusion(dense, sparse.rows, topK);
    }

    public async deleteDocument(id: string, filter?: Record<string, unknown>): Promise<boolean> {
        const tenant = this.tenant(filter);
        await this.init();
        return this.transaction(async client => {
            const result = await client.query(`DELETE FROM ${this.table} WHERE tenant_id=$1 AND id=$2 AND metadata @> $3::jsonb`, [tenant,id,JSON.stringify(filter)]);
            if (result.rowCount) await this.bumpRevision(client, tenant);
            return (result.rowCount ?? 0) > 0;
        });
    }

    public async clear(filter?: Record<string, unknown>): Promise<void> {
        const tenant = this.tenant(filter); await this.init();
        await this.transaction(async client => {
            const result = await client.query(`DELETE FROM ${this.table} WHERE tenant_id=$1 AND metadata @> $2::jsonb`, [tenant,JSON.stringify(filter)]);
            if (result.rowCount) await this.bumpRevision(client, tenant);
        });
    }

    public async close(): Promise<void> {
        if (!this.options.pool) await this.pool.end();
    }

    private tenant(filter?: Record<string, unknown>): string {
        const tenant = filter?.tenantId;
        if (typeof tenant !== 'string' || !tenant.trim()) throw new Error('An explicit tenantId is required for PostgreSQL vector operations.');
        return tenant;
    }

    private vector(embedding: ArrayLike<number>): string {
        const values = Array.from(embedding);
        if (values.length !== this.dimensions || !values.every(Number.isFinite) || !values.some(value => value !== 0)) {
            throw new Error(`Embedding must contain ${this.dimensions} finite values and have non-zero magnitude.`);
        }
        return JSON.stringify(values);
    }

    private validateTopK(topK: number): void {
        if (!Number.isInteger(topK) || topK < 1 || topK > 1000) throw new Error('topK must be an integer between 1 and 1000.');
    }

    private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }
}
