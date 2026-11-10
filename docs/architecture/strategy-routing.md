# Adaptive Strategy Routing & Decision Matrix

## 1. Decision Matrix

The `AdaptiveQueryPlanner` extracts deterministic linguistic stems and structural patterns to route queries:

| Query Type | Linguistic Signals (TR / EN) | Selected Strategy | Rationale |
|---|---|---|---|
| **Action / Mutation** | `güncelle`, `oluştur`, `sil`, `çalıştır`, `update`, `create`, `execute`, `order` | `agentic_rag` | Query requires executing or evaluating governed tools. |
| **Policy / Compliance** | `şart`, `kural`, `uygun`, `hak kazan`, `çelişki`, `rule`, `compliance`, `eligible`, `policy logic` | `kag` | Query demands formal schema-guided rule deduction and constraint checking. |
| **Relational / Multi-Hop** | `ilişki`, `bağlantı`, `zincir`, `kiminle`, `hierarchy`, `connection between`, `network of` | `graph_rag` | Information spans multiple entities requiring graph-guided path discovery. |
| **Concept Exploration** | `kavram`, `tematik`, `benzer konular`, `kavram haritası`, `concept map`, `cluster` | `semantic_graph` | Thematic discovery across conceptual taxonomy. |
| **Exact Identifiers** | Order IDs (`TR123456`), SKUs, Part numbers (`ABC-12345`) | `hybrid_search` | Exact sparse keyword match + dense semantic embedding. |
| **Standard Factual** | General natural language questions | `hybrid_search` or `semantic_search` | Balanced semantic density and relevance. |

## 2. Execution Modes

- `auto`: Planner selects the highest-fidelity strategy automatically.
- `manual`: Restricts execution strictly to caller requested strategy (`context.metadata.requestedStrategy`).
- `auto-hybrid`: Spawns complementary strategies in parallel (e.g., `graph_rag` + `kag` + `hybrid_search`) up to `maxParallelOperations`.
- `fallback`: Sequentially executes strategies according to `config.fallbackChain` until sufficient evidence is collected.

