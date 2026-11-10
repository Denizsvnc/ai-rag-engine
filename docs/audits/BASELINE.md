# AI-RAG-ENGINE — Production Engineering Baseline Audit

> **Date:** 2026-11-10  
> **Auditor Role:** Coordinator & Quality Assurance Architect  
> **Package:** `@denizsvnc/ai-rag-engine`  
> **Repository:** `https://github.com/Denizsvnc/ai-rag-engine`  
> **Target Release:** v2.3.0 (Current local / npm published: v2.2.2)  

---

## 1. System & Runtime Environment

| Component | Verified Version | Environment Path / Identifier |
| :--- | :--- | :--- |
| **Operating System** | macOS 15.6 (Darwin 24.6.0 arm64) | Local Apple Silicon Workstation |
| **Node.js** | `v26.13.0` | `/Users/denizsevinc/.nvm/versions/node/v26.13.0/bin/node` |
| **npm** | `11.20.0` | `/Users/denizsevinc/.nvm/versions/node/v26.13.0/bin/npm` |
| **Bun** | `1.4.4` | `/Users/denizsevinc/.bun/bin/bun` |
| **TypeScript** | `7.0.2` (devDependency) | Native ESModule compiler (`tsconfig.build.json`) |
| **esbuild** | `0.28.2` (devDependency) | Bundle packaging runner |
| **Git Commit (HEAD)** | `61c47a5` | `fix: resolve text chunking decay, harden jailbreak patterns, and optimize adapter lifecycle (v2.2.2)` |
| **Git Tag** | `v2.2.2` | Cleanly synchronized with `origin/main` |

---

## 2. Published npm Artifact Baseline

- **Published Version on npm:** `2.2.2`
- **Dist Tag:** `latest: 2.2.2`
- **Integrity Shasum:** `5a528b08e4ed2201f3edf2939c0995db027b3e03`
- **Tarball URL:** `https://registry.npmjs.org/@denizsvnc/ai-rag-engine/-/ai-rag-engine-2.2.2.tgz`
- **Tarball Content Audit:** 71 files, 151,635 packed bytes, 573,604 unpacked bytes.
- **Published Artifact Contents:** Includes `dist/index.js`, `dist/api/server.js`, `dist/worker.js`, `dist/scripts/migrate-vector.js`, and all `.d.ts` declaration maps.

---

## 3. Baseline Verification Commands & Results

| Check / Gate | Executed Command | Exit Code | Verified Outcome |
| :--- | :--- | :---: | :--- |
| **Static Typecheck** | `npm run typecheck` (`tsc --noEmit`) | `0` | **0 Errors.** Strict typecheck passed. |
| **Package Derivation** | `npm run build` | `0` | Clean build with `esbuild` and `tsc -p tsconfig.build.json`. |
| **Package Allowlist Audit** | `npm run test:package` | `0` | 71 files verified against package contract. |
| **Dependency Audit** | `npm audit` | `0` | **0 vulnerabilities** across production & dev dependencies. |
| **Security Suite** | `npm run test:security` | `0` | **50 tests:** 49 passed, 0 failed, 1 skipped. |
| **Automated Test Suite** | `npm test` (`tsx test/run-all.ts`) | `0` | **186 tests:** 181 passed, 0 failed, 5 skipped. |
| **Consumer Smoke Test** | `bun test test/unit/math.test.ts` | `0` | **4 tests passed** under Bun v1.4.4. |

---

## 4. Current Working Tree & Pending Integrations

The working tree holds the initial implementations for native PDF decompression and multilingual SML models:
1. `src/services/document-ingestion.service.ts`: Integration of `node:zlib` (`inflateSync` & `inflateRawSync`) for `/Filter /FlateDecode` streams.
2. `src/core/sml-engine.ts`: Definition of `SMLModelPresets` (`ENGLISH_FAST`, `MULTILINGUAL`, `MULTILINGUAL_ACCURATE`).
3. `src/interfaces/engine-config.interface.ts`: Comprehensive TSDoc documentation for IDE IntelliSense and expanded `smlConfig`.
4. `src/core/engine.ts`: SML options pass-through and enhanced TSDoc.
5. `test/unit/services/pdf-and-sml-features.test.ts`: 8 new unit tests verifying PDF and SML features (100% pass).

---

## 5. Identified High-Priority Architectural & Quality Risks

### 5.1 Transformers.js Global Mutation Race Condition (`SMLEngine.init`)
- **Location:** `src/core/sml-engine.ts` lines 138-153.
- **Root Cause:** Mutating `env.cacheDir` and `env.allowRemoteModels` directly on the imported `@huggingface/transformers` namespace. If two engines or requests initialize concurrently, they clobber each other's cache directory and remote flag.
- **Remediation Opportunity:** `@huggingface/transformers` v4.3.1 `pipeline()` natively supports `cache_dir: this.cacheDir`, `local_files_only: this.localFilesOnly`, and `dtype: this.dtype` as per-call options. Global `env` mutation can and must be completely removed.

### 5.2 LLM Adapter Constructor Signatures & Model Deprecation
- **Location:** `src/adapters/llm/gemini.adapter.ts`, `src/adapters/llm/openai.adapter.ts`.
- **Root Cause:** Constructors only accepted positional arguments `(apiKey?: string, model?: string)`. Passing an options object `{ apiKey: '...', model: '...' }` (standard TypeScript ergonomics) resulted in `apiKey` being set to `"[object Object]"`.
- **Model Defaults:** `gemini-1.5-flash` and `gemini-1.5-pro` are functional, but `gemini-2.0-flash` is now GA and offers superior performance. Support for dual invocation (object or positional) is critical.

### 5.3 Bun Runtime Compatibility
- While individual unit tests run under Bun, a comprehensive integration suite testing the packed npm tarball under Bun v1.4.4 has never been executed.

### 5.4 Document Ingestion & Chunking Edge Cases
- Missing input validation on `chunkSize` and `overlap` (`chunkSize <= 0` or `overlap >= chunkSize` can cause pathological loop behaviors).
- Streaming chunker does not use `StringDecoder`, posing risks of multibyte UTF-8 truncation when streaming non-ASCII text (e.g., Turkish characters).

### 5.5 RAG Evaluator Metric Limitations
- `RAGEvaluator.evaluateFaithfulness` uses simple lexical overlap heuristics:
  - Empty or short answers (<10 chars) score 1.0 (100% grounded).
  - Negation statements ("The server is not offline") can achieve >40% word overlap and be marked grounded despite being exact contradictions.
  - Duplicate retrieved IDs skew `precisionAtK`.

---

## 6. Baseline Verification Limitations & Skipped Tests

The 5 skipped tests in the baseline test run are:
1. `test/integration/distributed-cache.test.ts`: Real Redis invalidation across independent Node processes.
2. `test/integration/distributed-confirmation.test.ts`: Redis single-use confirmation ticket redemption.
3. `test/integration/durable-ingestion.test.ts`: Durable PostgreSQL shared blob outbox and idempotency.
4. `test/integration/api.test.ts`: Redis rate limiting shared across API instances.
5. `test/integration/postgres-vector.test.ts`: Real PostgreSQL pgvector index creation and search.

*Reason for skipping:* Requires live local or containerized PostgreSQL (port 5432) and Redis (port 6379).

