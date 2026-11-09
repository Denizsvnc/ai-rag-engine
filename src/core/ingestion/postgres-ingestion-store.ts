import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { JobStatus } from '../queue/job-queue.interface.js';
import type { IngestionSettings } from '../../interfaces/ingestion.interface.js';

export interface StoredUpload {
    id: string;
    tenantId: string;
    userId: string;
    documentId: string;
    filename: string;
    version: number;
    digest: string;
    settings: IngestionSettings;
    content: Buffer | null;
    status: JobStatus;
    result: Record<string, unknown> | null;
    error: string | null;
    createdAt: number;
    updatedAt: number;
}

export class IngestionQuotaError extends Error {}
export class IngestionConflictError extends Error {}

/** Shared blobs, document revisions and a durable outbox. No process-local file references. */
export class PostgresIngestionStore {
    private readonly table: string;
    private readonly heads: string;
    private readonly tableName: string;
    constructor(public readonly pool: Pool, tableName = 'rag_ingestion') {
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(tableName)) throw new Error('Invalid ingestion table name.');
        this.tableName = tableName;
        this.table = `"${tableName}"`;
        this.heads = `"${tableName}_heads"`;
    }

    public async migrate(): Promise<void> {
        await this.transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rag-ingestion-schema']);
            await client.query(`CREATE TABLE IF NOT EXISTS ${this.heads} (
                tenant_id text NOT NULL, document_id text NOT NULL, version integer NOT NULL,
                PRIMARY KEY (tenant_id, document_id)
            )`);
            await client.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
                id text PRIMARY KEY, tenant_id text NOT NULL, user_id text NOT NULL, document_id text NOT NULL,
                filename text NOT NULL, version integer NOT NULL, digest text NOT NULL, settings jsonb NOT NULL,
                content bytea, idempotency_key text, status text NOT NULL CHECK (status IN ('pending','queued','processing','completed','failed')),
                result jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
            )`);
            await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "${this.tableName}_idempotency_idx" ON ${this.table} (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
            await client.query(`CREATE INDEX IF NOT EXISTS "${this.tableName}_pending_idx" ON ${this.table} (status, updated_at)`);
            await client.query(`CREATE INDEX IF NOT EXISTS "${this.tableName}_tenant_idx" ON ${this.table} (tenant_id)`);
        });
    }

    public async ready(): Promise<void> {
        await this.pool.query(`SELECT id FROM ${this.table} LIMIT 0`);
    }

    public async put(input: { tenantId: string; userId: string; documentId: string; filename: string; content: Buffer; settings: IngestionSettings; idempotencyKey?: string | undefined }, limits: { maxPending: number; maxStoredBytes: number }): Promise<StoredUpload> {
        const digest = createHash('sha256').update(input.content).digest('hex');
        return this.transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ingestion:${this.tableName}:${input.tenantId}`]);
            const previous = input.idempotencyKey
                ? await client.query(`SELECT * FROM ${this.table} WHERE tenant_id = $1 AND idempotency_key = $2`, [input.tenantId, input.idempotencyKey])
                : await client.query(`SELECT j.* FROM ${this.table} j JOIN ${this.heads} h
                    ON j.tenant_id = h.tenant_id AND j.document_id = h.document_id AND j.version = h.version
                    WHERE j.tenant_id = $1 AND j.document_id = $2`, [input.tenantId, input.documentId]);
            const old = previous.rows[0];
            if (old && old.digest === digest && old.document_id === input.documentId && old.filename === input.filename
                && old.settings.chunkSize === input.settings.chunkSize && old.settings.chunkOverlap === input.settings.chunkOverlap) return this.row(old);
            if (old && input.idempotencyKey) throw new IngestionConflictError('Idempotency key already used for different content.');
            const quota = await client.query(`SELECT count(*) FILTER (WHERE status IN ('pending','queued','processing')) AS pending,
                coalesce(sum(octet_length(content)), 0) AS bytes FROM ${this.table} WHERE tenant_id = $1`, [input.tenantId]);
            if (Number(quota.rows[0].pending) >= limits.maxPending || Number(quota.rows[0].bytes) + input.content.length > limits.maxStoredBytes) {
                throw new IngestionQuotaError('Tenant ingestion quota exceeded.');
            }
            const head = await client.query(`INSERT INTO ${this.heads} AS h VALUES ($1, $2, 1)
                ON CONFLICT (tenant_id, document_id) DO UPDATE SET version = h.version + 1 RETURNING version`, [input.tenantId, input.documentId]);
            const id = createHash('sha256').update(JSON.stringify([input.tenantId, input.documentId, head.rows[0].version, digest])).digest('hex');
            const saved = await client.query(`INSERT INTO ${this.table}
                (id,tenant_id,user_id,document_id,filename,version,digest,settings,content,idempotency_key,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'pending') RETURNING *`,
                [id, input.tenantId, input.userId, input.documentId, input.filename, head.rows[0].version, digest, JSON.stringify(input.settings), input.content, input.idempotencyKey ?? null]);
            return this.row(saved.rows[0]);
        });
    }

    public async get(id: string, tenantId?: string): Promise<StoredUpload | null> {
        if (!tenantId) return null;
        const result = await this.pool.query(`SELECT * FROM ${this.table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
        return result.rows[0] ? this.row(result.rows[0]) : null;
    }

    public async dispatchable(limit = 100): Promise<Array<{ id: string; tenantId: string }>> {
        const result = await this.pool.query(`SELECT id, tenant_id FROM ${this.table} WHERE status IN ('pending','queued','processing')
            ORDER BY (status = 'pending') DESC, updated_at LIMIT $1`, [limit]);
        return result.rows.map(row => ({ id: row.id, tenantId: row.tenant_id }));
    }

    public async mark(id: string, status: 'queued' | 'processing' | 'failed', error?: string): Promise<void> {
        const condition = status === 'queued' ? "AND status = 'pending'" : "AND status NOT IN ('completed','failed')";
        await this.pool.query(`UPDATE ${this.table} SET status = $2, error = $3, updated_at = now() WHERE id = $1 ${condition}`, [id, status, error ?? null]);
    }

    public async complete(id: string, result: Record<string, unknown>): Promise<void> {
        // Successful blobs are released while the idempotency/result ledger remains.
        await this.pool.query(`UPDATE ${this.table} SET status = 'completed', result = $2::jsonb, error = NULL,
            content = NULL, updated_at = now() WHERE id = $1`, [id, JSON.stringify(result)]);
    }

    public async resetFailed(id: string, tenantId: string): Promise<void> {
        const result = await this.pool.query(`UPDATE ${this.table} SET status = 'pending', error = NULL, updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND status = 'failed' AND content IS NOT NULL`, [id, tenantId]);
        if (!result.rowCount) throw new Error('Failed job missing or its retry payload has expired.');
    }

    public async expireFailedBlobs(retentionDays = 7): Promise<void> {
        await this.pool.query(`UPDATE ${this.table} SET content = NULL WHERE status = 'failed' AND content IS NOT NULL
            AND updated_at < now() - ($1 * interval '1 day')`, [retentionDays]);
    }

    private row(row: Record<string, any>): StoredUpload {
        return {
            id: row.id, tenantId: row.tenant_id, userId: row.user_id, documentId: row.document_id,
            filename: row.filename, version: row.version, digest: row.digest, settings: row.settings,
            content: row.content, status: row.status, result: row.result, error: row.error,
            createdAt: new Date(row.created_at).getTime(), updatedAt: new Date(row.updated_at).getTime()
        };
    }

    private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
        finally { client.release(); }
    }
}
