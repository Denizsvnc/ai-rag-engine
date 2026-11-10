/**
 * Graph node entity representing a conceptual topic, ontology term, or factual entity.
 */
export interface GraphNode {
    /** Unique identifier of the node. */
    id: string;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** Entity name or label. */
    name: string;
    /** Entity classification type (e.g. 'person', 'organization', 'policy', 'topic'). */
    type: string;
    /** Synonyms or alternate names for fuzzy matching. */
    aliases?: string[] | undefined;
    /** Arbitrary node properties and attributes. */
    properties?: Record<string, unknown> | undefined;
    /** Optional vector embedding for semantic graph clustering. */
    embedding?: number[] | Float32Array | undefined;
    /** ID of the source document from which this entity was extracted. */
    sourceDocId?: string | undefined;
    /** Source chunk ID. */
    sourceChunkId?: string | undefined;
    /** Document revision. */
    revision?: number | string | undefined;
    /** Extraction confidence score in range [0.0 - 1.0]. */
    confidence: number;
}

/** Operational category of a graph relationship edge. */
export type EdgeCategory = 'extracted' | 'asserted' | 'semantic';

/**
 * Directed relationship edge connecting two entities in a knowledge or semantic graph.
 */
export interface GraphEdge {
    /** Unique identifier of the edge. */
    id: string;
    /** Tenant identifier for multi-tenant isolation. */
    tenantId: string;
    /** Source entity node ID. */
    sourceId: string;
    /** Target entity node ID. */
    targetId: string;
    /** Semantic predicate relation (e.g. 'requires', 'part_of', 'complies_with', 'similar_to'). */
    relation: string;
    /** Category classifying how this edge was established. */
    category: EdgeCategory;
    /** Edge strength or proximity weight in range [0.0 - 1.0]. */
    weight: number;
    /** Confidence score in range [0.0 - 1.0]. */
    confidence: number;
    /** Arbitrary relationship properties. */
    properties?: Record<string, unknown> | undefined;
    /** Originating document ID. */
    sourceDocId?: string | undefined;
    /** Originating chunk ID. */
    sourceChunkId?: string | undefined;
    /** Document revision. */
    revision?: number | string | undefined;
}

/**
 * Options controlling multi-hop graph traversal.
 */
export interface GraphTraversalOptions {
    /** Maximum traversal depth / hop distance. Defaults to 2. */
    maxDepth?: number | undefined;
    /** Maximum number of neighboring nodes to collect. */
    maxNodes?: number | undefined;
    /** Filter traversal to specific relation types. */
    relationTypes?: string[] | undefined;
    /** Minimum confidence score required to traverse an edge. */
    minConfidence?: number | undefined;
    /** Restrict traversal to specific edge categories. */
    categories?: EdgeCategory[] | undefined;
}

/**
 * Connected subgraph consisting of nodes and relationship edges.
 */
export interface Subgraph {
    /** Connected entity nodes. */
    nodes: GraphNode[];
    /** Traversed relationship edges. */
    edges: GraphEdge[];
}

/**
 * Common contract for graph storage adapters (e.g. `MemoryGraphAdapter`, `PostgresGraphAdapter`).
 */
export interface IGraphAdapter {
    /** Initializes graph storage schema or indices. */
    init(): Promise<void>;
    /** Indexes entity nodes into the graph. */
    addNodes(nodes: GraphNode[]): Promise<void>;
    /** Indexes relationship edges into the graph. */
    addEdges(edges: GraphEdge[]): Promise<void>;
    /** Retrieves a single node by ID with tenant verification. */
    getNode(id: string, tenantId: string): Promise<GraphNode | null>;
    /** Traverses neighboring nodes and edges starting from a seed entity node. */
    getNeighbors(id: string, tenantId: string, options?: GraphTraversalOptions): Promise<Subgraph>;
    /** Searches for nodes matching query keywords or entity type. */
    searchNodes(query: string, tenantId: string, topK?: number, type?: string): Promise<GraphNode[]>;
    /** Finds traversal paths between two entity nodes up to `maxHops`. */
    findPaths(sourceId: string, targetId: string, tenantId: string, maxHops?: number): Promise<Subgraph[]>;
    /** Cascades deletion of all nodes and edges extracted from a specific document. */
    deleteByDocument(docId: string, tenantId: string): Promise<void>;
    /** Clears graph data, optionally scoped to a single tenant. */
    clear(tenantId?: string): Promise<void>;
    /** Closes active connections or resources. */
    close?(): Promise<void>;
}

