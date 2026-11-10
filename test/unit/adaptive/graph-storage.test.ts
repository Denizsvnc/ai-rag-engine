import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryGraphAdapter } from '../../../src/adapters/graph/memory-graph.adapter.js';

describe('MemoryGraphAdapter Multi-Tenant Isolation & Graph Traversal', () => {
    it('creates nodes and edges with multi-tenant scoping', async () => {
        const graph = new MemoryGraphAdapter();

        await graph.addNodes([
            {
                id: 'node_1',
                tenantId: 'tenant-A',
                name: 'Entity 1',
                type: 'entity',
                confidence: 1.0,
                sourceDocId: 'doc_1'
            },
            {
                id: 'node_2',
                tenantId: 'tenant-A',
                name: 'Entity 2',
                type: 'entity',
                confidence: 1.0,
                sourceDocId: 'doc_1'
            }
        ]);

        await graph.addEdges([
            {
                id: 'edge_1',
                tenantId: 'tenant-A',
                sourceId: 'node_1',
                targetId: 'node_2',
                relation: 'CONNECTS_TO',
                category: 'extracted',
                weight: 0.9,
                confidence: 0.95,
                sourceDocId: 'doc_1'
            }
        ]);

        const node = await graph.getNode('node_1', 'tenant-A');
        assert.ok(node);
        assert.strictEqual(node.name, 'Entity 1');

        const neighbors = await graph.getNeighbors('node_1', 'tenant-A');
        assert.strictEqual(neighbors.nodes.length, 2);
        assert.ok(neighbors.nodes.some(n => n.id === 'node_1'));
        assert.ok(neighbors.nodes.some(n => n.id === 'node_2'));
        assert.strictEqual(neighbors.edges.length, 1);
    });

    it('enforces absolute multi-tenant boundary: tenant-B cannot see tenant-A graph', async () => {
        const graph = new MemoryGraphAdapter();

        await graph.addNodes([
            {
                id: 'secret_node',
                tenantId: 'tenant-A',
                name: 'Confidential Strategy',
                type: 'concept',
                confidence: 1.0
            }
        ]);

        // Tenant-B attempts to fetch secret_node
        const leaked = await graph.getNode('secret_node', 'tenant-B');
        assert.strictEqual(leaked, null);

        // Tenant-B attempts neighbor discovery on tenant-A node
        const neighbors = await graph.getNeighbors('secret_node', 'tenant-B');
        assert.strictEqual(neighbors.nodes.length, 0);
        assert.strictEqual(neighbors.edges.length, 0);

        // Tenant-B attempts path finding on tenant-A node
        const paths = await graph.findPaths('secret_node', 'other_node', 'tenant-B');
        assert.strictEqual(paths.length, 0);
    });

    it('traverses multi-hop paths correctly up to maxHops', async () => {
        const graph = new MemoryGraphAdapter();
        const tenantId = 'tenant-test';

        // Chain: A -> B -> C -> D
        await graph.addNodes([
            { id: 'A', tenantId, name: 'A', type: 'entity', confidence: 1.0 },
            { id: 'B', tenantId, name: 'B', type: 'entity', confidence: 1.0 },
            { id: 'C', tenantId, name: 'C', type: 'entity', confidence: 1.0 },
            { id: 'D', tenantId, name: 'D', type: 'entity', confidence: 1.0 }
        ]);

        await graph.addEdges([
            { id: 'e1', tenantId, sourceId: 'A', targetId: 'B', relation: 'LEADS_TO', category: 'extracted', weight: 1.0, confidence: 1.0 },
            { id: 'e2', tenantId, sourceId: 'B', targetId: 'C', relation: 'LEADS_TO', category: 'extracted', weight: 1.0, confidence: 1.0 },
            { id: 'e3', tenantId, sourceId: 'C', targetId: 'D', relation: 'LEADS_TO', category: 'extracted', weight: 1.0, confidence: 1.0 }
        ]);

        // Path from A to C (2 hops)
        const paths2 = await graph.findPaths('A', 'C', tenantId, 2);
        assert.strictEqual(paths2.length, 1);
        assert.strictEqual(paths2[0].nodes.length, 3);
        assert.deepStrictEqual(paths2[0].nodes.map(n => n.id), ['A', 'B', 'C']);

        // Path from A to D with maxHops: 2 should return empty (needs 3 hops)
        const pathsTooShort = await graph.findPaths('A', 'D', tenantId, 2);
        assert.strictEqual(pathsTooShort.length, 0);

        // Path from A to D with maxHops: 3 should find it
        const paths3 = await graph.findPaths('A', 'D', tenantId, 3);
        assert.strictEqual(paths3.length, 1);
        assert.deepStrictEqual(paths3[0].nodes.map(n => n.id), ['A', 'B', 'C', 'D']);
    });

    it('deletes document nodes and edges cleanly without affecting other docs or tenants', async () => {
        const graph = new MemoryGraphAdapter();

        await graph.addNodes([
            { id: 'n1', tenantId: 'tenant-1', name: 'N1', type: 'entity', confidence: 1.0, sourceDocId: 'doc_to_delete' },
            { id: 'n2', tenantId: 'tenant-1', name: 'N2', type: 'entity', confidence: 1.0, sourceDocId: 'doc_to_keep' }
        ]);
        await graph.addEdges([
            { id: 'e1', tenantId: 'tenant-1', sourceId: 'n1', targetId: 'n2', relation: 'LINK', category: 'extracted', weight: 1.0, confidence: 1.0, sourceDocId: 'doc_to_delete' }
        ]);

        await graph.deleteByDocument('doc_to_delete', 'tenant-1');

        const deletedNode = await graph.getNode('n1', 'tenant-1');
        assert.strictEqual(deletedNode, null);

        const keptNode = await graph.getNode('n2', 'tenant-1');
        assert.ok(keptNode);

        const neighbors = await graph.getNeighbors('n2', 'tenant-1');
        assert.strictEqual(neighbors.edges.length, 0);
    });
});
