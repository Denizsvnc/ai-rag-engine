# CLAUDE.md - Developer & Agent Architecture Guide

This document defines the architectural guidelines, customization patterns, data freshness rules, and token cost optimization principles for **AI-RAG-ENGINE**.

---

## 🏛️ 1. Core Architecture Philosophy

**AI-RAG-ENGINE** operates on a **cost-minimizing, security-hardened waterfall**:
> *Every user query must take the cheapest, safest possible execution path. External LLM tokens are only consumed when deterministic local layers cannot answer.*

```
Query -> Security Guard (0 tokens) -> LRU/Disk Cache (0 tokens) -> Semantic FAQ (0 tokens) 
      -> Local SML Tool Router (0 tokens) -> Tiered LLM (Fast vs. Smart Failover)
```

---

## 🔄 2. Data Freshness & Cache Invalidation (Preventing Stale Data)

### The Stale Data Problem
If a product's price changes from **$1000 (X)** to **$800 (B)**, or inventory drops to 0, traditional RAG engines fail in two ways:
1. **Stale Cache:** The query `"how much is the laptop?"` was previously answered with `$1000` and is stuck in cache.
2. **Stale Vectors:** The product specification text embedded into vector store still reads `$1000`.

### Architectural Solution in AI-RAG-ENGINE

#### Rule 1: Never Embed Volatile Facts into Static Vectors
* **Static Context (Vectors & FAQs):** Store invariant or slowly changing knowledge: product manuals, return policies, feature descriptions, warranty terms.
* **Volatile Context (Live SML Tools):** Prices, warehouse stock quantities, booking availability, customer balances, and shipping status MUST be modeled as **Agent Tools** (`IAgentTool`). The local SML routes price/stock queries directly to a tool that queries the live database (PostgreSQL, ERP, inventory API) in real time.

#### Rule 2: Live Tool Caching Policy
By default, `RAGEngine` configures live tool results to **bypass the 24-hour cache** or use a micro-TTL (e.g. 60 seconds):
```typescript
const engine = new RAGEngine({
    cache: {
        enabled: true,
        ttlMs: 1000 * 60 * 60 * 24, // 24 hours for static/FAQ queries
        cacheToolResults: false      // Live tool actions are never cached stale!
        // Or set micro-TTL: toolResultTtlMs: 60 * 1000 (60 seconds)
    }
});
```

#### Rule 3: Active Cache Invalidation on Data Mutation (Webhooks / Events)
When product data updates (price X -> B), trigger instant cache eviction:
```typescript
// 1. Invalidate queries matching a specific product or keyword
await engine.invalidateCache('laptop');

// 2. Invalidate via regular expression
await engine.invalidateCache(/_price$|fiyat/i);

// 3. Clear entire cache if catalog re-indexes
await engine.clearCache();
```

---

## 💡 3. Token Cost Reduction Guide (Cutting LLM Bills by 80–95%)

| Layer | Latency | Token Cost | When It Triggers |
| :--- | :--- | :--- | :--- |
| **OWASP Security Guard** | ~1 ms | **0 Tokens** | Prompt injections, jailbreaks, system prompt extractions |
| **Hybrid LRU / Disk Cache** | ~2 ms | **0 Tokens** | Frequently asked identical or normalized queries |
| **Zero-Token Semantic FAQ** | ~5–8 ms | **0 Tokens** | Paraphrased customer service questions matching pre-computed embeddings |
| **Local SML Intent Router** | ~8–12 ms | **0 Tokens** | In-process ONNX CPU dot-product matching against tools-registry |
| **Fast LLM Tier** | ~300 ms | **Lowest Cost** | `gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2:3b` for parameter extraction |
| **Smart LLM Tier** | ~1200 ms | **Standard Cost** | `gpt-4o`, `deepseek-r1`, `gemini-1.5-pro` (only for complex multi-step reasoning) |

### Best Practices to Maximize Token Savings:
1. **Pre-embed common questions:** Add recurring user questions to `src/utils/faq-embeddings.json`. Unit dot-product vector search matches them with zero LLM invocations.
2. **Keep tool schemas compact:** Do not bloat tool parameter definitions with verbose text.
3. **Use the Fast Tier by default:** Reserve the Smart Tier for analytical, comparative, or multi-question inputs.

---

## 🛠️ 4. How to Customize the Repository

### 1. Registering Custom Live Agent Tools (`IAgentTool`)
```typescript
import type { IAgentTool } from 'ai-rag-engine';

export const liveStockTool: IAgentTool<{ sku: string }> = {
    name: 'check_live_stock',
    description: 'Queries warehouse ERP database for real-time stock and price of a given SKU.',
    parameters: {
        type: 'object',
        properties: {
            sku: { type: 'string', description: 'Product SKU code' }
        },
        required: ['sku']
    },
    execute: async ({ sku }, context) => {
        // Query live PostgreSQL or external ERP
        const data = await db.query('SELECT stock, price FROM products WHERE sku = $1', [sku]);
        return data.rows[0];
    }
};

// Register tool with engine
engine.registerTool(liveStockTool);
```

### 2. Registering Custom Business Rules (`IRulesAdapter`)
```typescript
import { StaticRulesAdapter } from 'ai-rag-engine';

const rules = new StaticRulesAdapter([
    'All returned items must include original tags and packaging.',
    'Express delivery cutoff time is 17:00 CET.',
    'Never promise discounts exceeding 15% without manager approval.'
]);
```

### 3. Adding Zero-Token Semantic FAQs (`LocalFaqAdapter`)
Add entries to `src/utils/faq-embeddings.json` with pre-computed 384-dimensional unit vectors (`all-MiniLM-L6-v2`):
```json
{
  "id": "faq_return_window",
  "question": "What is your return policy?",
  "answer": "You can return items within 14 days for a full refund.",
  "embedding": [0.041, -0.082, ...]
}
```

### 4. Configuring Private & On-Premise LLMs (Ollama / vLLM / VPC)
In `.env`:
```env
# Disable public open-source aggregators to prevent data leaks
ALLOW_PUBLIC_OPENSOURCE_LLM=false

# Local Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL_FAST=llama3.2:3b
OLLAMA_MODEL_SMART=deepseek-r1:8b

# Or internal OpenAI-compatible VPC endpoint (vLLM / TGI)
CUSTOM_LLM_URL=http://vllm.corp.internal:8000/v1/chat/completions
CUSTOM_LLM_MODEL=meta-llama/Llama-3.2-3B-Instruct
```

---

## 🔒 5. PII Protection, Document Ingestion & Asynchronous Job Queues

### Zero-Bloat PII Sanitization
* **Algorithmic TCKN Mod-10 Verification:** Always use `PIIGuard.isValidTCKN(candidate)` rather than blindly masking all 11-digit numbers. This prevents false positive masking of order numbers, invoice codes, or product SKUs.
* **Luhn Algorithm for Credit Cards:** Validates 13-19 digit card numbers using the mod-10 double-alternating sum before redacting.
* **Data Sovereignty Routing Rule:**
  * Public Cloud LLMs (`OpenAI`, `Gemini`, `OpenRouter`) must **NEVER** receive unmasked PII.
  * Local/On-Premise LLMs (`Ollama`, `CustomLLM` via internal VPC) may only preserve unmasked personal credentials if corporate policy explicitly grants permission via `allowUnmaskedForLocalLLM: true`.
* **Zero-Bloat Performance Rule:** All PII inspection must run in sub-millisecond time (< 5 microseconds per call) without adding external Python or NLP dependencies.

### Document Ingestion & Magic Byte Validation
* **Pre-Flight Magic Byte Defense:** Always validate file headers before queueing. Reject `.exe`, `.sh`, `.bat`, `.bin`, `.js`, `.py`, `.docm`, and disguised binary executables (`MZ`, `\x7fELF`, `#!` Shebang, `0xCAFEBABE`).
* **Non-Blocking Job Queues (`IJobQueue`):** Heavy operations (PDF decoding, recursive chunking, embedding generation) must run through background worker queues.
  * Use `InMemoryJobQueue` for zero-dependency local environments and automated test suites.
  * Use `BullMQJobQueue` with Redis for distributed production deployments.

### FinOps Real-Time Token Tracking
* Every query response MUST include the `metrics` object (`tokensConsumed`, `tokensSaved`, `estimatedCostSavedUsd`, `latencyMs`).
* Keep cumulative stats accessible via `engine.getMetrics()` and `GET /api/metrics`.

---

## 🛡️ 6. Required Behaviors & Standards for AI Agents

1. **Maintain Code Integrity:** Preserve existing docstrings, comments, and tests. Never delete existing functionality unless explicitly requested.
2. **Strict Verification:** Always run `npm run typecheck` and `npm test` before concluding any modifications. All tests must pass (currently 65/65).
3. **OWASP Trust Boundary:** Raw visitor text must ALWAYS be sanitized with `InputSanitizer` and wrapped in `<untrusted_visitor_message>` sandbox tags. Never concatenate user text directly into system prompts.
4. **Data Sovereignty:** Honor `ALLOW_PUBLIC_OPENSOURCE_LLM=false`. If a corporate user disables public routers, do not route prompts through OpenRouter or third-party gateways.
5. **Live Data Freshness:** When adding new pricing, stock, or booking capabilities, always use `IAgentTool` with live execution, not static vectors.
6. **Zero-Bloat Discipline:** Never install bulky external dependencies when pure, fast TypeScript algorithms can solve the problem in microsecond time.
7. **Containerization Standards:** Production Docker images must use multi-stage builds (`node:22-slim`), drop privileges to the `node` user, and include healthcheck probes hitting `/api/health`.
