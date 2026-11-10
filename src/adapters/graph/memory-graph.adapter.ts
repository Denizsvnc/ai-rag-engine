import type { GraphNode, GraphEdge, GraphTraversalOptions, Subgraph } from '../../interfaces/graph.interface.js';
import type { IGraphStore, StorageCapabilities } from '../../interfaces/storage.interface.js';

/**
 * High-speed in-memory graph adapter for Knowledge Graph, Semantic Graph, and GraphRAG operations.
 *
 * @remarks
 * Features:
 * - Scopes all node IDs and edges with composite keys (`${tenantId}::${id}`) for multi-tenant isolation.
 * - Adjacency list indexing for Breadth-First Search (BFS) traversal with cycle detection.
 * - Subgraph extraction, pathfinding, and cascading deletion on document purge.
 *
 * @example
 * ```typescript
 * const graph = new MemoryGraphAdapter();
 * await graph.addNodes([{ id: 'node_1', tenantId: 't1', name: 'KVKK', type: 'compliance', confidence: 1.0 }]);
 * const neighbors = await graph.getNeighbors('node_1', 't1', { maxDepth: 2 });
 * ```
 */
export class MemoryGraphAdapter implements IGraphStore {
    public readonly capabilities: StorageCapabilities = {
        graphTraversal: true,
        namespaceIsolation: true,
        transactions: false,
        batchOperations: true
    };

    public hasCapability(capability: keyof StorageCapabilities): boolean {
        return Boolean(this.capabilities[capability]);
    }

    private nodes = new Map<string, GraphNode>(); // Key: `${tenantId}::${id}`
    private edges = new Map<string, GraphEdge>(); // Key: `${tenantId}::${id}`
    private adjacency = new Map<string, Set<string>>(); // Key: `${tenantId}::${nodeId}`, Value: Set of edgeIds

    public async init(): Promise<void> {
        // In-memory initialization is immediate
    }

    public async addNodes(nodes: GraphNode[]): Promise<void> {
        for (const node of nodes) {
            const key = `${node.tenantId}::${node.id}`;
            this.nodes.set(key, { ...node });
        }
    }

    public async addEdges(edges: GraphEdge[]): Promise<void> {
        for (const edge of edges) {
            const key = `${edge.tenantId}::${edge.id}`;
            this.edges.set(key, { ...edge });

            // Update adjacency index for fast traversal
            const srcKey = `${edge.tenantId}::${edge.sourceId}`;
            const tgtKey = `${edge.tenantId}::${edge.targetId}`;

            if (!this.adjacency.has(srcKey)) this.adjacency.set(srcKey, new Set());
            if (!this.adjacency.has(tgtKey)) this.adjacency.set(tgtKey, new Set());

            this.adjacency.get(srcKey)!.add(key);
            this.adjacency.get(tgtKey)!.add(key);
        }
    }

    public async getNode(id: string, tenantId: string): Promise<GraphNode | null> {
        const key = `${tenantId}::${id}`;
        return this.nodes.get(key) || null;
    }

    /**
     * Traverses graph from target node up to maxDepth hops, respecting tenant boundaries.
     */
    public async getNeighbors(id: string, tenantId: string, options?: GraphTraversalOptions): Promise<Subgraph> {
        const maxDepth = options?.maxDepth ?? 2;
        const maxNodes = options?.maxNodes ?? 50;
        const minConfidence = options?.minConfidence ?? 0.0;
        const relTypes = options?.relationTypes ? new Set(options.relationTypes) : null;
        const categories = options?.categories ? new Set(options.categories) : null;

        const visitedNodeIds = new Set<string>();
        const visitedEdgeIds = new Set<string>();
        const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: id, depth: 0 }];

        const resultNodes: GraphNode[] = [];
        const resultEdges: GraphEdge[] = [];

        const startNode = await this.getNode(id, tenantId);
        if (startNode) {
            visitedNodeIds.add(id);
            resultNodes.push(startNode);
        }

        while (queue.length > 0 && resultNodes.length < maxNodes) {
            const current = queue.shift()!;
            if (current.depth >= maxDepth) continue;

            const adjKey = `${tenantId}::${current.nodeId}`;
            const edgeKeys = this.adjacency.get(adjKey) || new Set();

            for (const edgeKey of edgeKeys) {
                const edge = this.edges.get(edgeKey);
                if (!edge || edge.tenantId !== tenantId) continue;
                if (edge.confidence < minConfidence) continue;
                if (relTypes && !relTypes.has(edge.relation)) continue;
                if (categories && !categories.has(edge.category)) continue;

                if (!visitedEdgeIds.has(edge.id)) {
                    visitedEdgeIds.add(edge.id);
                    resultEdges.push(edge);
                }

                const neighborId = edge.sourceId === current.nodeId ? edge.targetId : edge.sourceId;
                if (!visitedNodeIds.has(neighborId)) {
                    visitedNodeIds.add(neighborId);
                    const neighborNode = await this.getNode(neighborId, tenantId);
                    if (neighborNode) {
                        resultNodes.push(neighborNode);
                        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
                    }
                }
            }
        }

        return { nodes: resultNodes, edges: resultEdges };
    }

    /**
     * Lexical and alias search across graph nodes for a specific tenant.
     */
    public async searchNodes(query: string, tenantId: string, topK: number = 5, type?: string): Promise<GraphNode[]> {
        const lowerQ = query.toLowerCase();
        const matches: Array<{ node: GraphNode; score: number }> = [];

        for (const node of this.nodes.values()) {
            if (node.tenantId !== tenantId) continue;
            if (type && node.type !== type) continue;

            let score = 0;
            const lowerName = node.name.toLowerCase();

            if (lowerName === lowerQ) score = 1.0;
            else if (lowerName.includes(lowerQ) || lowerQ.includes(lowerName)) score = 0.8;
            else if (node.aliases?.some(a => a.toLowerCase().includes(lowerQ))) score = 0.7;

            if (score > 0) {
                matches.push({ node, score });
            }
        }

        matches.sort((a, b) => b.score - a.score);
        return matches.slice(0, topK).map(m => m.node);
    }

    /**
     * Finds paths between two nodes using breadth-first search up to maxHops.
     */
    public async findPaths(sourceId: string, targetId: string, tenantId: string, maxHops: number = 3): Promise<Subgraph[]> {
        const queue: Array<{ currentId: string; pathNodes: GraphNode[]; pathEdges: GraphEdge[] }> = [];
        const startNode = await this.getNode(sourceId, tenantId);
        if (!startNode) return [];

        queue.push({ currentId: sourceId, pathNodes: [startNode], pathEdges: [] });
        const discoveredPaths: Subgraph[] = [];

        while (queue.length > 0 && discoveredPaths.length < 5) {
            const { currentId, pathNodes, pathEdges } = queue.shift()!;

            if (currentId === targetId && pathEdges.length > 0) {
                discoveredPaths.push({ nodes: pathNodes, edges: pathEdges });
                continue;
            }

            if (pathEdges.length >= maxHops) continue;

            const adjKey = `${tenantId}::${currentId}`;
            const edgeKeys = this.adjacency.get(adjKey) || new Set();

            for (const edgeKey of edgeKeys) {
                const edge = this.edges.get(edgeKey);
                if (!edge || edge.tenantId !== tenantId) continue;

                const nextId = edge.sourceId === currentId ? edge.targetId : edge.sourceId;
                if (pathNodes.some(n => n.id === nextId)) continue; // avoid cycles

                const nextNode = await this.getNode(nextId, tenantId);
                if (nextNode) {
                    queue.push({
                        currentId: nextId,
                        pathNodes: [...pathNodes, nextNode],
                        pathEdges: [...pathEdges, edge]
                    });
                }
            }
        }

        return discoveredPaths;
    }

    public async deleteByDocument(docId: string, tenantId: string): Promise<void> {
        // Collect edge IDs to delete
        const edgesToDelete = new Set<string>();
        for (const edge of this.edges.values()) {
            if (edge.tenantId === tenantId && edge.sourceDocId === docId) {
                edgesToDelete.add(edge.id);
            }
        }
        for (const edgeId of edgesToDelete) {
            this.edges.delete(`${tenantId}::${edgeId}`);
        }

        // Collect node IDs to delete
        const nodesToDelete = new Set<string>();
        for (const node of this.nodes.values()) {
            if (node.tenantId === tenantId && node.sourceDocId === docId) {
                nodesToDelete.add(node.id);
            }
        }
        for (const nodeId of nodesToDelete) {
            this.nodes.delete(`${tenantId}::${nodeId}`);
            this.adjacency.delete(`${tenantId}::${nodeId}`);
        }
    }

    public async clear(tenantId?: string): Promise<void> {
        if (!tenantId) {
            this.nodes.clear();
            this.edges.clear();
            this.adjacency.clear();
        } else {
            for (const [k, node] of this.nodes.entries()) {
                if (node.tenantId === tenantId) this.nodes.delete(k);
            }
            for (const [k, edge] of this.edges.entries()) {
                if (edge.tenantId === tenantId) this.edges.delete(k);
            }
            for (const [k] of this.adjacency.entries()) {
                if (k.startsWith(`${tenantId}::`)) this.adjacency.delete(k);
            }
        }
    }
}

