# Adaptive Routing & Linguistic Signal Evaluation

## Test Query Corpus & Routing Outcomes

| Query | Stems Detected | Mode | Planned Strategy | Verified |
|---|---|---|---|---|
| "Sipariş no TR1234567 nerede?" | `TR\d+` (Exact Identifier) | auto | `hybrid_search` | PASS |
| "Ali ile Veli arasındaki bağlantı ve hiyerarşi nedir?" | `bağlantı`, `hiyerarşi` (Relational) | auto | `graph_rag` | PASS |
| "Bu çalışan yıllık izin şart ve kurallarına uygun mu?" | `şart`, `kural`, `uygun` (Compliance) | auto | `kag` | PASS |
| "Lütfen stok miktarını 50 olarak güncelle" | `güncelle` (Action) | auto | `agentic_rag` | PASS |
| "Yapay zeka etiği hakkında kavram haritası" | `kavram haritası` (Concept) | auto | `semantic_graph` | PASS |
| "Does this transaction violate compliance rule and policy logic?" | `compliance`, `rule`, `policy logic` | auto | `kag` | PASS |
| "Genel soru sormak istiyorum" | None (General) | auto | `hybrid_search` | PASS |

- Overall Routing Precision: 100% on test corpus.
- Recall on Turkish morphology: Verified with suffix-insensitive root stems.

