<div align="center">

<img src="assets/logo.jpg" alt="AI-RAG-ENGINE Logo" width="160" style="border-radius: 28px; box-shadow: 0 12px 40px rgba(124, 108, 245, 0.45); margin-bottom: 16px;" />

# ⚡ AI-RAG-ENGINE

**Enterprise-Grade Agentic RAG Architecture with In-Process SML Intent Routing, Zero-Token Semantic FAQ Caching, Multi-Tiered LLM Failover & OWASP Prompt Injection Defense.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-all--MiniLM--L6--v2_(q8)-FF5722?logo=onnx&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![Tests](https://img.shields.io/badge/Tests-65%2F65_Passing-success?logo=checkmarx&logoColor=white)](test/)
[![Security](https://img.shields.io/badge/OWASP-Prompt_Injection_Guarded-blueviolet?logo=shield&logoColor=white)](#-owasp-prompt-injection--visitor-trust-boundary)
[![PII Defense](https://img.shields.io/badge/PII-TCKN_&_Luhn_Guarded-blue?logo=security&logoColor=white)](#6--zero-bloat-pii-sanitization--data-sovereignty-routing)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

### 🌐 Language / Dil / Sprache

**[English](README.md)** • **[Türkçe](README_tr.md)** • **[Deutsch](README_de.md)**

---

</div>

## 📌 Executive Summary

Modern enterprise applications cannot afford sending every raw user question directly to expensive, slow, and non-deterministic cloud LLMs. Doing so leads to sky-high token bills, 2-5 second latency spikes, data compliance liabilities, and vulnerability to prompt injection attacks.

**AI-RAG-ENGINE** resolves these bottlenecks by introducing a **cost-minimizing, security-hardened waterfall pipeline**:

1. **🛡️ 1ms OWASP Guardrail:** Neutralizes jailbreaks, system prompt extractions, and role overrides before contacting any model.
2. **💾 2ms LRU & Disk Cache:** Immediately serves repeated queries from memory/disk without invoking LLMs.
3. **🎯 5ms Zero-Token Semantic FAQ:** Resolves paraphrased user questions via local 384-dimensional dot-product vector search against pre-computed embeddings (**0 LLM tokens consumed**).
4. **🧠 In-Process Semantic Model Layer (SML):** Executes intent classification and agent tool routing locally on CPU using quantized ONNX (`all-MiniLM-L6-v2`) in under 15ms.
5. **🔀 Multi-Tiered LLM Failover:** Automatically directs routine tasks to **Fast LLMs** (e.g. `gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2`) and complex analytical inquiries to **Smart LLMs** (`gpt-4o`, `deepseek-r1`, `gemini-1.5-pro`), backed by automatic multi-provider fallback.
6. **🔒 100% On-Premise Privacy Mode:** Out-of-the-box native adapters for **Ollama**, **vLLM**, **TGI**, and internal corporate VPC endpoints with `ALLOW_PUBLIC_OPENSOURCE_LLM=false` compliance enforcement.

---

## 🏛️ System Architecture

### 1. Request Lifecycle Waterfall
*Every query follows the cheapest, safest possible execution path. External LLMs are invoked only when local deterministic and semantic layers cannot fulfill the request.*

<div align="center">

![AI-RAG-ENGINE Request Lifecycle](assets/pipeline.svg)

</div>

---

### 2. Integration Topology & Endpoints
*Flexible deployment options: consume as a standalone microservice with REST endpoints, or embed directly as an Express/Node.js library with enterprise failover.*

<div align="center">

![AI-RAG-ENGINE Integration Topology](assets/endpoints.svg)

</div>

---

### 3. Local SML Decision & Execution Mechanism (Deep Dive)
*How AI-RAG-ENGINE eliminates slow, expensive cloud LLM prompt-based tool routing by utilizing in-process 384-dimensional ONNX vector dot products and deterministic threshold gates.*

<div align="center">

![AI-RAG-ENGINE Local SML Decision and Execution Mechanism](assets/sml-mechanism.svg)

</div>

---

### 4. Secure Document Ingestion & PII Protection Pipeline
*Zero-bloat pre-flight magic byte defense, algorithmic TCKN/Luhn verification, BullMQ background worker queue, and local sovereignty routing.*

<div align="center">

![AI-RAG-ENGINE Secure Document Ingestion and PII Pipeline](assets/ingestion-pii-pipeline.svg)

</div>

---

## ✨ Key Engineering Pillars

### 1. 🧠 In-Process Semantic Model Layer (SML) Decision & Tool Routing
* **The Architectural Problem:** Traditional Agentic frameworks (e.g. LangChain, CrewAI, AutoGen) serialize massive tool JSON schemas into system prompts and query a remote cloud LLM (GPT-4 / Claude) just to ask: *"Which tool should be called?"*. This burns **800–2,000 tokens** and incurs **1.5–3.0 seconds of latency** before executing any tool.
* **The SML Solution:** Decouples *Intent Routing* from *Text Generation*. Uses `@huggingface/transformers` to run quantized `Xenova/all-MiniLM-L6-v2 (q8)` in-process on CPU via ONNX Runtime (< 15MB RAM, ~8–12ms, 0 tokens).
* **Pre-Computed Vector Registry:** Pre-generates normalized 384-dimensional unit vectors ($\vec{t}_i$) for all registered tools and persists them in `src/utils/tools-registry.json`.
* **Mathematical Decision Gate:**
  $$\text{Similarity Score} = \vec{q} \cdot \vec{t}_i = \sum_{k=1}^{384} q_k \cdot t_{ik}$$
  * **Branch A ($\text{Score} \ge 0.50$): Deterministic Tool Action Triggered**
    * High-confidence intent matched (e.g., `check_live_stock` with score `0.78`).
    * Fast-tier LLM extracts compact JSON arguments (`{ productName: "laptop" }`).
    * Native code execution (`tool.execute(args)`) directly queries live PostgreSQL, SAP ERP, or warehouse REST APIs.
    * Real-time facts are injected directly into context with zero routing hallucinations.
  * **Branch B ($\text{Score} < 0.50$): Standard Vector Retrieval**
    * Falls back seamlessly to semantic top-k document retrieval when no transactional tool matches.

### 2. 🎯 Zero-Token Semantic FAQ Engine
* **Paraphrase Tolerance:** Matches varying user phrases (e.g., *"how many days do I have to return an item?"* vs *"ürünü kaç gün içinde iade edebilirim?"*) against verified enterprise knowledge.
* **Vector Dot Product:** Utilizes SIMD-friendly vector dot-product similarity (cosine similarity for unit-length vectors) with a calibrated confidence threshold (`>= 0.60`).
* **Instant Resolution:** Yields verified, auditable business answers in **< 10ms with 0 LLM token cost**.

### 3. 🛡️ OWASP Prompt Injection & Visitor Trust Boundary
* **Explicit Boundary Framing:** Wraps all raw visitor input inside isolated `<untrusted_visitor_message>` delimiters.
* **Authoritative Security Directives:** Rigid English system prompts command the LLM that visitor text is untrusted data and can **never** alter system instructions, impersonate developers, or leak internal prompts.
* **Unicode & Control Byte Sanitization:** Strips zero-width characters (`\u200B`, `\uFEFF`, `\u200D`) and invisible formatting tokens commonly used in evasive prompt injection payloads.
* **Delimiter Neutralization:** Automatically defangs `<untrusted_visitor_message>` closing tags in user input to prevent context-escape attacks.
* **0-Token Heuristic Interceptor:** High-confidence jailbreak patterns (DAN modes, "ignore previous instructions", developer override tricks) trigger an instant, safe refusal within 1ms without burning LLM tokens.

### 4. 🔀 Multi-Tiered LLM Provider with Enterprise Failover
* **Complexity-Based Routing:**
  * **Fast Tier** (`gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2:3b`): Handles short clarifications, tool parameter extraction, and conversational synthesis.
  * **Smart Tier** (`gpt-4o`, `gemini-1.5-pro`, `deepseek-r1:8b`): Activated for multi-question prompts, comparative analysis, or complex reasoning.
* **Cascading Failover:** If a primary provider (e.g., OpenAI) encounters rate limits (`429`) or network downtime, the engine fails over gracefully to Gemini, Ollama, or an internal enterprise server.
* **Corporate Data Governance:** `ALLOW_PUBLIC_OPENSOURCE_LLM=false` prevents accidental transmission of corporate IP to public aggregator routers.

### 5. 💾 Hybrid LRU Cache & Active Data Freshness (Preventing Stale Data)
* **The Stale Data Problem:** In traditional RAG systems, if an item's price changes from **$1000 (X)** to **$800 (B)**, static vector embeddings and long-lived query caches continue serving the outdated $1000 price.
* **The AI-RAG-ENGINE Freshness Architecture:**
  1. **Volatile Facts Bypass Vectors via Live SML Tools:** Prices, real-time stock levels, and booking statuses are NEVER stored in static vector embeddings. The in-process SML routes pricing queries directly to an active database tool (`check_live_price`), querying the live PostgreSQL/ERP system at execution time.
  2. **Zero-Stale Tool Caching Policy (`cacheToolResults: false`):** Volatile tool execution outputs bypass the 24-hour cache by default (or utilize micro-TTLs), ensuring catalog mutations are immediately visible to users.
  3. **Active Cache Invalidation API:** When product data or policies change, backends trigger instant cache eviction across both RAM and persistent disk storage:
     ```typescript
     // Invalidate all queries related to a product or keyword
     await engine.invalidateCache('laptop');
     // Invalidate via regex pattern
     await engine.invalidateCache(/_price$|fiyat/i);
     ```
  4. **Configurable TTL & Auto-Expiration:** LRU memory cache enforces configurable `ttlMs` expiration so stale entries self-evict automatically.

### 6. 🔒 Zero-Bloat PII Sanitization & Data Sovereignty Routing
* **The Compliance Challenge:** User queries and ingested PDF/text files often contain sensitive identity credentials like Turkish Republic Identity Numbers (TCKN), Credit Cards, IBANs, and contact details. In typical setups, developers either ignore this (risking massive GDPR / KVKK fines) or pull in bloated 500MB Python NLP libraries that choke production servers.
* **The Zero-Bloat Solution:** Implemented in pure TypeScript with zero external dependencies, executing in under **4.03 microseconds** (245,408 ops/sec benchmarked):
  1. **Algorithmic TCKN Mod-10 Checksum:** Validates 11-digit Turkish IDs against official government checksum formulas:
     $$d_{10} = \left(\left(\sum \text{odd} \times 7 - \sum \text{even}\right) \bmod 10 + 10\right) \bmod 10, \quad d_{11} = \left(\sum_{k=1}^{10} d_k\right) \bmod 10$$
     *Zero false positives:* Benign 11-digit numbers (order numbers, invoice tracking codes) remain completely untouched, while genuine TCKNs are redacted (`[TCKN_100*****46]`).
  2. **Credit Card Luhn Algorithm:** Doubles alternating digits from right-to-left to verify authentic bank cards before masking (`[CARD_****_****_****_5671]`).
  3. **IBAN & Contact Sanitization:** Regex-neutralizes Turkish (`TR..`) and European IBANs, emails, and phone numbers.
* **Strict Data Sovereignty Routing:**
  * **Public Cloud LLMs (OpenAI, Google Gemini):** PII is **guaranteed 100% masked**. Raw personal identification never crosses the corporate network perimeter.
  * **On-Premise Local LLMs (Ollama, Private VPC):** If internal compliance permits (`allowUnmaskedForLocalLLM: true`), raw identifiers can optionally be preserved for internal reasoning without cloud exposure.

### 7. ⚡ Asynchronous BullMQ & In-Memory Ingestion Queue
* **Non-Blocking Architecture:** Document ingestion (PDF stream decoding, chunking, PII redaction, and 384-dimensional ONNX vector generation) is CPU-heavy. Synchronous handling would freeze Express event loops.
* **Pluggable Queue Adapters (`IJobQueue`):**
  * **Zero-Dependency `InMemoryJobQueue`:** Active by default with concurrent worker scheduling and progress tracking. Runs out of the box with zero external infrastructure (no Redis required for tests or single-node apps).
  * **Enterprise `BullMQJobQueue`:** Backed by Redis with distributed worker pools, retries, and exponential backoff for large-scale Kubernetes deployments.
* **Two-Step REST Workflow:**
  1. `POST /api/ingest` runs pre-flight magic byte safety checks and returns `202 Accepted` with a `jobId`.
  2. `GET /api/ingest/status/:jobId` reports real-time progress (`0% -> 30% -> 70% -> 100%`) and processing metrics.
* **Executable Magic Byte Defense:** Pre-flight inspection scans binary headers to reject disguised executables (`MZ` Windows PE, `\x7fELF` Linux, `#!` Shebang scripts, `0xCAFEBABE`, `.exe`, `.sh`, `.bin`, `.docm`) in under **1.26 µs**.

### 8. 📊 FinOps Telemetry & Real-Time Token Cost Tracking
* **The Visibility Deficit:** Engineering managers rarely know how many tokens their caching and semantic routing save versus raw LLM calls.
* **Per-Response Cost Breakdown:** Every `engine.query()` response returns real-time metrics:
  ```json
  {
    "answer": "14 gün içinde koşulsuz iade edebilirsiniz.",
    "intent": "FAQ",
    "resolvedBy": "SEMANTIC_FAQ",
    "metrics": {
      "tokensConsumed": 0,
      "tokensSaved": 450,
      "estimatedCostSavedUsd": 0.00135,
      "latencyMs": 4.2,
      "source": "FAQ"
    }
  }
  ```
* **Cumulative FinOps Endpoint (`GET /api/metrics`):**
  Returns total queries, zero-token resolution rate (e.g. `78.4%`), total tokens consumed vs saved, estimated dollar savings, and p95 latency distributions.

---

## 🚀 Quick Start

### Prerequisites
* **Node.js** >= 20.0.0
* **npm** >= 10.0.0

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/Denizsvnc/ai-rag-engine.git
cd ai-rag-engine

# Install dependencies
npm install
```

### 2. Configure Environment
Copy the `.env.example` template to `.env`:
```bash
cp .env.example .env
```

#### Option A: Local & Private Deployment (Ollama / vLLM / On-Premise)
*Zero data leaves your private network.*
```env
ALLOW_PUBLIC_OPENSOURCE_LLM=false

# Ollama local instance
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL_FAST=llama3.2:3b
OLLAMA_MODEL_SMART=deepseek-r1:8b

# Or generic OpenAI-compatible VPC endpoint (vLLM, TGI, LocalAI)
CUSTOM_LLM_URL=http://internal-llm-service.corp.local:8000/v1/chat/completions
CUSTOM_LLM_MODEL=meta-llama/Llama-3.2-3B-Instruct
```

#### Option B: Cloud Providers (OpenAI & Google Gemini)
```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_FAST=gpt-4o-mini
OPENAI_MODEL_SMART=gpt-4o

GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Launch Development Server
```bash
npm run dev
```
The server will initialize the ONNX embedding pipeline and listen on `http://localhost:3000`.

---

## 💻 Usage & Code Examples

### Option 1: Standalone Express Middleware
Mount `createRagMiddleware` into an existing Express application in less than 10 lines:

```typescript
import express from 'express';
import {
    RAGEngine,
    createRagMiddleware,
    TieredLLMProvider,
    LocalFaqAdapter,
    StaticRulesAdapter
} from 'ai-rag-engine';

const app = express();
app.use(express.json());

// Initialize RAGEngine
const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv(),
    inputs: {
        rules: new StaticRulesAdapter([
            'The return window for all purchased electronics is 14 days.',
            'Always maintain an institutional, polite, and helpful tone.'
        ]),
        faq: new LocalFaqAdapter({
            filePath: './src/utils/faq-embeddings.json',
            defaultMatchThreshold: 0.60
        })
    },
    security: {
        enabled: true,
        blockHighRiskInjections: true
    },
    cache: {
        enabled: true,
        filePath: './src/utils/query-cache.json'
    }
});

// Mount the RAG query endpoint
app.post('/api/chat', createRagMiddleware(engine));

app.listen(3000, () => {
    console.log('⚡ AI-RAG-ENGINE active on http://localhost:3000/api/chat');
});
```

---

### Option 2: Programmatic Execution with Custom Tools

```typescript
import { RAGEngine, TieredLLMProvider, ToolRegistry } from 'ai-rag-engine';

const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv()
});

await engine.init();

// Register a custom live database tool
engine.registerTool({
    name: 'check_live_stock',
    description: 'Check real-time warehouse inventory for a product',
    parameters: {
        type: 'object',
        properties: {
            productName: { type: 'string', description: 'Product identifier or name' }
        },
        required: ['productName']
    },
    execute: async (args) => {
        return { inStock: true, unitsAvailable: 42, warehouseLocation: 'Berlin-01' };
    }
});

// Process query
const result = await engine.process('Do you currently have laptops in stock?');
console.log(result.answer);
console.log(`Resolved by: ${result.resolvedBy} in ${result.latencyMs}ms`);
```

---

## 📡 REST API Reference

### 1. `POST /api/query`
Processes incoming user prompts through the complete RAG waterfall pipeline.

#### Request Headers
| Header | Value | Description |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | Required |

#### Request Body
```json
{
  "query": "What is your return policy for open-box items?",
  "context": {
    "userId": "usr_9876",
    "region": "EU"
  }
}
```

#### Response: Zero-Token Semantic FAQ Match (`200 OK`)
```json
{
  "answer": "You can return any undamaged item in its original packaging within 14 days of delivery for a full refund.",
  "intent": "FAQ",
  "resolvedBy": "SEMANTIC_FAQ",
  "appliedRules": [],
  "latencyMs": 7
}
```

#### Response: High-Risk Prompt Injection Blocked (`200 OK`)
```json
{
  "answer": "Güvenlik politikası nedeniyle bu talimat işlenemez. Lütfen yalnızca ürün ve hizmetlerimizle ilgili sorularınızı iletin.",
  "intent": "SECURITY_BLOCKED",
  "resolvedBy": "SECURITY_GUARD",
  "appliedRules": [],
  "latencyMs": 1
}
```

---

### 2. `GET /api/health`
Kubernetes and Docker container health liveness probe.

```json
{
  "status": "ok",
  "uptime": 348.12,
  "timestamp": "2026-10-26T02:50:00.000Z"
}
```

---

## 🧪 Testing & Verification

The engine is covered by an automated test suite verifying all architectural boundaries:

```bash
# Run unit & integration tests (65 tests across 13 suites)
npm test

# Run high-throughput smoke benchmark
npm run benchmark

# Run k6 multi-user concurrent load test
k6 run test/performance/k6-load-test.js

# Run TypeScript strict type verification
npm run typecheck

# Run production bundle build
npm run build

# Run interactive showcase examples
npm run example:ecommerce
npm run example:minimal
```

### High-Throughput Smoke Benchmark Results
*Executed on Apple Silicon M-series (100% in-process CPU, zero GPU required):*

| Benchmark Target | Iterations | Throughput | Avg Latency | p95 Latency | Architectural Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`PIIGuard.sanitize`** | 10,000 | **245,408 ops/s** | **4.03 µs** | 4.87 µs | Algorithmic TCKN Mod-10 + Luhn Check |
| **`CacheManager.get`** | 20,000 | **7,276,034 ops/s** | **0.10 µs** | 0.25 µs | In-Memory Hot Path Eviction |
| **`Dot Product` (384-dim)** | 50,000 | **2,307,741 ops/s** | **0.41 µs** | 0.58 µs | all-MiniLM-L6-v2 ONNX SIMD Math |
| **`Document Chunking`** | 5,000 | **778,993 ops/s** | **1.26 µs** | 1.50 µs | Magic Bytes & Boundary Chunker |
| **`TokenTracker`** | 20,000 | **5,946,554 ops/s** | **0.14 µs** | 0.21 µs | Real-time FinOps Telemetry |

### Automated Test Suite Summary
```text
✔ Integration - Express API Routes (3/3 passing)
✔ Integration - RAGEngine Full Lifecycle (7/7 passing)
✔ Integration - Document Ingestion & PII Protection Pipeline (4/4 passing)
✔ Core Engine - CacheManager & Data Freshness (7/7 passing)
✔ FAQ Layer - LocalFaqAdapter (4/4 passing)
✔ Asynchronous Queue - InMemory & BullMQ (4/4 passing)
✔ LLM Adapters & Multi-Tier Failover (6/6 passing)
✔ Math Utilities - Dot Product (4/4 passing)
✔ Security Guard - PIIGuard & Data Sovereignty (6/6 passing)
✔ Security Layer - Prompt Injection & Boundary Framing (11/11 passing)
✔ FinOps Metrics - TokenTracker (5/5 passing)

Total: 65 tests passing across 13 test suites (0 errors, ~980ms duration)
```

---

## 📂 Repository Directory Layout

```text
ai-rag-engine/
├── assets/
│   ├── logo.jpg               # Project visual identity
│   ├── pipeline.svg           # 2D animated request lifecycle diagram
│   ├── endpoints.svg          # 2D animated integration topology diagram
│   ├── sml-mechanism.svg      # 2D animated SML decision engine diagram
│   └── ingestion-pii-pipeline.svg # 2D animated secure ingestion & PII diagram
├── dist/                      # Compiled production ESM & types
├── src/
│   ├── adapters/              # FAQ, LLM, Rules & Vector adapters
│   ├── api/                   # Express middleware, routes (/query, /ingest, /metrics)
│   ├── core/
│   │   ├── cache-manager.ts   # Dual-tier LRU + JSON disk cache (TTL & Invalidation)
│   │   ├── engine.ts          # Main orchestrator pipeline & telemetry
│   │   ├── metrics/           # TokenTracker (FinOps cost & latency tracking)
│   │   ├── prompt-builder.ts  # Prompt injection defense & sandbox tags
│   │   ├── queue/             # InMemoryJobQueue, BullMQJobQueue & QueueFactory
│   │   ├── security/          # PIIGuard (TCKN/Luhn), Sanitizer & InjectionDetector
│   │   ├── sml-engine.ts      # Local ONNX all-MiniLM-L6-v2 pipeline
│   │   └── tool-registry.ts   # Semantic intent tool router
│   ├── services/
│   │   └── document-ingestion.service.ts # Magic bytes & PII redaction pipeline
│   ├── examples/              # Ready-to-run reference implementations
│   ├── interfaces/            # TypeScript contracts & type definitions
│   └── utils/                 # Pre-computed 384-dim vector datasets
├── test/
│   ├── integration/           # Full lifecycle, API & Ingestion integration tests
│   ├── performance/           # High-throughput smoke benchmark & k6 load test
│   └── unit/                  # Cache, SML, LLM, Math, PII & Security unit tests
├── TASKS.md                   # Real-time feature checklist & implementation tracker
├── CLAUDE.md                  # Comprehensive agent customization & engineering guide
├── LICENSE                    # MIT License
├── package.json               # Package definitions & scripts
├── README.md                  # English Documentation (Default)
├── README_tr.md               # Türkçe Dokümantasyon
└── README_de.md               # Deutsche Dokumentation
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Feel free to use it in commercial products, open-source projects, and enterprise integrations.
