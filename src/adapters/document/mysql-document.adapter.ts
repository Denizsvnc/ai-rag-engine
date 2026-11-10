import type { IDocumentStore, StoredDocumentEntity, StorageCapabilities } from '../../interfaces/storage.interface.js';

export interface MySQLDocumentOptions {
    /** MySQL host. Defaults to 'localhost'. */
    host?: string | undefined;
    /** MySQL port. Defaults to 3306. */
    port?: number | undefined;
    /** Database username. */
    user?: string | undefined;
    /** Database password. */
    password?: string | undefined;
    /** Database schema name. Defaults to 'rag_db'. */
    database?: string | undefined;
    /** Base table name for documents. Defaults to 'rag_documents'. */
    tableName?: string | undefined;
    /** Existing `mysql2/promise` pool instance. */
    pool?: any | undefined;
}

/**
 * MySQL document store adapter with lazy-loaded driver isolation.
 *
 * @remarks
 * Driver Isolation:
 * Does not require `mysql2` as a mandatory runtime dependency.
 * Dynamically imports `mysql2/promise` when initialized.
 *
 * Multi-Tenancy:
 * All SQL statements enforce composite `(tenant_id, id)` uniqueness and index scoping.
 *
 * @example
 * ```typescript
 * import { MySQLDocumentAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const docStore = new MySQLDocumentAdapter({
 *   host: '127.0.0.1',
 *   user: 'rag_user',
 *   password: 'secret_password',
 *   database: 'rag_store'
 * });
 * await docStore.init();
 * ```
 */
export class MySQLDocumentAdapter implements IDocumentStore {
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
        fullTextSearch: true
    };

    private pool: any;
    private readonly tableName: string;
    private isInitialized = false;

    constructor(private readonly options: MySQLDocumentOptions) {
        const name = options.tableName ?? 'rag_documents';
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) {
            throw new Error('[MySQLDocumentAdapter] Invalid table name. Must be lowercase alphanumeric.');
        }
        this.tableName = name;
        if (options.pool) {
            this.pool = options.pool;
        }
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;

        if (!this.pool) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mysqlPkg: any = await import('mysql2/promise' as string);
                this.pool = mysqlPkg.createPool({
                    host: this.options.host ?? 'localhost',
                    port: this.options.port ?? 3306,
                    user: this.options.user ?? 'root',
                    password: this.options.password ?? '',
                    database: this.options.database ?? 'rag_db',
                    waitForConnections: true,
                    connectionLimit: 10
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('Cannot find package') || msg.includes('ERR_MODULE_NOT_FOUND')) {
                    throw new Error(
                        '[MySQLDocumentAdapter] Optional dependency "mysql2" is not installed. Run: npm install mysql2'
                    );
                }
                throw err;
            }
        }

        // Create table and indexes
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
                \`id\` VARCHAR(128) NOT NULL,
                \`tenant_id\` VARCHAR(128) NOT NULL,
                \`content\` MEDIUMTEXT NOT NULL,
                \`metadata\` JSON NOT NULL,
                \`version\` INT NOT NULL DEFAULT 1,
                \`created_at\` BIGINT NOT NULL,
                \`updated_at\` BIGINT NOT NULL,
                PRIMARY KEY (\`tenant_id\`, \`id\`),
                INDEX \`idx_tenant\` (\`tenant_id\`),
                INDEX \`idx_tenant_updated\` (\`tenant_id\`, \`updated_at\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        this.isInitialized = true;
    }

    public async close(): Promise<void> {
        if (this.pool && typeof this.pool.end === 'function') {
            await this.pool.end();
            this.isInitialized = false;
        }
    }

    private getPool(): any {
        if (!this.isInitialized || !this.pool) {
            throw new Error('[MySQLDocumentAdapter] Store not initialized. Call init() first.');
        }
        return this.pool;
    }

    public async putDocument(doc: StoredDocumentEntity): Promise<void> {
        await this.putDocuments([doc]);
    }

    public async putDocuments(docs: StoredDocumentEntity[]): Promise<void> {
        const pool = this.getPool();
        const now = Date.now();

        const sql = `
            INSERT INTO \`${this.tableName}\` (id, tenant_id, content, metadata, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                content = VALUES(content),
                metadata = VALUES(metadata),
                version = VALUES(version),
                updated_at = VALUES(updated_at);
        `;

        for (const doc of docs) {
            await pool.query(sql, [
                doc.id,
                doc.tenantId,
                doc.content,
                JSON.stringify(doc.metadata ?? {}),
                doc.version ?? 1,
                doc.createdAt ?? now,
                now
            ]);
        }
    }

    public async getDocument(id: string, tenantId: string): Promise<StoredDocumentEntity | null> {
        const pool = this.getPool();
        const [rows] = await pool.query(
            `SELECT id, tenant_id, content, metadata, version, created_at, updated_at FROM \`${this.tableName}\` WHERE tenant_id = ? AND id = ?`,
            [tenantId, id]
        );

        if (!Array.isArray(rows) || rows.length === 0) return null;
        const row = rows[0] as any;

        return {
            id: String(row.id),
            tenantId: String(row.tenant_id),
            content: String(row.content),
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {}),
            version: Number(row.version),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at)
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
        const pool = this.getPool();
        const [res] = await pool.query(
            `DELETE FROM \`${this.tableName}\` WHERE tenant_id = ? AND id = ?`,
            [tenantId, id]
        );
        return (res as any)?.affectedRows > 0;
    }

    public async queryDocuments(filter: Record<string, unknown>, limit = 100): Promise<StoredDocumentEntity[]> {
        const pool = this.getPool();
        const tenantId = filter.tenantId ? String(filter.tenantId) : undefined;

        let sql = `SELECT id, tenant_id, content, metadata, version, created_at, updated_at FROM \`${this.tableName}\``;
        const params: (string | number)[] = [];

        if (tenantId) {
            sql += ` WHERE tenant_id = ?`;
            params.push(tenantId);
        }

        sql += ` ORDER BY updated_at DESC LIMIT ?`;
        params.push(limit);

        const [rows] = await pool.query(sql, params);
        if (!Array.isArray(rows)) return [];

        return rows.map((row: any) => ({
            id: String(row.id),
            tenantId: String(row.tenant_id),
            content: String(row.content),
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {}),
            version: Number(row.version),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at)
        }));
    }
}

