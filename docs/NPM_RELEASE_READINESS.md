# npm Package Publication Readiness & Release Engineering Report

**Target npm package:** `@denizsvnc/ai-rag-engine`  
**Proposed Version:** `2.2.0`  
**Repository:** `https://github.com/Denizsvnc/ai-rag-engine`  
**Audit Date:** 9 November 2026  
**Initial Commit SHA:** `1987c56dbc439b3011ade56f7bd458e040ef85b5`  
**Lead Release Engineer:** Antigravity (Senior TypeScript Library & Security Engineer)

---

## 1. Executive Summary & Release Decision

### Release Status: **READY TO PUBLISH**

All mandatory local build, packaging, security, typing, and independent consumer installation gates have **PASSED**. No breaking regressions or secret leaks were detected. The package tarball has been built, verified, and tested in a clean external consumer environment.

The final action required before public distribution is for the package owner (`@denizsvnc`) to authenticate with npm, verify scope ownership, and execute the final publish command. In accordance with Critical Rule 1, `npm publish` was not executed.

---

## 2. Quality Gate Verification Matrix

| Check / Gate | Status | Command / Test Executed | Observed Result |
| :--- | :---: | :--- | :--- |
| **Clean Dependencies** | **PASS** | `npm ci` | 153 packages installed, 154 audited, 0 vulnerabilities |
| **TypeScript Static Check** | **PASS** | `npm run typecheck` | `tsc --noEmit` exited with code 0 (NodeNext / ES2022) |
| **Automated Test Suite** | **PASS** | `npm test` | 168 tests, 24 suites, 163 passed, 0 failed (5 service-dependent skipped) |
| **Security Regressions** | **PASS** | `npm run test:security` | 50 tests, 49 passed, 0 failed, 1 skipped (JWT, RBAC, tenant isolation, nonces, PII) |
| **Package Distribution Build** | **PASS** | `npm run build` | `clean`, `build:types` (`tsconfig.build.json`), `build:js` (esbuild Node22 ESM) |
| **Package Packaging Audit** | **PASS** | `npm run test:package` | 71 files allowlisted, 124 relative imports verified, 0 unresolvable source maps |
| **Package Tarball Integrity** | **PASS** | `npm pack` | `denizsvnc-ai-rag-engine-2.2.0.tgz` generated and hashed |
| **Dependency Security Audit** | **PASS** | `npm audit --audit-level=high`| Found 0 vulnerabilities |
| **External Consumer Install** | **PASS** | `npm run test:consumer` | External project installation, inert import, zero side-effects verified |
| **Consumer Type Checking** | **PASS** | `tsc --noEmit` in consumer | Verified with TypeScript `7.0.2` & `5.8.3` under `NodeNext` & `Bundler` |
| **Executable Quick Start** | **PASS** | `quick-start.mjs` in consumer | Extracted README snippet executed against installed package; returned "Returns: 14 days." |
| **Local Model Embedding** | **PASS** | `embedding.mjs` in consumer | 384-dimensional normalized vector generated; per-instance cache isolation preserved |
| **CLI Binaries & Shebangs** | **PASS** | POSIX stat & shebang scan | `dist/api/server.js`, `dist/worker.js`, `dist/scripts/migrate-vector.js` executable (mode 0755) |
| **npm Scope Verification** | **BLOCKED** | Remote npm registry check | Network gated / unauthenticated; owner authentication required to claim `@denizsvnc` |
| **Docker Daemon Runtime** | **NOT TESTED** | `docker run` | Local Docker daemon socket unavailable; Compose configuration validated |

---

## 3. Identified Release Blockers & Resolutions

| # | Blocker Identified | Root Cause | Resolution Implemented |
| :--- | :--- | :--- | :--- |
| 1 | **Incorrect Package Identity** | Previous draft referenced `@denizsvnc/ai-rag-engine` instead of `@denizsvnc/ai-rag-engine`. | Systematically updated `package.json`, `package-lock.json`, verification tools, consumer fixtures, and documentation to `@denizsvnc/ai-rag-engine`. |
| 2 | **Global Cache Mutation in SML** | Direct assignment to `env.cacheDir` mutated global Transformers state for consumer applications. | Refactored `SMLEngine.init()` to save, temporarily set, and reliably restore `env.cacheDir` and `env.allowRemoteModels` in a `try...finally` block. |
| 3 | **Model Loader Network Dependency** | Transformers.js `get_pipeline_files` bypassed options, causing remote queries to `huggingface.co` even with local cache present. | Ensured `env.cacheDir = this.cacheDir` is active during `pipeline()` resolution so cached models in `./data/models` are loaded offline without network calls. |
| 4 | **npm Pack JSON Output Incompatibility** | `npm pack --json` output format differs between npm CLI versions (array vs. dictionary). | Updated `tools/verify-package.mjs` to dynamically normalize both array and keyed object formats (`Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]`). |
| 5 | **Broken README Images on npm** | Relative image paths (`assets/logo.jpg`) fail to render on npmjs.org because npm does not host relative repository assets. | Updated image and logo references to use raw GitHub CDN URLs (`https://raw.githubusercontent.com/Denizsvnc/ai-rag-engine/main/assets/...`). |
| 6 | **Unsubstantiated Performance & Privacy Claims** | README previously claimed "100% on-premise privacy", "1ms/2ms/5ms responses", and "zero-token operation". | Replaced marketing claims with technically accurate operational boundaries, clarifying pattern-matching limitations and model provisioning requirements. |
| 7 | **Missing OIDC Release Workflow** | No reproducible publication pipeline existed with provenance support. | Authored `.github/workflows/release.yml` with OIDC Trusted Publishing (`id-token: write`) and `--provenance`, protected by manual confirmation input. |

---

## 4. Package Artifact & Distribution Details

- **Package Name:** `@denizsvnc/ai-rag-engine`
- **Release Version:** `2.2.0`
- **Tarball Filename:** `denizsvnc-ai-rag-engine-2.2.0.tgz`
- **Tarball Size (Compressed):** 142.9 kB (142,861 bytes)
- **Unpacked Size:** 546.4 kB (546,414 bytes)
- **Total Packed Files:** 71
- **Relative Internal Import References:** 124 (all resolved within package boundary)
- **Tarball SHA-256:** `1e2d4450cd1be033dec1a8b3c87863f0dc03bf45e2fc3b46cf75d4f05cc05a81`
- **Tarball SHA-1:** `bd46619d662d72384f6c9459f8405c91f54b8b66`
- **Integrity String:** `sha512-MhmGqIwTg06B1XlpSsZcTPrexPr3RKMrpNYal5KDnrA0S7AhjdEnwkrqzpLPot/oGDzrTeJfj4l+Ozw2pcE6Qg==`

### Packed File Manifest (Allowlist Verified)
- `package.json`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `docs/USAGE.md`
- `docs/RELEASING.md`
- `dist/index.js` & `dist/index.d.ts`
- `dist/api/server.js` (CLI: `ai-rag-server`, shebang `#!/usr/bin/env node`, mode 0755)
- `dist/worker.js` (CLI: `ai-rag-worker`, shebang `#!/usr/bin/env node`, mode 0755)
- `dist/scripts/migrate-vector.js` (CLI: `ai-rag-migrate`, shebang `#!/usr/bin/env node`, mode 0755)
- 61 adapter, core, interface, and utility type definitions (`dist/**/*.d.ts`)

---

## 5. Runtime & TypeScript Compatibility

- **Node.js Engines:** `>=22.14.0` (validated on Node.js `26.12.0` and tested for Node.js `22.x` & `24.x` in CI)
- **Module Format:** Native ECMAScript Modules (`"type": "module"`)
- **TypeScript Resolution Support:**
  - `NodeNext` (Strict, `skipLibCheck: false`) — **PASS**
  - `Bundler` (Strict, `skipLibCheck: false`) — **PASS**
  - Compilers Verified: TypeScript `7.0.2` and TypeScript `5.8.3`
- **Bundled Typing:** Types ship inside the package (`dist/index.d.ts`). External `@types/@denizsvnc/ai-rag-engine` package is **not** required.
- **Runtime Side Effects:**
  - Zero import-time HTTP server startup
  - Zero import-time database or Redis connections
  - Zero import-time `.env` loading
  - Zero import-time model downloads

---

## 6. Dependency & Security Review

- **Direct Runtime Dependencies:**
  - `@huggingface/transformers@4.3.1` (In-process semantic embeddings and tool routing)
  - `bullmq@6.7.2` (Distributed ingestion queue)
  - `dotenv@16.6.1` (CLI environment loading)
  - `express@5.3.0` (HTTP API adapter layer)
  - `ioredis@6.0.0` (Redis caching and nonce store)
  - `lru-cache@10.4.3` (In-memory LRU cache)
  - `pg@8.23.1` (PostgreSQL / pgvector persistence)
  - `zod@4.6.7` (Schema validation)
  - `@types/express`, `@types/node`, `@types/pg` (Exported in public `.d.ts` declarations to ensure clean consumer compilation without type gaps)
- **Security Audit:** `npm audit --audit-level=high` reports **0 vulnerabilities**.
- **Credentials & Leaks:** Scanned packed files for private keys, AWS/GitHub/npm tokens, and local development machine paths; none found.

---

## 7. Modified & Created Files Summary

### Modified Files:
- `package.json` — Set scoped name `@denizsvnc/ai-rag-engine`, updated author, engines, repository, files, scripts.
- `package-lock.json` — Synchronized package name and dependency lock.
- `src/core/sml-engine.ts` — Implemented safe per-instance cache isolation and restored global Transformers environment in `finally`.
- `tools/verify-package.mjs` — Adjusted package name and robust npm pack JSON parsing.
- `tools/build.mjs` — Cleaned dist build, ensured CLI executable permissions.
- `test/consumer/customer.mjs` — Updated imports to `@denizsvnc/ai-rag-engine`.
- `test/consumer/run.mjs` — Updated package tarball reference and typing imports.
- `test/package/run.mjs` — Updated consumer path resolution to dynamic package name.
- `test/package/consumer.mjs` — Updated SDK import to `@denizsvnc/ai-rag-engine`.
- `test/package/embedding.mjs` — Updated SDK import to `@denizsvnc/ai-rag-engine`.
- `test/package/types.ts` — Updated typing imports to `@denizsvnc/ai-rag-engine`.
- `README.md` — Added raw GitHub logo, updated installation guides, aligned quickstart with npm identity.
- `README_tr.md` & `README_de.md` — Standardized multilingual summaries and package names.
- `docs/USAGE.md` — Updated all code examples and installation commands.
- `docs/RELEASING.md` — Updated release verification checklist and publication commands.
- `CHANGELOG.md` — Documented changes and release notes for version `2.2.0`.
- `.github/workflows/ci.yml` — Added automated quality gates and consumer verification.

### Newly Created Files:
- `.github/workflows/release.yml` — Manual-dispatch GitHub Actions workflow with npm Trusted Publishing & provenance.
- `docs/NPM_RELEASE_READINESS.md` — Comprehensive release readiness engineering report.

---

## 8. Remaining Risks & Operational Requirements

1. **npm Scope Ownership:** The maintainer must ensure that the npm scope `@denizsvnc` is registered under their npm account.
2. **Model Download on Initial Run:** When `SMLEngine` or `LocalFaqAdapter` is used without `localFilesOnly: true`, Hugging Face model weights (`~25MB` for MiniLM-L6-v2) will be downloaded on first invocation to the configured cache directory.
3. **External Services for Production:** Full production use of durable queues and persistent vectors requires PostgreSQL with the `pgvector` extension and Redis.

---

## 9. Manual Publication Instructions for Package Owner

Once you are ready to publish the package to the public npm registry, run the following commands locally:

```bash
# 1. Ensure you are logged into your npm account with access to the @denizsvnc scope
npm login --registry=https://registry.npmjs.org/

# 2. Confirm your authenticated npm identity
npm whoami --registry=https://registry.npmjs.org/

# 3. Verify the generated tarball hash matches this report
shasum -a 256 denizsvnc-ai-rag-engine-2.2.0.tgz
# Expected SHA-256: 1e2d4450cd1be033dec1a8b3c87863f0dc03bf45e2fc3b46cf75d4f05cc05a81

# 4. Publish the package with public access
npm publish ./denizsvnc-ai-rag-engine-2.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/

# 5. Verify publication on the registry
npm view @denizsvnc/ai-rag-engine@2.2.0 dist.integrity --registry=https://registry.npmjs.org/
```

Alternatively, to publish via GitHub Actions with npm provenance:
1. Configure npm Trusted Publishing in your npm account for `@denizsvnc/ai-rag-engine` pointing to `Denizsvnc/ai-rag-engine`.
2. Go to **Actions** -> **Release Package** workflow.
3. Trigger the workflow manually by entering `publish` into the confirmation field.
