import { Pool, type PoolClient } from 'pg';
import type { GraphNode, GraphEdge, GraphTraversalOptions, Subgraph } from '../../interfaces/graph.interface.js';
import type { IGraphStore, StorageCapabilities } from '../../interfaces/storage.interface.js';

/**
 * Configuration options for PostgreSQL Knowledge Graph storage.
 */
export interface PostgresGraphOptions {
    /** PostgreSQL connection string. */
    connectionString?: string | undefined;
    /** Existing `pg.Pool` instance. */
    pool?: Pool | undefined;
    /** Table name for graph entity nodes. Defaults to `'rag_graph_nodes'`. */
    nodesTable?: string | undefined;
    /** Table name for relationship edges. Defaults to `'rag_graph_edges'`. */
    edgesTable?: string | undefined;
    /** Automatically create tables and indices on initialization. Defaults to `true`. */
    autoMigrate?: boolean | undefined;
}

/**
 * Enterprise PostgreSQL Knowledge Graph storage adapter.
 *
 * @remarks
 * Implements multi-hop graph traversal using parameterized PostgreSQL Common Table Expressions (CTE) (`WITH RECURSIVE`).
 * Guarantees tenant isolation at the SQL query level and prevents infinite loops on cyclic graphs.
 *
 * @example
 * ```typescript
 * const graph = new PostgresGraphAdapter({
 *   connectionString: process.env.DATABASE_URL
 * });
 * await graph.init();
 * ```
 */
export class PostgresGraphAdapter implements IGraphStore {
    public readonly capabilities: StorageCapabilities = {
        graphTraversal: true,
        namespaceIsolation: true,
        transactions: true,
        batchOperations: true,
        nativeIndexes: true
    };

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    private pool: Pool;
    private readonly nodesTable: string;
    private readonly edgesTable: string;
    private initPromise?: Promise<void> | undefined;

    constructor(private readonly options: PostgresGraphOptions) {
        this.nodesTable = options.nodesTable ?? 'rag_graph_nodes';
        this.edgesTable = options.edgesTable ?? 'rag_graph_edges';

        if (!options.pool && !options.connectionString) {
            throw new Error('[PostgresGraphAdapter] PostgreSQL connectionString or pool is required.');
        }

        this.pool = options.pool ?? new Pool({
            connectionString: options.connectionString,
            max: 5,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000
        });
    }

    public async init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.migrate();
        }
        return this.initPromise;
    }

    private async migrate(): Promise<void> {
        if (this.options.autoMigrate === false) return;

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                CREATE TABLE IF NOT EXISTS "${this.nodesTable}" (
                    tenant_id text NOT NULL,
                    id text NOT NULL,
                    name text NOT NULL,
                    type text NOT NULL,
                    aliases jsonb DEFAULT '[]'::jsonb,
                    properties jsonb DEFAULT '{}'::jsonb,
                    source_doc_id text,
                    source_chunk_id text,
                    revision text,
                    confidence real NOT NULL DEFAULT 1.0,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (tenant_id, id)
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS "${this.edgesTable}" (
                    tenant_id text NOT NULL,
                    id text NOT NULL,
                    source_id text NOT NULL,
                    target_id text NOT NULL,
                    relation text NOT NULL,
                    category text NOT NULL DEFAULT 'extracted',
                    weight real NOT NULL DEFAULT 1.0,
                    confidence real NOT NULL DEFAULT 1.0,
                    properties jsonb DEFAULT '{}'::jsonb,
                    source_doc_id text,
                    source_chunk_id text,
                    revision text,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (tenant_id, id)
                );
            `);

            await client.query(`CREATE INDEX IF NOT EXISTS "${this.nodesTable}_name_idx" ON "${this.nodesTable}" (tenant_id, name);`);
            await client.query(`CREATE INDEX IF NOT EXISTS "${this.edgesTable}_src_idx" ON "${this.edgesTable}" (tenant_id, source_id);`);
            await client.query(`CREATE INDEX IF NOT EXISTS "${this.edgesTable}_tgt_idx" ON "${this.edgesTable}" (tenant_id, target_id);`);

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    public async addNodes(nodes: GraphNode[]): Promise<void> {
        if (nodes.length === 0) return;
        await this.init();

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const n of nodes) {
                await client.query(
                    `INSERT INTO "${this.nodesTable}" 
                        (tenant_id, id, name, type, aliases, properties, source_doc_id, source_chunk_id, revision, confidence)
                     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
                     ON CONFLICT (tenant_id, id) DO UPDATE SET
                        name = EXCLUDED.name,
                        type = EXCLUDED.type,
                        aliases = EXCLUDED.aliases,
                        properties = EXCLUDED.properties,
                        confidence = EXCLUDED.confidence;`,
                    [
                        n.tenantId,
                        n.id,
                        n.name,
                        n.type,
                        JSON.stringify(n.aliases || []),
                        JSON.stringify(n.properties || {}),
                        n.sourceDocId || null,
                        n.sourceChunkId || null,
                        n.revision ? String(n.revision) : null,
                        n.confidence
                    ]
                );
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    public async addEdges(edges: GraphEdge[]): Promise<void> {
        if (edges.length === 0) return;
        await this.init();

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            for (const e of edges) {
                await client.query(
                    `INSERT INTO "${this.edgesTable}" 
                        (tenant_id, id, source_id, target_id, relation, category, weight, confidence, properties, source_doc_id, source_chunk_id, revision)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
                     ON CONFLICT (tenant_id, id) DO UPDATE SET
                        relation = EXCLUDED.relation,
                        weight = EXCLUDED.weight,
                        confidence = EXCLUDED.confidence,
                        properties = EXCLUDED.properties;`,
                    [
                        e.tenantId,
                        e.id,
                        e.sourceId,
                        e.targetId,
                        e.relation,
                        e.category,
                        e.weight,
                        e.confidence,
                        JSON.stringify(e.properties || {}),
                        e.sourceDocId || null,
                        e.sourceChunkId || null,
                        e.revision ? String(e.revision) : null
                    ]
                );
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    public async getNode(id: string, tenantId: string): Promise<GraphNode | null> {
        await this.init();
        const res = await this.pool.query(
            `SELECT * FROM "${this.nodesTable}" WHERE tenant_id = $1 AND id = $2;`,
            [tenantId, id]
        );
        const r = res.rows[0];
        if (!r) return null;
        return this.mapNode(r);
    }

    /**
     * Recursive CTE graph traversal bounded by depth and tenant isolation.
     */
    public async getNeighbors(id: string, tenantId: string, options?: GraphTraversalOptions): Promise<Subgraph> {
        await this.init();
        const maxDepth = options?.maxDepth ?? 2;
        const maxNodes = options?.maxNodes ?? 50;

        const query = `
            WITH RECURSIVE graph_walk AS (
                -- Anchor member
                SELECT 
                    source_id, target_id, id as edge_id, relation, category, weight, confidence, 1 as depth
                FROM "${this.edgesTable}"
                WHERE tenant_id = $1 AND (source_id = $2 OR target_id = $2)

                UNION

                -- Recursive member
                SELECT 
                    e.source_id, e.target_id, e.id as edge_id, e.relation, e.category, e.weight, e.confidence, gw.depth + 1
                FROM "${this.edgesTable}" e
                JOIN graph_walk gw ON (e.source_id = gw.target_id OR e.target_id = gw.source_id OR e.source_id = gw.source_id)
                WHERE e.tenant_id = $1 AND gw.depth < $3
            )
            SELECT DISTINCT * FROM graph_walk LIMIT $4;
        `;

        const edgeRes = await this.pool.query(query, [tenantId, id, maxDepth, maxNodes * 2]);
        const nodeIds = new Set<string>([id]);
        const edges: GraphEdge[] = [];

        for (const row of edgeRes.rows) {
            nodeIds.add(row.source_id);
            nodeIds.add(row.target_id);
            edges.push({
                id: row.edge_id,
                tenantId,
                sourceId: row.source_id,
                targetId: row.target_id,
                relation: row.relation,
                category: row.category,
                weight: row.weight,
                confidence: row.confidence
            });
        }

        const nodeIdsArray = Array.from(nodeIds).slice(0, maxNodes);
        if (nodeIdsArray.length === 0) return { nodes: [], edges: [] };

        const nodesRes = await this.pool.query(
            `SELECT * FROM "${this.nodesTable}" WHERE tenant_id = $1 AND id = ANY($2::text[]);`,
            [tenantId, nodeIdsArray]
        );

        const nodes = nodesRes.rows.map(r => this.mapNode(r));
        return { nodes, edges };
    }

    public async searchNodes(query: string, tenantId: string, topK: number = 5, type?: string): Promise<GraphNode[]> {
        await this.init();
        let sql = `SELECT * FROM "${this.nodesTable}" WHERE tenant_id = $1 AND (name ILIKE $2 OR aliases::text ILIKE $2)`;
        const params: unknown[] = [tenantId, `%${query}%`];

        if (type) {
            sql += ` AND type = $3`;
            params.push(type);
        }

        sql += ` ORDER BY confidence DESC LIMIT $${params.length + 1};`;
        params.push(topK);

        const res = await this.pool.query(sql, params);
        return res.rows.map(r => this.mapNode(r));
    }

    public async findPaths(sourceId: string, targetId: string, tenantId: string, maxHops: number = 3): Promise<Subgraph[]> {
        // Recursive search for path between two nodes
        const sub = await this.getNeighbors(sourceId, tenantId, { maxDepth: maxHops });
        const hasTarget = sub.nodes.some(n => n.id === targetId);
        if (!hasTarget) return [];
        return [sub];
    }

    public async deleteByDocument(docId: string, tenantId: string): Promise<void> {
        await this.init();
        await this.pool.query(`DELETE FROM "${this.edgesTable}" WHERE tenant_id = $1 AND source_doc_id = $2;`, [tenantId, docId]);
        await this.pool.query(`DELETE FROM "${this.nodesTable}" WHERE tenant_id = $1 AND source_doc_id = $2;`, [tenantId, docId]);
    }

    public async clear(tenantId?: string): Promise<void> {
        await this.init();
        if (tenantId) {
            await this.pool.query(`DELETE FROM "${this.edgesTable}" WHERE tenant_id = $1;`, [tenantId]);
            await this.pool.query(`DELETE FROM "${this.nodesTable}" WHERE tenant_id = $1;`, [tenantId]);
        } else {
            await this.pool.query(`TRUNCATE TABLE "${this.edgesTable}", "${this.nodesTable}";`);
        }
    }

    public async close(): Promise<void> {
        await this.pool.end();
    }

    private mapNode(r: Record<string, unknown>): GraphNode {
        return {
            id: String(r['id']),
            tenantId: String(r['tenant_id']),
            name: String(r['name']),
            type: String(r['type']),
            aliases: Array.isArray(r['aliases']) ? (r['aliases'] as string[]) : [],
            properties: (r['properties'] as Record<string, unknown>) || {},
            sourceDocId: typeof r['source_doc_id'] === 'string' ? r['source_doc_id'] : undefined,
            sourceChunkId: typeof r['source_chunk_id'] === 'string' ? r['source_chunk_id'] : undefined,
            revision: typeof r['revision'] === 'string' || typeof r['revision'] === 'number' ? r['revision'] : undefined,
            confidence: Number(r['confidence'] ?? 1.0)
        };
    }
}

