# Cache-Augmented Generation (CAG) Security & Isolation Audit

**Audit Date:** 2026-11-11  
**Remediation Phase:** Phase 3 (P0)  
**Status:** FIXED AND INDEPENDENTLY VERIFIED  
**Components:** `CacheIdentity`, `CAGStrategy`, `RAGEngine`, `CacheManager`

---

## 1. Vulnerability Analysis & Threat Model

### Root Causes
1. **Scope Under-Specification:** `CAGStrategy` constructed cache keys solely as `cag:tenant:${tenantId}:${hash(query)}`. It omitted caller RBAC roles, permission versions, document revisions, graph revisions, and model identity.
2. **Weak Polynomial Hash:** A 32-bit bitshift integer hash truncated to 8 alphanumeric characters was vulnerable to trivial hash collisions.
3. **Cross-Role Information Leakage:** An administrative user querying confidential data (e.g. executive compensation) cached a response that could subsequently be served to an unauthorized user (e.g. `guest` or `intern`) submitting the identical query in the same tenant.
4. **Stale Cache Serving on Invalidation:** Updating document chunks or knowledge graph entities did not alter the cache key, causing stale information to be served indefinitely until manual eviction.
5. **Deceptive Capability Claims:** The strategy reported `nativeKvSupported: true` whenever `cacheType === 'native_model_kv'`, despite relying entirely on a standard key-value response cache without model-level KV-tensor reuse.

---

## 2. Centralized Architecture: `CacheIdentity`

The remediation introduces [`CacheIdentity`](../../src/core/security/cache-identity.ts), a centralized cryptographic cache key constructor enforcing multi-dimensional isolation:

```
Inputs:
- tenantId (Mandatory)
- normalizedQuery (Unicode NFC, whitespace normalized, lowercase)
- canonicalRoles (Sorted, deduplicated)
- userId (Optional caller boundary)
- documentRevision (Monotonically increasing doc revision head)
- graphRevision (Knowledge graph revision head)
- policyVersion (Authorization policy version)
- modelId (Active LLM identifier)
- embeddingModelId (Active embedding model)
- strategyConfigVersion
- cacheScope ('cag' | 'response' | 'semantic' | 'prefix')
            │
            ▼
   Deterministic JSON Payload
            │
            ▼
     HMAC-SHA256 Digest
            │
            ▼
rag:v4:{tenantId}:{scope}:{digest}
```

### Guarantees
- **Zero Plaintext Leakage:** Raw sensitive user prompts and PII are never exposed as plaintext strings in Redis or in-memory cache keys.
- **Cryptographic Collision Resistance:** 256-bit HMAC-SHA256 signature eliminates collision risks.
- **Role Isolation:** Differing roles querying identical text generate completely distinct cryptographic hashes.
- **Revision-Based Invalidation:** Bumping `documentRevision` or `graphRevision` immediately generates a new hash, rendering previous cache entries un-addressable without expensive distributed purges.
- **Honest Capability Negotiation:** `CAGStrategy` requires verified `nativeKvCapability: true` from the LLM provider. Without it, the strategy automatically degrades to `response_cache` and sets `nativeKvSupported: false`.
- **Cache Miss Integrity:** Cache misses return `confidence: 0.0` with no fabricated `answerDraft`.

---

## 3. Adversarial Test Verification

The test suite in [`test/unit/adaptive/cag-cache-security.test.ts`](../../test/unit/adaptive/cag-cache-security.test.ts) independently verifies:

| Test Case | Adversarial Vector | Expected Outcome | Verdict |
| :--- | :--- | :--- | :---: |
| `Test 1` | Identical query from `admin` vs `intern` in same tenant | `intern` receives cache miss (`confidence: 0.0`) | PASS |
| `Test 2` | Identical query across `tenant_A` and `tenant_B` | Zero cross-tenant leakage (`confidence: 0.0`) | PASS |
| `Test 3` | Document revision bumped from 1 to 2 | Stale cache immediately invalidated | PASS |
| `Test 4` | Knowledge graph revision bumped from 10 to 11 | Stale GraphRAG cache immediately invalidated | PASS |
| `Test 5` | Caller role revoked (`['admin', 'auditor']` -> `['auditor']`) | Access denied to cached administrative data | PASS |
| `Test 6` | Hash collision resistance & zero plaintext query exposure | Unique hashes generated; query not in key | PASS |
| `Test 7` | Unverified provider claiming native KV-cache | Degrades to `response_cache`, `nativeKvSupported: false` | PASS |
| `Test 8` | Verified provider with genuine native KV capability | Reports `nativeKvSupported: true` honestly | PASS |
| `Test 9` | Cache miss handling | Returns `confidence: 0.0`, `evidence: []`, no answer draft | PASS |

---

## 4. Verification Verdict

**Status: FIXED AND INDEPENDENTLY VERIFIED**  
All 9 security test cases pass. Both `RAGEngine` and `CAGStrategy` employ multi-dimensional `CacheIdentity` hashing.

