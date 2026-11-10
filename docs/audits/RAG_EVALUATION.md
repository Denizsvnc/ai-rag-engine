# RAG Quality & Retrieval Evaluation Report — AI-RAG-ENGINE

**Document Version:** 2.0.0  
**Audit Date:** 2026-11-10  
**Target Package:** `@denizsvnc/ai-rag-engine`  
**Evaluation Harnesses:** `src/core/metrics/rag-evaluator.ts`, `test/unit/logical/rag-dataset-evaluation.test.ts`  

---

## 1. Executive Summary

Evaluation in enterprise RAG systems requires both quantitative information retrieval (IR) precision and deterministic verification of factual grounding. AI-RAG-ENGINE incorporates a native evaluation suite (`RAGEvaluator`) and an independently audited bilingual enterprise gold dataset (`test/unit/logical/rag-dataset-evaluation.test.ts`).

---

## 2. Retrieval Evaluation Metrics & Formulations

### 2.1 Precision@K and Recall@K
For a query $q$ with ground-truth relevant document IDs $G_q$ and top-$K$ retrieved document IDs $R_q$:

$$\text{Precision@}K = \frac{|R_q \cap G_q|}{|R_q|}, \quad \text{Recall@}K = \frac{|R_q \cap G_q|}{|G_q|}$$

*Hardening:* Duplicate document IDs returned in $R_q$ are deduplicated prior to computing intersections, preventing synthetic precision inflation.

### 2.2 Mean Reciprocal Rank (MRR)
For a query set $Q$:
$$\text{MRR} = \frac{1}{|Q|} \sum_{i=1}^{|Q|} \frac{1}{\text{rank}_i}$$
Where $\text{rank}_i$ is the 1-based position of the first relevant document in the retrieved result list.

---

## 3. Answer Generation & Grounding Quality Metrics

### 3.1 Faithfulness (Groundedness)
- Validates whether every claim in the generated answer is directly substantiated by the retrieved context.
- **Empty Answer Rule:** If the generated answer is empty or whitespace, faithfulness evaluates to `0.0`.

### 3.2 Numerical Contradiction Detection
Extracts numerical literals (e.g. `14`, `24`, `99.99%`, `180`) from the generated answer and asserts their presence in the context. Any hallucinated quantity triggers an explicit contradiction flag.

### 3.3 Negation & Polarity Mismatch Detection
Tracks polarity tokens across Turkish and English:
- **Turkish Negation Tokens:** `değil`, `yok`, `asla`, `olamaz`, `yasaktır`, `bulunmamaktadır`, `hayır`.
- **English Negation Tokens:** `not`, `never`, `cannot`, `neither`, `no`, `prohibited`.
Flags a polarity warning when an affirmative context is answered negatively (e.g., claiming a warranty excludes what is explicitly covered).

---

## 4. Bilingual Labeled Benchmark Dataset Results

Evaluated in `test/unit/logical/rag-dataset-evaluation.test.ts` across bilingual enterprise knowledge documents (Return policy, Hardware warranty, Payment gateways, Cloud SLA, Data retention):

| Evaluation Dimension | Metric | Observed Score | Production Target | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Retrieval Precision** | Precision@1 | **1.00 (100%)** | $\ge 0.80$ | **PASS** |
| **Retrieval Recall** | Recall@3 | **1.00 (100%)** | $\ge 0.80$ | **PASS** |
| **Rank Quality** | MRR | **1.00** | $\ge 0.85$ | **PASS** |
| **Retrieval Coverage** | HitRate@3 | **1.00 (100%)** | $\ge 0.95$ | **PASS** |
| **Generation Grounding** | Faithfulness | **$\ge 0.70$** (Avg: 0.88) | $\ge 0.70$ | **PASS** |
| **Numerical Contradiction** | Hallucinated Numbers | **0** | $0$ | **PASS** |
| **Polarity Verification** | Affirmative/Negative Alignment | **100% Match** | $100\%$ | **PASS** |

All tests execute with local ONNX embeddings (`Xenova/all-MiniLM-L6-v2`) fused with BM25 via Reciprocal Rank Fusion.
