import { DatabaseSync } from 'node:sqlite';
import type { IDocumentStore, StoredDocumentEntity, StorageCapabilities } from '../../interfaces/storage.interface.js';

export interface SqliteDocumentOptions {
    /** File path for SQLite database or ':memory:'. @defaultValue ':memory:' */
    filePath?: string | undefined;
    /** Base table name for document entities. @defaultValue 'rag_documents_store' */
    tableName?: string | undefined;
}

/**
 * Local persistent document storage adapter backed by `node:sqlite`.
 *
 * @remarks
 * Features:
 * - ACID transactions for multi-document batch operations.
 * - Enforces composite primary key `(tenant_id, id)` for strict multi-tenant boundary isolation.
 * - JSON metadata serialization and query filtering.
 *
 * @example
 * ```typescript
 * import { SqliteDocumentAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const docStore = new SqliteDocumentAdapter({ filePath: './data/docs.sqlite' });
 * await docStore.init();
 * await docStore.putDocument({
 *   id: 'policy_doc',
 *   tenantId: 'tenant_1',
 *   content: 'Full legal terms of service...',
 *   metadata: { category: 'legal', author: 'compliance_team' }
 * });
 * const doc = await docStore.getDocument('policy_doc', 'tenant_1');
 * ```
 */
export class SqliteDocumentAdapter implements IDocumentStore {
    public readonly capabilities: StorageCapabilities = {
        denseVectorSearch: false,
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

    private db: DatabaseSync | undefined;
    private readonly filePath: string;
    private readonly tableName: string;
    private isInitialized = false;

    constructor(options: SqliteDocumentOptions = {}) {
        this.filePath = options.filePath ?? ':memory:';
        const name = options.tableName ?? 'rag_documents_store';
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) {
            throw new Error('[SqliteDocumentAdapter] Invalid table name. Must be lowercase alphanumeric.');
        }
        this.tableName = name;
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async init(): Promise<void> {
        if (this.isInitialized && this.db) return;

        this.db = new DatabaseSync(this.filePath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS "${this.tableName}" (
                id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT NOT NULL,
                version INT NOT NULL DEFAULT 1,
                created_at INT NOT NULL,
                updated_at INT NOT NULL,
                PRIMARY KEY (tenant_id, id)
            );
            CREATE INDEX IF NOT EXISTS "${this.tableName}_tenant_idx" ON "${this.tableName}" (tenant_id);
            CREATE INDEX IF NOT EXISTS "${this.tableName}_updated_idx" ON "${this.tableName}" (tenant_id, updated_at);
        `);

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
            throw new Error('[SqliteDocumentAdapter] Store not initialized. Call init() first.');
        }
        return this.db;
    }

    public async putDocument(doc: StoredDocumentEntity): Promise<void> {
        await this.putDocuments([doc]);
    }

    public async putDocuments(docs: StoredDocumentEntity[]): Promise<void> {
        const db = this.getDb();
        const now = Date.now();
        const stmt = db.prepare(`
            INSERT INTO "${this.tableName}" (id, tenant_id, content, metadata, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, id) DO UPDATE SET
                content = excluded.content,
                metadata = excluded.metadata,
                version = excluded.version,
                updated_at = excluded.updated_at;
        `);

        db.exec('BEGIN TRANSACTION;');
        try {
            for (const doc of docs) {
                stmt.run(
                    doc.id,
                    doc.tenantId,
                    doc.content,
                    JSON.stringify(doc.metadata ?? {}),
                    doc.version ?? 1,
                    doc.createdAt ?? now,
                    now
                );
            }
            db.exec('COMMIT;');
        } catch (err) {
            db.exec('ROLLBACK;');
            throw err;
        }
    }

    public async getDocument(id: string, tenantId: string): Promise<StoredDocumentEntity | null> {
        const db = this.getDb();
        const row = db.prepare(`
            SELECT id, tenant_id, content, metadata, version, created_at, updated_at
            FROM "${this.tableName}" WHERE tenant_id = ? AND id = ?
        `).get(tenantId, id) as {
            id: string;
            tenant_id: string;
            content: string;
            metadata: string;
            version: number;
            created_at: number;
            updated_at: number;
        } | undefined;

        if (!row) return null;

        let metadata: Record<string, unknown> = {};
        try {
            metadata = JSON.parse(row.metadata);
        } catch {}

        return {
            id: row.id,
            tenantId: row.tenant_id,
            content: row.content,
            metadata,
            version: row.version,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    public async getDocuments(ids: string[], tenantId: string): Promise<StoredDocumentEntity[]> {
        const results: StoredDocumentEntity[] = [];
        for (const id of ids) {
            const doc = await this.getDocument(id, tenantId);
            if (doc) results.push(doc);
        }
        return results;
    }

    public async deleteDocument(id: string, tenantId: string): Promise<boolean> {
        const db = this.getDb();
        const res = db.prepare(`
            DELETE FROM "${this.tableName}" WHERE tenant_id = ? AND id = ?
        `).run(tenantId, id);
        return (res.changes ?? 0) > 0;
    }

    public async queryDocuments(filter: Record<string, unknown>, limit = 100): Promise<StoredDocumentEntity[]> {
        const db = this.getDb();
        const tenantId = filter.tenantId ? String(filter.tenantId) : undefined;

        let sql = `SELECT id, tenant_id, content, metadata, version, created_at, updated_at FROM "${this.tableName}"`;
        const params: (string | number)[] = [];

        if (tenantId) {
            sql += ` WHERE tenant_id = ?`;
            params.push(tenantId);
        }

        sql += ` ORDER BY updated_at DESC LIMIT ?`;
        params.push(limit);

        const rows = db.prepare(sql).all(...params) as Array<{
            id: string;
            tenant_id: string;
            content: string;
            metadata: string;
            version: number;
            created_at: number;
            updated_at: number;
        }>;

        return rows.map(row => {
            let metadata: Record<string, unknown> = {};
            try {
                metadata = JSON.parse(row.metadata);
            } catch {}

            return {
                id: row.id,
                tenantId: row.tenant_id,
                content: row.content,
                metadata,
                version: row.version,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        });
    }
}

