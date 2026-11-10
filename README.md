<div align="center">

<img src="https://raw.githubusercontent.com/Denizsvnc/ai-rag-engine/main/assets/logo.jpg" alt="AI-RAG-ENGINE Logo" width="160" style="border-radius: 28px; box-shadow: 0 12px 40px rgba(124, 108, 245, 0.45); margin-bottom: 16px;" />

# ⚡ AI-RAG-ENGINE

**TypeScript RAG library with pluggable LLM and vector adapters, local semantic routing, tenant-aware retrieval, and durable document ingestion.**

[![Version](https://img.shields.io/badge/npm-@denizsvnc/ai--rag--engine-6C5CE7?logo=npm&logoColor=white)](https://www.npmjs.com/package/@denizsvnc/ai-rag-engine)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![CI](https://github.com/Denizsvnc/ai-rag-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Denizsvnc/ai-rag-engine/actions)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

### 🌐 Documentation Languages

**[English](README.md)** • **[Türkçe](README_tr.md)** • **[Deutsch](README_de.md)**

---

</div>

## Requirements and installation

ESM only. Node.js **22.14 or newer**; the compatibility matrix covers Node 22 and 24. TypeScript consumers should use TypeScript 5.8+ with NodeNext or Bundler resolution. Runtime applications do not need TypeScript or build tools.

```sh
npm install @denizsvnc/ai-rag-engine
```

## Quick Start

This deterministic example needs no credentials, model download, HTTP server, or database. The provider and vector adapter are test doubles demonstrating the integration contract; use real adapters for application data.

```js
import { RAGEngine } from '@denizsvnc/ai-rag-engine';

const engine = new RAGEngine({
  smlConfig: { enabled: false },
  cache: { enabled: false },
  inputs: {
    vectorStore: {
      async search(_query, _topK, filter) {
        if (filter?.tenantId !== 'demo') return [];
        return [{ id: 'returns', content: 'Returns are accepted within 14 days.' }];
      }
    }
  },
  llmProvider: {
    async generate({ systemPrompt }) {
      return { content: systemPrompt.includes('14 days') ? 'Returns: 14 days.' : 'Unknown.' };
    }
  }
});

await engine.init();
const result = await engine.query('What is the return window?', {
  tenantId: 'demo', userId: 'demo-user', roles: ['viewer']
});
console.log(result.answer); // Returns: 14 days.
```

### Production Example (Multi-Tenant with Gemini, pgvector & Redis)

For production applications with external LLMs, multi-tenant persistence, and distributed caching:

```ts
import {
  RAGEngine,
  GeminiAdapter,
  PostgresVectorAdapter,
  RedisCacheAdapter,
  LocalFaqAdapter
} from '@denizsvnc/ai-rag-engine';

const engine = new RAGEngine({
  // 1. LLM Provider (Gemini, OpenAI, Ollama, or Custom)
  llmProvider: new GeminiAdapter(
    process.env.GEMINI_API_KEY,
    'gemini-1.5-flash'
  ),

  // 2. Knowledge Retrieval & Semantic FAQ Matching
  inputs: {
    vectorStore: new PostgresVectorAdapter({
      connectionString: process.env.DATABASE_URL,
      tableName: 'enterprise_embeddings'
    }),
    faq: new LocalFaqAdapter({
      filePath: './faq.json',
      defaultMatchThreshold: 0.65
    })
  },

  // 3. Distributed Cache & Security Guardrails
  cache: {
    enabled: true,
    adapter: new RedisCacheAdapter({
      url: process.env.REDIS_URL,
      defaultTtlMs: 3600000 // 1 hour
    })
  },
  security: {
    enabled: true,
    blockHighRiskInjections: true,
    pii: {
      enabled: true,
      maskTCKN: true,
      maskCreditCards: true,
      maskEmails: true
    }
  }
});

// Query with tenant isolation & role-based access
const response = await engine.query('Q3 compliance audit summary', {
  tenantId: 'tenant-acme',
  userId: 'usr_8472',
  roles: ['compliance_officer']
});

console.log(response.answer);
console.log('Intent:', response.intent);
console.log('Latency (ms):', response.latencyMs);
console.log('Sources:', response.sources);
```

Importing the SDK does not start a server, load `.env`, open Redis/PostgreSQL connections, download models, or change the Transformers global environment. Constructors and explicit initialization perform the operations described in [the usage guide](docs/USAGE.md).

## Capabilities and operational boundaries

| Capability | Implementation / boundary |
| --- | --- |
| LLM providers | OpenAI, Gemini, Ollama, private OpenAI-compatible endpoints, configurable fallback/tiering |
| Semantic FAQ and tool routing | Local Transformers/ONNX embeddings; initial use downloads model files unless local-only |
| In-memory vectors and queue | Development / single-process use; data does not survive restart |
| Persistent vectors | PostgreSQL/pgvector, tenant-scoped CRUD, dense + PostgreSQL full-text RRF retrieval |
| Durable ingestion | Separate BullMQ worker, PostgreSQL uploads/outbox, retries, idempotent replacement, revision-aware cache |
| Security boundaries | Authenticated HTTP context, tool RBAC/schema checks, signed single-use approval, tenant-scoped data access |
| Metrics | Token/latency accounting and Prometheus histogram export |

Prompt filters and PII patterns are defenses with limitations, not guarantees of complete detection. PostgreSQL full-text retrieval is not BM25. The current PDF extractor is limited and does not perform OCR. The dependency tree includes native ONNX runtimes and is substantially larger than the SDK tarball; model weights are not bundled.

## Documentation

- [Configuration, real providers, vectors, FAQ, tools and troubleshooting](docs/USAGE.md)
- [Versioning, manual publication and release checklist](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)
- [Detailed release-readiness report](docs/NPM_RELEASE_READINESS.md)

## Repository verification

```sh
npm ci
npm run typecheck
PG_TEST_URL=postgresql://postgres:test@localhost/rag_test \
REDIS_TEST_URL=redis://localhost:6379 npm test
npm run test:security
npm run test:package
npm run test:consumer
npm audit --audit-level=high
```

Tests with external services require disposable PostgreSQL/pgvector and Redis. Missing service variables explicitly skip those tests locally; CI provisions both and requires them. `test:consumer` installs the packed SDK in a separate project and verifies an inert ESM import, deterministic RAG and strict TypeScript declarations. `test:consumer:integration` adds actual local embeddings/generation and multi-process recovery; it requires test services and model downloads.

MIT licensed. [Issue tracker](https://github.com/Denizsvnc/ai-rag-engine/issues).
