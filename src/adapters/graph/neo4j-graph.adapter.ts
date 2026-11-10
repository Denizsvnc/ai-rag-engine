import type { GraphNode, GraphEdge, GraphTraversalOptions, Subgraph } from '../../interfaces/graph.interface.js';
import type { IGraphStore, StorageCapabilities } from '../../interfaces/storage.interface.js';

export interface Neo4jGraphOptions {
    /** Neo4j Bolt/Neo4j URI (e.g. 'bolt://localhost:7687' or 'neo4j+s://...'). */
    url?: string | undefined;
    /** Authentication username. Defaults to 'neo4j'. */
    username?: string | undefined;
    /** Authentication password. */
    password?: string | undefined;
    /** Database name. Defaults to 'neo4j'. */
    database?: string | undefined;
    /** Existing neo4j driver instance. */
    driver?: any | undefined;
}

/**
 * Enterprise Neo4j property graph adapter with lazy-loaded driver isolation.
 *
 * @remarks
 * Driver Isolation:
 * Does not force `neo4j-driver` into the core SDK dependency tree.
 * Dynamically imports `neo4j-driver` when initialized.
 *
 * Multi-Tenancy:
 * All Cypher queries strictly filter nodes and relationships by `{ tenantId: $tenantId }`.
 *
 * @example
 * ```typescript
 * import { Neo4jGraphAdapter } from '@denizsvnc/ai-rag-engine';
 *
 * const graphStore = new Neo4jGraphAdapter({
 *   url: 'bolt://localhost:7687',
 *   username: 'neo4j',
 *   password: 'secret_password'
 * });
 * await graphStore.init();
 * ```
 */
export class Neo4jGraphAdapter implements IGraphStore {
    public readonly capabilities: StorageCapabilities = {
        graphTraversal: true,
        namespaceIsolation: true,
        transactions: true,
        batchOperations: true,
        nativeIndexes: true
    };

    private driver: any;
    private readonly database: string;
    private isInitialized = false;

    constructor(private readonly options: Neo4jGraphOptions) {
        if (!options.driver && !options.url) {
            throw new Error('[Neo4jGraphAdapter] Either url or driver instance must be provided.');
        }
        this.database = options.database ?? 'neo4j';
        if (options.driver) {
            this.driver = options.driver;
        }
    }

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    public async init(): Promise<void> {
        if (this.isInitialized) return;

        if (!this.driver && this.options.url) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const neoPkg: any = await import('neo4j-driver' as string);
                const neo4j = neoPkg.default ?? neoPkg;
                const auth = this.options.username && this.options.password
                    ? neo4j.auth.basic(this.options.username, this.options.password)
                    : undefined;
                this.driver = neo4j.driver(this.options.url, auth);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('Cannot find package') || msg.includes('ERR_MODULE_NOT_FOUND')) {
                    throw new Error(
                        '[Neo4jGraphAdapter] Optional dependency "neo4j-driver" is not installed. Run: npm install neo4j-driver'
                    );
                }
                throw err;
            }
        }

        // Create uniqueness constraint and index for multi-tenant isolation
        const session = this.driver.session({ database: this.database });
        try {
            await session.run(`
                CREATE CONSTRAINT IF NOT EXISTS FOR (n:Entity)
                REQUIRE (n.tenantId, n.id) IS UNIQUE
            `);
            await session.run(`
                CREATE INDEX IF NOT EXISTS FOR (n:Entity)
                ON (n.tenantId, n.name)
            `);
        } catch {}
        finally {
            await session.close();
        }

        this.isInitialized = true;
    }

    public async close(): Promise<void> {
        if (this.driver && typeof this.driver.close === 'function') {
            await this.driver.close();
            this.isInitialized = false;
        }
    }

    private getSession(): any {
        if (!this.isInitialized || !this.driver) {
            throw new Error('[Neo4jGraphAdapter] Store not initialized. Call init() first.');
        }
        return this.driver.session({ database: this.database });
    }

    public async addNodes(nodes: GraphNode[]): Promise<void> {
        if (!nodes.length) return;
        const session = this.getSession();
        try {
            const query = `
                UNWIND $batch AS item
                MERGE (n:Entity { tenantId: item.tenantId, id: item.id })
                SET n.name = item.name,
                    n.type = item.type,
                    n.aliases = item.aliases,
                    n.properties = item.properties,
                    n.sourceDocId = item.sourceDocId,
                    n.sourceChunkId = item.sourceChunkId,
                    n.revision = item.revision,
                    n.confidence = item.confidence
            `;
            const batch = nodes.map(n => ({
                id: n.id,
                tenantId: n.tenantId,
                name: n.name,
                type: n.type,
                aliases: JSON.stringify(n.aliases ?? []),
                properties: JSON.stringify(n.properties ?? {}),
                sourceDocId: n.sourceDocId ?? '',
                sourceChunkId: n.sourceChunkId ?? '',
                revision: n.revision ? String(n.revision) : '',
                confidence: n.confidence ?? 1.0
            }));
            await session.run(query, { batch });
        } finally {
            await session.close();
        }
    }

    public async addEdges(edges: GraphEdge[]): Promise<void> {
        if (!edges.length) return;
        const session = this.getSession();
        try {
            const query = `
                UNWIND $batch AS item
                MATCH (source:Entity { tenantId: item.tenantId, id: item.sourceId })
                MATCH (target:Entity { tenantId: item.tenantId, id: item.targetId })
                MERGE (source)-[r:RELATION { tenantId: item.tenantId, id: item.id }]->(target)
                SET r.relation = item.relation,
                    r.category = item.category,
                    r.weight = item.weight,
                    r.confidence = item.confidence,
                    r.sourceDocId = item.sourceDocId,
                    r.sourceChunkId = item.sourceChunkId,
                    r.properties = item.properties
            `;
            const batch = edges.map(e => ({
                id: e.id,
                tenantId: e.tenantId,
                sourceId: e.sourceId,
                targetId: e.targetId,
                relation: e.relation,
                category: e.category ?? 'extracted',
                weight: e.weight ?? 1.0,
                confidence: e.confidence ?? 1.0,
                sourceDocId: e.sourceDocId ?? '',
                sourceChunkId: e.sourceChunkId ?? '',
                properties: JSON.stringify(e.properties ?? {})
            }));
            await session.run(query, { batch });
        } finally {
            await session.close();
        }
    }

    public async getNode(id: string, tenantId: string): Promise<GraphNode | null> {
        const session = this.getSession();
        try {
            const res = await session.run(
                `MATCH (n:Entity { tenantId: $tenantId, id: $id }) RETURN n LIMIT 1`,
                { tenantId, id }
            );
            if (!res.records.length) return null;
            const p = res.records[0]!.get('n').properties;
            let props = {};
            let aliases = [];
            try { props = JSON.parse(p.properties); } catch {}
            try { aliases = JSON.parse(p.aliases); } catch {}
            return {
                id: p.id,
                tenantId: p.tenantId,
                name: p.name,
                type: p.type,
                aliases,
                properties: props,
                sourceDocId: p.sourceDocId,
                sourceChunkId: p.sourceChunkId,
                confidence: p.confidence ?? 1.0
            };
        } finally {
            await session.close();
        }
    }

    public async getNeighbors(
        id: string,
        tenantId: string,
        options: GraphTraversalOptions = {}
    ): Promise<Subgraph> {
        const session = this.getSession();
        const maxDepth = Math.min(options.maxDepth ?? 1, 5);
        const maxNodes = options.maxNodes ?? 50;
        try {
            const cypher = `
                MATCH (start:Entity { tenantId: $tenantId, id: $id })
                MATCH (start)-[r:RELATION*1..${maxDepth}]-(neighbor:Entity { tenantId: $tenantId })
                WITH neighbor, last(r) AS edge
                RETURN neighbor, edge
                LIMIT $maxNodes
            `;
            const res = await session.run(cypher, {
                tenantId,
                id,
                maxNodes
            });

            const nodesMap = new Map<string, GraphNode>();
            const edgesMap = new Map<string, GraphEdge>();

            for (const rec of res.records) {
                const n = rec.get('neighbor').properties;
                const e = rec.get('edge').properties;
                let nProps = {};
                let eProps = {};
                try { nProps = JSON.parse(n.properties); } catch {}
                try { eProps = JSON.parse(e.properties); } catch {}

                nodesMap.set(n.id, {
                    id: n.id,
                    tenantId: n.tenantId,
                    name: n.name,
                    type: n.type,
                    properties: nProps,
                    sourceDocId: n.sourceDocId,
                    confidence: n.confidence ?? 1.0
                });

                edgesMap.set(e.id, {
                    id: e.id,
                    tenantId: e.tenantId,
                    sourceId: e.sourceId,
                    targetId: e.targetId,
                    relation: e.relation ?? 'relates_to',
                    category: e.category ?? 'extracted',
                    weight: e.weight ?? 1.0,
                    confidence: e.confidence ?? 1.0,
                    properties: eProps
                });
            }

            return {
                nodes: Array.from(nodesMap.values()),
                edges: Array.from(edgesMap.values())
            };
        } finally {
            await session.close();
        }
    }

    public async searchNodes(
        query: string,
        tenantId: string,
        topK: number = 10,
        type?: string
    ): Promise<GraphNode[]> {
        const session = this.getSession();
        try {
            let cypher = `MATCH (n:Entity { tenantId: $tenantId }) WHERE n.name CONTAINS $query`;
            const params: Record<string, unknown> = { tenantId, query, topK };
            if (type) {
                cypher += ` AND n.type = $type`;
                params.type = type;
            }
            cypher += ` RETURN n LIMIT $topK`;
            const res = await session.run(cypher, params);

            return res.records.map((rec: any) => {
                const p = rec.get('n').properties;
                let props = {};
                try { props = JSON.parse(p.properties); } catch {}
                return {
                    id: p.id,
                    tenantId: p.tenantId,
                    name: p.name,
                    type: p.type,
                    properties: props,
                    sourceDocId: p.sourceDocId,
                    confidence: p.confidence ?? 1.0
                };
            });
        } finally {
            await session.close();
        }
    }

    public async findPaths(
        sourceId: string,
        targetId: string,
        tenantId: string,
        maxHops: number = 3
    ): Promise<Subgraph[]> {
        const session = this.getSession();
        const safeHops = Math.min(maxHops, 5);
        try {
            const cypher = `
                MATCH (start:Entity { tenantId: $tenantId, id: $sourceId }),
                      (end:Entity { tenantId: $tenantId, id: $targetId })
                MATCH p = shortestPath((start)-[:RELATION*..${safeHops}]-(end))
                WHERE all(r in relationships(p) WHERE r.tenantId = $tenantId)
                RETURN [n in nodes(p) | n] AS nodesList, [r in relationships(p) | r] AS edgesList
                LIMIT 5
            `;
            const res = await session.run(cypher, {
                tenantId,
                sourceId,
                targetId
            });

            return res.records.map((rec: any) => {
                const rawNodes = rec.get('nodesList');
                const rawEdges = rec.get('edgesList');

                const nodes: GraphNode[] = rawNodes.map((n: any) => ({
                    id: n.properties.id,
                    tenantId: n.properties.tenantId,
                    name: n.properties.name,
                    type: n.properties.type,
                    confidence: n.properties.confidence ?? 1.0
                }));
                const edges: GraphEdge[] = rawEdges.map((e: any) => ({
                    id: e.properties.id,
                    tenantId: e.properties.tenantId,
                    sourceId: e.properties.sourceId,
                    targetId: e.properties.targetId,
                    relation: e.properties.relation ?? 'relates_to',
                    category: e.properties.category ?? 'extracted',
                    weight: e.properties.weight ?? 1.0,
                    confidence: e.properties.confidence ?? 1.0
                }));
                return { nodes, edges };
            });
        } finally {
            await session.close();
        }
    }

    public async deleteByDocument(docId: string, tenantId: string): Promise<void> {
        const session = this.getSession();
        try {
            await session.run(`
                MATCH (n:Entity { tenantId: $tenantId, sourceDocId: $docId })
                DETACH DELETE n
            `, { tenantId, docId });
        } finally {
            await session.close();
        }
    }

    public async clear(tenantId?: string): Promise<void> {
        const session = this.getSession();
        try {
            if (tenantId) {
                await session.run(`
                    MATCH (n:Entity { tenantId: $tenantId })
                    DETACH DELETE n
                `, { tenantId });
            } else {
                await session.run(`
                    MATCH (n:Entity)
                    DETACH DELETE n
                `);
            }
        } finally {
            await session.close();
        }
    }
}
