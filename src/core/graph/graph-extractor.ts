import type { GraphNode, GraphEdge } from '../../interfaces/graph.interface.js';

/**
 * Configuration options for entity and relation extraction from text.
 */
export interface GraphExtractionOptions {
    /** Maximum number of unique entity nodes to extract per text chunk. @defaultValue 20 */
    maxEntitiesPerChunk?: number | undefined;
    /** Maximum number of relation edges to extract per text chunk. @defaultValue 30 */
    maxEdgesPerChunk?: number | undefined;
    /** Minimum confidence threshold for extracted entities. @defaultValue 0.8 */
    minConfidence?: number | undefined;
}

/**
 * Deterministic multilingual extractor identifying entities and semantic relations from raw text.
 *
 * @remarks
 * Extracts entities using capitalized noun-phrase patterns and detects semantic edges
 * (APPLIES_TO, DEPENDS_ON, CONTAINS, PART_OF, etc.) using bilingual linguistic rules.
 *
 * @example
 * ```typescript
 * import { GraphExtractor } from '@denizsvnc/ai-rag-engine';
 *
 * const { nodes, edges } = GraphExtractor.extract(
 *   'Acme Corp contains European Division. Security Policy applies to Acme Corp.',
 *   { tenantId: 'tenant_1', docId: 'doc_123', chunkId: 'c1' }
 * );
 * ```
 */
export class GraphExtractor {
    // Common relation regex patterns in Turkish and English
    private static readonly RELATION_PATTERNS = [
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(için|for)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(geçerlidir|applies|is valid)/i, relation: 'APPLIES_TO' },
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(süresi|duration of)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})/i, relation: 'HAS_DURATION' },
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(tarafından|by)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(yönetilir|managed by)/i, relation: 'MANAGED_BY' },
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(içerir|kapsar|contains|includes|consists of)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})/i, relation: 'CONTAINS' },
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(bağlıdır|depends on|relies on)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})/i, relation: 'DEPENDS_ON' },
        { regex: /([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})\s+(üyesidir|is part of|belongs to)\s+([A-ZÇĞİÖŞÜa-zçğıöşü0-9_\s]{2,30})/i, relation: 'PART_OF' }
    ];

    /**
     * Extracts structured nodes and edges from text chunk with bounded limits.
     *
     * @param text - Raw text chunk to extract knowledge triples from.
     * @param context - Ingestion context containing tenantId, docId, chunkId, and revision.
     * @param options - Extraction bounds such as max entities or edges.
     * @returns Object containing arrays of extracted {@link GraphNode} and {@link GraphEdge}.
     */
    public static extract(
        text: string,
        context: {
            tenantId: string;
            docId: string;
            chunkId?: string | undefined;
            revision?: number | string | undefined;
        },
        options?: GraphExtractionOptions
    ): { nodes: GraphNode[]; edges: GraphEdge[] } {
        const maxNodes = options?.maxEntitiesPerChunk ?? 20;
        const maxEdges = options?.maxEdgesPerChunk ?? 30;

        const nodesMap = new Map<string, GraphNode>();
        const edges: GraphEdge[] = [];

        // 1. Entity Extraction via Capitalized Noun Phrases & Known Technical Terms
        const entityMatches = text.match(/\b([A-ZÇĞİÖŞÜ][a-zçğıöşü0-9]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü0-9]+)*)\b/gu) || [];
        for (const rawName of entityMatches) {
            const name = rawName.trim();
            if (name.length < 3 || name.length > 50) continue;
            if (nodesMap.size >= maxNodes) break;

            const id = this.slugify(name);
            if (!nodesMap.has(id)) {
                nodesMap.set(id, {
                    id,
                    tenantId: context.tenantId,
                    name,
                    type: this.inferType(name),
                    sourceDocId: context.docId,
                    sourceChunkId: context.chunkId,
                    revision: context.revision,
                    confidence: 0.85
                });
            }
        }

        // 2. Relation Extraction via Regex Patterns
        for (const pattern of this.RELATION_PATTERNS) {
            if (edges.length >= maxEdges) break;
            const match = pattern.regex.exec(text);
            if (match && match[1] && match[3]) {
                const srcName = match[1].trim();
                const tgtName = match[3].trim();
                if (srcName.length >= 3 && tgtName.length >= 3 && srcName !== tgtName) {
                    const srcId = this.slugify(srcName);
                    const tgtId = this.slugify(tgtName);

                    // Ensure endpoint nodes exist
                    if (!nodesMap.has(srcId) && nodesMap.size < maxNodes) {
                        nodesMap.set(srcId, {
                            id: srcId,
                            tenantId: context.tenantId,
                            name: srcName,
                            type: this.inferType(srcName),
                            sourceDocId: context.docId,
                            sourceChunkId: context.chunkId,
                            revision: context.revision,
                            confidence: 0.80
                        });
                    }
                    if (!nodesMap.has(tgtId) && nodesMap.size < maxNodes) {
                        nodesMap.set(tgtId, {
                            id: tgtId,
                            tenantId: context.tenantId,
                            name: tgtName,
                            type: this.inferType(tgtName),
                            sourceDocId: context.docId,
                            sourceChunkId: context.chunkId,
                            revision: context.revision,
                            confidence: 0.80
                        });
                    }

                    if (nodesMap.has(srcId) && nodesMap.has(tgtId)) {
                        edges.push({
                            id: `edge_${srcId}_${pattern.relation.toLowerCase()}_${tgtId}`,
                            tenantId: context.tenantId,
                            sourceId: srcId,
                            targetId: tgtId,
                            relation: pattern.relation,
                            category: 'extracted',
                            weight: 1.0,
                            confidence: 0.80,
                            sourceDocId: context.docId,
                            sourceChunkId: context.chunkId,
                            revision: context.revision
                        });
                    }
                }
            }
        }

        return {
            nodes: Array.from(nodesMap.values()),
            edges
        };
    }

    private static inferType(name: string): string {
        const lower = name.toLowerCase();
        if (lower.includes('corp') || lower.includes('a.ş') || lower.includes('inc') || lower.includes('ltd')) return 'ORGANIZATION';
        if (lower.includes('policy') || lower.includes('politika') || lower.includes('kural') || lower.includes('sla')) return 'POLICY';
        if (lower.includes('cihaz') || lower.includes('laptop') || lower.includes('telefon') || lower.includes('server')) return 'PRODUCT';
        if (lower.includes('tarih') || lower.includes('gün') || lower.includes('ay') || lower.includes('yıl')) return 'TEMPORAL';
        return 'CONCEPT';
    }

    private static slugify(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40);
    }
}

