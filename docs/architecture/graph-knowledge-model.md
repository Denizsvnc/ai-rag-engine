# Graph Knowledge Model & Storage

## 1. Schema Specifications

```typescript
export interface GraphNode {
    id: string;
    tenantId: string;
    name: string;
    type: string;
    aliases?: string[];
    properties?: Record<string, any>;
    embedding?: number[] | Float32Array;
    sourceDocId?: string;
    sourceChunkId?: string;
    revision?: number | string;
    confidence: number;
}

export type EdgeCategory = 'extracted' | 'asserted' | 'semantic';

export interface GraphEdge {
    id: string;
    tenantId: string;
    sourceId: string;
    targetId: string;
    relation: string;
    category: EdgeCategory;
    weight: number;
    confidence: number;
    properties?: Record<string, any>;
    sourceDocId?: string;
    sourceChunkId?: string;
    revision?: number | string;
}
```

## 2. Relational Postgres Storage (`PostgresGraphAdapter`)

Implemented via parameterized relational schema:
- `rag_graph_nodes` (id, tenant_id, name, type, aliases, properties, embedding, source_doc_id, confidence)
- `rag_graph_edges` (id, tenant_id, source_id, target_id, relation, category, weight, confidence, source_doc_id)

Multi-hop graph traversal is executed using PostgreSQL Recursive Common Table Expressions (`WITH RECURSIVE`):

```sql
WITH RECURSIVE graph_paths AS (
    SELECT source_id, target_id, ARRAY[source_id, target_id] AS path, 1 AS depth
    FROM rag_graph_edges
    WHERE tenant_id = $1 AND source_id = $2
    UNION ALL
    SELECT e.source_id, e.target_id, p.path || e.target_id, p.depth + 1
    FROM rag_graph_edges e
    JOIN graph_paths p ON e.source_id = p.target_id
    WHERE e.tenant_id = $1 AND NOT (e.target_id = ANY(p.path)) AND p.depth < $3
)
SELECT * FROM graph_paths;
```

## 3. In-Memory Graph Storage (`MemoryGraphAdapter`)

High-performance in-memory implementation for development, testing, and microservice deployments:
- Keyed map storage: `${tenantId}::${id}`
- Adjacency map: `${tenantId}::${nodeId}` -> `Set<edgeKey>`
- Subgraph BFS traversal bounded by `maxDepth` and `maxNodes`
- Complete multi-tenant isolation and document-level eviction via `deleteByDocument(docId, tenantId)`.

