# Security Review & Remediation Audit Log

November 9 Update: Subsequent architectural modifications covering cache invalidation, latency telemetry, and pgvector persistence are documented in [production-data-layer.md](production-data-layer.md). The findings below record the historical security audit.

Initial commit reviewed: `cd6fa63` (v2.1.0).

## Verified and Remediated Findings

| Severity & Vulnerability | Verified Behavior in Source | Remediation & Verification Evidence |
|---|---|---|
| **P0 Boolean Confirmation Bypass** | Setting `confirmedAction: true` triggered mutating tools without cryptographic ticket verification. | Engine now enforces signed HMAC tickets; raw HTTP flags are disregarded. Test suite verifies execution counter remains zero without ticket. |
| **P0 Static / Hardcoded Secrets** | Fixed fallback strings existed for JWT and mutation tickets. | Production mode enforces independent, random secrets of >=32 bytes at startup. JWT claims (`iss`, `aud`, `iat`, `exp`, `nbf`) and HMAC signature are strictly validated. |
| **P0 In-Memory Nonce Replay** | Mutation nonces were stored in a process-local `Map`, allowing multi-instance replay attacks. | Implemented `RedisConfirmationNonceStore` using atomic `SET key 1 PX ttl NX`. Verified across independent processes; single-use consumption guaranteed. |
| **P1 Tenant Ingestion Job Leakage** | Ingestion status was returned without verifying tenant scope against the authenticated caller. | Tenant context is bound to lookup queries; unauthorized requests return 404. Raw binary payloads and internal spool paths are excluded from status responses. |
| **P1 Unauthenticated FAQ Access** | Absence of tenant context retrieved and matched all FAQ items across all tenants. | `getFaqs` and `findBestMatch` exclude tenant-scoped entries when invoked without explicit tenant context. |
| **P0 Client Role Spoofing** | HTTP middleware accepted unauthenticated roles from client request headers. | Unauthenticated requests receive 401; roles are populated exclusively from verified `req.auth`. Anonymous development auth is disabled by default in production. |

## Additional Hardening Implemented

- `userId` validation is strictly enforced on confirmation tickets alongside tenant matching.
- Query caches isolate callers by `tenantId`, `userId`, and sorted roles array to prevent cache poisoning between users with distinct scopes.
- Confirmation tickets are kept private and never injected into LLM prompt contexts.
- Tool extraction verifies that the LLM-selected tool name strictly matches the registered tool before execution.
- API key lookups validate own properties to prevent prototype pollution.

## Verification Commands

```sh
npm ci
npm run typecheck
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
REDIS_TEST_URL=redis://127.0.0.1:6379 npm run test:security
npm run build
npm audit --audit-level=high
```
