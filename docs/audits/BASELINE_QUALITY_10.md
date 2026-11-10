# Baseline Quality & Verification Assessment — AI-RAG-ENGINE v2.2.4

**Audit Date:** 2026-11-10  
**Target Package:** `@denizsvnc/ai-rag-engine`  
**Baseline Version:** `2.2.4`  
**Git HEAD Commit:** `5e44d2e86662ec5b5fafd5f47cdf665cbf5e0643`  
**Host Environment:**
- OS: macOS 26.6.2 (Darwin 25.0.0, arm64)
- Node.js: `v26.13.0` (V8 14.2)
- npm: `11.20.0`
- Bun: `1.4.4` (JavaScriptCore)
- Live Local Services:
  - PostgreSQL 17 + `pgvector 0.8.2` on `127.0.0.1:5432`
  - Redis Server on `127.0.0.1:6379`

---

## 1. Baseline Command Execution Matrix

| Verification Command | Execution Scope | Passed | Failed | Skipped | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `npm run typecheck` | Static TypeScript compiler (`tsc --noEmit`) | N/A | 0 | 0 | **PASS** | Clean build, zero diagnostics. |
| `npm run build` | Clean, `build:types`, `build:js` | 71 files | 0 | 0 | **PASS** | Dist bundle matches `.d.ts` declaration maps. |
| `npm test` (with live DBs) | Native Node.js runner (`node:test`) | 215 | 0 | 0 | **PASS** | Full suite passed; live pgvector & Redis validated. |
| `npm run test:security` | Adversarial RBAC, injection, tickets | 49 | 0 | 1 | **PASS** | 1 test skipped requiring isolated Redis reboot. |
| `npm run test:package` | Tarball allowlist, structure, import checks | 71 files | 0 | 0 | **PASS** | Packed size: 158.5 kB; unpacked: 600.3 kB. |
| `npm run test:consumer` | Isolated temporary ESM consumer project | 6 assertions | 0 | 0 | **PASS** | Pure tarball consumption without repo devDeps. |
| `npm run test:consumer:integration` | End-to-end BullMQ, pgvector, flan-t5, SIGKILL | 12 tests | 0 | 0 | **PASS** | Full worker lifecycle & crash recovery verified. |
| `npm run test:bun` | Bun test runner on in-process core SDK | 30 assertions | 0 | 0 | **PASS** | 6 test suites passed in 675ms under Bun v1.4.4. |
| `npm run benchmark` | Awaited async LRU + CPU hot paths (107k ops) | 7 targets | 0 | 0 | **PASS** | V8 heap tracked (net delta 10.14 MB). |
| `npm audit --audit-level=high` | Vulnerability scanning on dependency graph | 0 CVEs | 0 | 0 | **PASS** | Zero high or critical vulnerabilities found. |

---

## 2. Baseline Architecture Invariants

1. **Zero Undeclared Dependencies:** The published tarball contains 71 files; every runtime import is mapped to declared dependencies in `package.json`.
2. **Deterministic Dual Constructors:** `GeminiAdapter`, `OpenAIAdapter`, and `OpenRouterAdapter` support both configuration objects (`{ apiKey, model, temperature }`) and positional parameter signatures.
3. **Serialized SML Initialization:** `SMLEngine.acquireInitLock` synchronizes Transformers.js environment changes, isolating concurrent model boots across tenants.
4. **Hardened Ingestion:** PDF parser strictly rejects unparseable or scanned documents by throwing an explicit `Error`, preventing silent vector database poisoning.
5. **Multi-Tenant Boundaries:** Parameterized tenant filters apply to vector lookups, semantic caching, FAQ searches, and BullMQ ingestion jobs.

