# AI-RAG-ENGINE v2.4.0 Remediation Baseline Audit

**Audit Date:** 2026-11-11  
**Target Repository:** `Denizsvnc/ai-rag-engine`  
**Baseline Git Commit:** `3950481` (Git Tag: `v2.4.0`)  
**Node.js Runtime:** v26.13.0 (Minimum supported: v22.14+)  
**Bun Runtime:** v1.4.4  
**TypeScript Version:** 5.8+  
**Status:** BASELINE ESTABLISHED — IDENTIFIED DEFECTS DOCUMENTED

---

## 1. System Inventory & Baseline State

### 1.1 Core Runtime & Dependencies (`package.json`)
- `@huggingface/transformers`: `^3.8.1` (ONNX runtime for in-process embeddings)
- `zod`: `^3.24.2` (Tool argument schemas & validation)
- `express`: `^4.21.2` (HTTP REST API and middleware)
- Optional `peerDependencies`: `mongodb` (`^6.14.0`), `mysql2` (`^3.13.0`), `neo4j-driver` (`^5.28.1`)
- Built-in drivers: `node:sqlite` (`DatabaseSync` in Node.js 22.14+ / Bun), `node:zlib`, `node:crypto`

### 1.2 Test Suite Execution Baseline
- `npm run typecheck`: PASS (0 errors across `src/`)
- `npm run build`: PASS (104 files generated in `dist/`)
- `npm run test:package`: PASS (104 files, 246 relative imports, zero undeclared dependencies)
- `npm run test:bun`: PASS (6/6 tests passing)
- `bun test test/unit/storage/ test/unit/adaptive/ test/unit/logical/`: PASS (87/87 tests passing)

---

## 2. Comprehensive Defect Analysis & Reproduction Scenarios

### Finding 1: P0 — Tool Execution Authorization & Schema Bypass in `AgenticRAGStrategy`
- **Root Cause:** `AgenticRAGStrategy.execute()` directly calls `tool.execute({}, qContext)`. It bypasses `ToolRegistry` RBAC checks, Zod argument schema validation, mutation classification, cryptographic HMAC confirmation tickets, and audit trails.
- **Affected Path:** `AgenticRAGStrategy.execute` -> `tool.execute`
- **Security Implications:** An unauthenticated or low-privilege user can invoke tools with unauthorized parameters or trigger mutating actions without confirmation tickets.
- **Reproduction:** Register a mutating tool with a required Zod schema and `requiredRoles: ['admin']`. Invoke via `AgenticRAGStrategy` with `{ roles: ['guest'] }`. Tool executes successfully with empty arguments `{}`.
- **Remediation Plan:** Introduce `GovernedToolExecutor` enforcing 10 mandatory security gates. Route both legacy `RAGEngine` and `AgenticRAGStrategy` through this boundary.

### Finding 2: P0 — CAG Cache Scope Insufficiency & Authorization Leakage
- **Root Cause:** `CAGStrategy` computes cache keys as `cag:cache:${tenantId}:${simpleHash(query)}`. It ignores caller identity, RBAC roles, permission versions, document revisions, graph revisions, and model identity.
- **Affected Path:** `CAGStrategy.execute` -> `cacheAdapter.get`
- **Security Implications:** A user with role `viewer` can receive cached sensitive data previously retrieved by `superadmin`. Furthermore, updating documents or graph entities does not invalidate stale cached answers.
- **Reproduction:** Query identical prompt as `admin`, invalidate role down to `guest`, query again. `CAGStrategy` returns cached `answerDraft` without re-authorizing.
- **Remediation Plan:** Implement multi-dimensional HMAC cryptographic cache identity incorporating `tenantId`, effective role/policy hash, document revision heads, model/strategy config, and normalized query. Negotiate real native KV-cache support.

### Finding 3: P1 — Uncooperative Strategy Hanging in `ExecutionScheduler`
- **Root Cause:** `ExecutionScheduler` initiates an `AbortController` and schedules a timeout, but awaits strategies via `Promise.all()`. If a strategy hangs without monitoring `signal.aborted` (e.g. infinite loop or stuck network call), `Promise.all()` blocks forever.
- **Affected Path:** `ExecutionScheduler.execute` -> `Promise.all`
- **Reliability Implications:** A single uncooperative or slow strategy starves the scheduler, exceeding SLAs and leaking resources.
- **Reproduction:** Inject a strategy that returns `new Promise(() => {})` without checking `AbortSignal`. The query hangs indefinitely despite configured `maxDeadlineMs`.
- **Remediation Plan:** Implement deadline-aware racing per strategy, bounded timeouts, transport cancellation, and explicit result classifications (`SUCCESS`, `TIMED_OUT`, `CANCELLED`, `FAILED`, `BUDGET_EXCEEDED`).

### Finding 4: P1 — Asymmetric Graph Store Dependency Resolution
- **Root Cause:** `RAGEngine` configures graph via `inputs.graph`, whereas modern storage uses `storage.config.graph`. If a consumer configures `storage: createStorage({ graph: ... })`, the adaptive orchestrator or `KnowledgeGraphStrategy` may not receive the graph adapter.
- **Affected Path:** `RAGEngine.constructor` -> `AdaptiveIntelligenceOrchestrator`
- **Correctness Implications:** Modern storage configurations silently fail to execute GraphRAG / KAG strategies.
- **Reproduction:** Initialize `RAGEngine` with `storage: createStorage({ graph: mockGraph })`. Check if `orchestrator` has graph access.
- **Remediation Plan:** Create `normalizeEngineDependencies` unifying `inputs` and `storage` with explicit precedence and uniform injection.

### Finding 5: P1 — KAG Keyword Match Pseudo-Deduction
- **Root Cause:** `KAGStrategy` scores business rules using keyword overlaps (`words.filter(w => query.includes(w))`) and emits conclusions with `isDerived: true`.
- **Correctness Implications:** Keyword overlap is not a valid logical inference. False rules are asserted as deductive facts.
- **Reproduction:** Query "Is the sky green?" with rule "Green lights indicate active systems". KAG matches word "green" and emits "Active systems confirmed" as a derived conclusion.
- **Remediation Plan:** Introduce typed fact, entity, relation, and rule premise/conclusion representations with structured inference traces. Separate asserted, extracted, derived, and unsupported facts.

### Finding 6: P1 — Uncalibrated Routing & Override Bypass in `AdaptiveQueryPlanner`
- **Root Cause:** Planner relies on regex matches and returns hardcoded `confidence: 0.9`. Also does not strictly enforce `allowRequestOverrides: false` against caller-requested strategies.
- **Security & Efficiency Implications:** Callers can force high-cost strategies or bypass routing policies.
- **Remediation Plan:** Enforce system and tenant routing policies, validate requested overrides, integrate SML semantic classification option, and replace pseudo-probabilities with calibrated heuristic confidence.

### Finding 7: P1 — SQLite Vector Indexing Capability Discrepancy
- **Root Cause:** `SqliteVectorAdapter` currently sets `nativeIndexes: true`, but dense vector search uses a full table scan computing dot products in JavaScript / SQLite BLOB math, while native indexing only applies to FTS5 BM25.
- **Correctness Implications:** Misleading capability claims to consuming query planners.
- **Remediation Plan:** Separate `nativeIndexes` into vector indexing vs full-text indexing, reporting `denseVectorSearch: true, nativeIndexes: false, fullTextSearch: true`.

### Finding 8: P1 — Filesystem Blob Directory Confinement
- **Root Cause:** `LocalFsBlobStore` checks `targetPath.startsWith(tenantDir)`, but tenant IDs containing separators (e.g. `tenant/alpha` or `tenant\alpha`) or symlink targets can escape or collide across namespaces.
- **Security Implications:** Path traversal or cross-tenant namespace collision via crafted `tenantId`.
- **Remediation Plan:** Enforce strict alphanumeric regex on `tenantId` (`/^[a-zA-Z0-9_-]+$/`), resolve real canonical paths with symlink verification, and prevent directory escaping.

### Finding 9: P1 & P2 — Graph Traversal Tenant Isolation & Capability Claims
- **Root Cause:** Graph strategies must ensure that multi-hop neighbor expansion strictly enforces `$tenantId` at every edge and node level, and that GraphRAG documents local expansion limitations rather than claiming unsupported global community summarization.
- **Remediation Plan:** Audit Cypher queries, verify source provenance, and align documentation.

---

## 3. Baseline Audit Verdict

The baseline exhibits strong fundamental modularity, but requires rigorous hardening in tool governance, cache authorization, scheduler deadlines, dependency normalization, logical reasoning, and filesystem confinement.

