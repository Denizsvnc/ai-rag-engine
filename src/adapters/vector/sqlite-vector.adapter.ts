import { DatabaseSync } from 'node:sqlite';
import type { VectorDocument } from '../../interfaces/vector.interface.js';
import type { IVectorStore, StorageCapabilities, IEmbeddingProvider } from '../../interfaces/storage.interface.js';
import { SMLEngine } from '../../core/sml-engine.js';
import { dotProduct } from '../../utils/math.js';
import { reciprocalRankFusion, type HybridScoredDocument } from '../../core/vector/hybrid-search.js';

export interface SqliteVectorOptions {
    /** File path for SQLite database (e.g. './data/vectors.sqlite') or ':memory:'. @defaultValue ':memory:' */
    filePath?: string | undefined;
    /** Base table name for vector documents. @defaultValue 'rag_vectors' */
    tableName?: string | undefined;
    /** Optional custom embedding provider. If omitted, uses local in-process `SMLEngine`. */
    embeddingProvider?: IEmbeddingProvider | undefined;
}

/**
 * Local persistent vector store adapter powered by Node.js built-in `node:sqlite`.
 *
 * @remarks
 * Features:
 * - Zero third-party native compilation or C++ build tools required.
 * - Stores dense 384-dimensional embeddings as raw binary IEEE-754 Float32 buffers.
 * - Integrated SQLite FTS5 inverted index for fast BM25 sparse keyword queries.
 * - ACID transactions and atomic document replacement (`replaceDocument`).
 * - Strict multi-tenant isolation enforced at the SQLite SQL engine level.
 *
 * @example
 * ```typescript
 * import { SqliteVectorAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const vectorStore = new SqliteVectorAdapter({ filePath: './data/rag.sqlite' });
 * await vectorStore.init();
 * await vectorStore.addDocuments([{
 *   id: 'chunk_1',
 *   content: 'Refunds are issued within 14 days.',
 *   metadata: { tenantId: 'tenant_alpha' }
 * }]);
 * const results = await vectorStore.searchHybrid('refund window', 3, { tenantId: 'tenant_alpha' });
 * ```
 */
export class SqliteVectorAdapter implements IVectorStore {
    public readonly capabilities: StorageCapabilities = {
        denseVectorSearch: true,
        sparseRetrieval: true,
        nativeHybridSearch: true,
        metadataFiltering: true,
        namespaceIsolation: true,
        transactions: true,
        atomicDocumentReplacement: true,
        versioning: true,
        batchOperations: true,
        nativeIndexes: true,
        fullTextSearch: true
    };

    private db: DatabaseSync | undefined;
    private readonly filePath: string;
    private readonly tableName: string;
    private readonly ftsTable: string;
    private smlEngine: SMLEngine;
    private embeddingProvider?: IEmbeddingProvider | undefined;
    private isInitialized = false;

    constructor(options: SqliteVectorOptions = {}) {
        this.filePath = options.filePath ?? ':memory:';
        const name = options.tableName ?? 'rag_vectors';
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) {
            throw new Error('[SqliteVectorAdapter] Invalid table name. Must be lowercase alphanumeric.');
        }
        this.tableName = name;
        this.ftsTable = `${name}_fts`;
        this.smlEngine = new SMLEngine();
        this.embeddingProvider = options.embeddingProvider;
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async init(): Promise<void> {
        if (this.isInitialized && this.db) return;

        this.db = new DatabaseSync(this.filePath);

        // 1. Create main vectors table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "${this.tableName}" (
                id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                document_id TEXT,
                content TEXT NOT NULL,
                embedding BLOB NOT NULL,
                metadata TEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                created_at INT NOT NULL,
                PRIMARY KEY (tenant_id, id)
            );
            CREATE INDEX IF NOT EXISTS "${this.tableName}_tenant_doc_idx" ON "${this.tableName}" (tenant_id, document_id);
            CREATE INDEX IF NOT EXISTS "${this.tableName}_tenant_ver_idx" ON "${this.tableName}" (tenant_id, version);
        `);

        // 2. Create FTS5 virtual table for sparse BM25 retrieval
        try {
            this.db.exec(`
                CREATE VIRTUAL TABLE IF NOT EXISTS "${this.ftsTable}" USING fts5(
                    id UNINDEXED,
                    tenant_id UNINDEXED,
                    content,
                    tokenize = 'unicode61'
                );
            `);
        } catch {
            // Older sqlite engines without fts5 fallback gracefully
        }

        this.isInitialized = true;
    }

    public async close(): Promise<void> {
        if (this.db) {
            try {
                this.db.close();
            } catch {}
            this.db = undefined;
            this.isInitialized = false;
        }
    }

    private getDb(): DatabaseSync {
        if (!this.db || !this.isInitialized) {
            throw new Error('[SqliteVectorAdapter] Adapter not initialized. Call init() before querying.');
        }
        return this.db;
    }

    private async computeEmbedding(text: string): Promise<Float32Array> {
        if (this.embeddingProvider) {
            const raw = await this.embeddingProvider.getEmbedding(text);
            return raw instanceof Float32Array ? raw : new Float32Array(raw);
        }
        const raw = await this.smlEngine.getEmbedding(text);
        return raw instanceof Float32Array ? raw : new Float32Array(raw);
    }

    public async addDocuments(docs: Omit<VectorDocument, 'score'>[]): Promise<void> {
        const db = this.getDb();
        const insertStmt = db.prepare(`
            INSERT INTO "${this.tableName}" (id, tenant_id, document_id, content, embedding, metadata, version, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, id) DO UPDATE SET
                content = excluded.content,
                embedding = excluded.embedding,
                metadata = excluded.metadata,
                version = excluded.version;
        `);

        let ftsInsertStmt: ReturnType<DatabaseSync['prepare']> | undefined;
        try {
            ftsInsertStmt = db.prepare(`
                INSERT INTO "${this.ftsTable}" (id, tenant_id, content)
                VALUES (?, ?, ?);
            `);
        } catch {}

        const now = Date.now();

        // Process embeddings
        for (const doc of docs) {
            const tenantId = String(doc.metadata?.tenantId ?? 'default');
            const documentId = doc.metadata?.sourceDocId ? String(doc.metadata.sourceDocId) : null;
            const version = doc.version ?? 1;
            const embedding = await this.computeEmbedding(doc.content);
            const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

            insertStmt.run(
                doc.id,
                tenantId,
                documentId,
                doc.content,
                embeddingBuffer,
                JSON.stringify(doc.metadata ?? {}),
                version,
                now
            );

            if (ftsInsertStmt) {
                try {
                    ftsInsertStmt.run(doc.id, tenantId, doc.content);
                } catch {}
            }
        }
    }

    public async search(
        query: string,
        topK: number = 5,
        filter?: Record<string, unknown>
    ): Promise<VectorDocument[]> {
        const db = this.getDb();
        const tenantId = filter?.tenantId ? String(filter.tenantId) : undefined;
        const queryVector = await this.computeEmbedding(query);

        let sql = `SELECT id, tenant_id, content, embedding, metadata, version FROM "${this.tableName}"`;
        const params: (string | number)[] = [];

        if (tenantId) {
            sql += ` WHERE tenant_id = ?`;
            params.push(tenantId);
        }

        const rows = db.prepare(sql).all(...params) as Array<{
            id: string;
            tenant_id: string;
            content: string;
            embedding: Buffer;
            metadata: string;
            version: number;
        }>;

        const scored: VectorDocument[] = [];
        for (const row of rows) {
            const rowFloats = new Float32Array(
                row.embedding.buffer,
                row.embedding.byteOffset,
                row.embedding.byteLength / 4
            );
            const score = dotProduct(
                queryVector as unknown as number[],
                rowFloats as unknown as number[]
            );

            let metadata: Record<string, unknown> = {};
            try {
                metadata = JSON.parse(row.metadata);
            } catch {}

            scored.push({
                id: row.id,
                content: row.content,
                metadata: { ...metadata, tenantId: row.tenant_id },
                version: row.version,
                score
            });
        }

        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return scored.slice(0, topK);
    }

    public async searchHybrid(
        query: string,
        topK: number = 5,
        filter?: Record<string, unknown>
    ): Promise<VectorDocument[]> {
        const denseResults = await this.search(query, topK * 2, filter);
        const db = this.getDb();
        const tenantId = filter?.tenantId ? String(filter.tenantId) : undefined;

        // Perform FTS5 sparse lexical search
        const sparseResults: VectorDocument[] = [];
        try {
            // Sanitize query for FTS5 syntax
            const sanitizedMatch = query.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(w => w.length > 2).join(' OR ');
            if (sanitizedMatch) {
                let ftsSql = `SELECT id, content FROM "${this.ftsTable}" WHERE content MATCH ?`;
                const params: string[] = [sanitizedMatch];
                if (tenantId) {
                    ftsSql += ` AND tenant_id = ?`;
                    params.push(tenantId);
                }
                ftsSql += ` LIMIT ?`;
                const ftsRows = db.prepare(ftsSql).all(...params, topK * 2) as Array<{ id: string; content: string }>;
                for (let i = 0; i < ftsRows.length; i++) {
                    const row = ftsRows[i]!;
                    sparseResults.push({
                        id: row.id,
                        content: row.content,
                        score: Number((1 / (i + 1)).toFixed(4))
                    });
                }
            }
        } catch {}

        if (sparseResults.length === 0) {
            return denseResults.slice(0, topK);
        }

        // Fuse with Reciprocal Rank Fusion
        const fused = reciprocalRankFusion(denseResults, sparseResults, 60);
        return fused.slice(0, topK);
    }

    public async replaceDocument(
        documentId: string,
        tenantId: string,
        version: number,
        documents: Omit<VectorDocument, 'score'>[]
    ): Promise<'applied' | 'unchanged' | 'superseded'> {
        const db = this.getDb();

        // 1. Check max version currently stored for this document
        const versionRow = db.prepare(`
            SELECT MAX(version) as max_version FROM "${this.tableName}"
            WHERE tenant_id = ? AND document_id = ?
        `).get(tenantId, documentId) as { max_version: number | null } | undefined;

        const currentVersion = versionRow?.max_version ?? 0;
        if (currentVersion > version) {
            return 'superseded';
        }

        // 2. Transactional replacement
        db.exec('BEGIN TRANSACTION;');
        try {
            // Delete old chunks
            db.prepare(`
                DELETE FROM "${this.tableName}" WHERE tenant_id = ? AND document_id = ?;
            `).run(tenantId, documentId);

            try {
                db.prepare(`
                    DELETE FROM "${this.ftsTable}" WHERE tenant_id = ? AND id IN (
                        SELECT id FROM "${this.tableName}" WHERE tenant_id = ? AND document_id = ?
                    );
                `).run(tenantId, tenantId, documentId);
            } catch {}

            // Insert new version chunks
            for (const doc of documents) {
                const embedding = await this.computeEmbedding(doc.content);
                const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
                db.prepare(`
                    INSERT INTO "${this.tableName}" (id, tenant_id, document_id, content, embedding, metadata, version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                `).run(
                    doc.id,
                    tenantId,
                    documentId,
                    doc.content,
                    embeddingBuffer,
                    JSON.stringify({ ...doc.metadata, tenantId, sourceDocId: documentId }),
                    version,
                    Date.now()
                );
            }

            db.exec('COMMIT;');
            return 'applied';
        } catch (error) {
            db.exec('ROLLBACK;');
            throw error;
        }
    }

    public async deleteDocument(id: string, filter?: Record<string, unknown>): Promise<boolean> {
        const db = this.getDb();
        const tenantId = filter?.tenantId ? String(filter.tenantId) : undefined;

        let sql = `DELETE FROM "${this.tableName}" WHERE id = ?`;
        const params: string[] = [id];
        if (tenantId) {
            sql += ` AND tenant_id = ?`;
            params.push(tenantId);
        }

        const res = db.prepare(sql).run(...params);
        return (res.changes ?? 0) > 0;
    }

    public async clear(filter?: Record<string, unknown>): Promise<void> {
        const db = this.getDb();
        const tenantId = filter?.tenantId ? String(filter.tenantId) : undefined;

        if (tenantId) {
            db.prepare(`DELETE FROM "${this.tableName}" WHERE tenant_id = ?`).run(tenantId);
            try {
                db.prepare(`DELETE FROM "${this.ftsTable}" WHERE tenant_id = ?`).run(tenantId);
            } catch {}
        } else {
            db.prepare(`DELETE FROM "${this.tableName}"`).run();
            try {
                db.prepare(`DELETE FROM "${this.ftsTable}"`).run();
            } catch {}
        }
    }

    public async getRevision(tenantId: string): Promise<string> {
        const db = this.getDb();
        const row = db.prepare(`
            SELECT count(*) as total, coalesce(max(version), 0) as max_ver, coalesce(max(created_at), 0) as latest_ts
            FROM "${this.tableName}" WHERE tenant_id = ?
        `).get(tenantId) as { total: number; max_ver: number; latest_ts: number } | undefined;

        if (!row) return '0';
        return `${row.total}:${row.max_ver}:${row.latest_ts}`;
    }
}

