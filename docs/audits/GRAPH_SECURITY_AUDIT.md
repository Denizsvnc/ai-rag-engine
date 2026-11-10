# Graph & Strategy Security Audit

## 1. Multi-Tenant Graph Scoping
- Verified in `MemoryGraphAdapter`: Nodes and edges are strictly mapped with `${tenantId}::${id}` compound keys.
- Cross-tenant neighbor discovery returns empty subgraph with zero leaks.
- Path discovery across foreign tenants returns 0 paths.

## 2. SQL Injection Resistance
- Verified in `PostgresGraphAdapter`: All recursive CTE queries utilize strict parameterized placeholders (`$1`, `$2`, `$3`).
- Zero direct string interpolation in SQL statements.

## 3. Governed Tools & Mutating Actions
- Verified in `AgenticRAGStrategy`: Mutating tools (`isMutating = true` or `requiresConfirmation = true`) are strictly blocked from automatic invocation during query retrieval.
- They are transformed into structured pending evidence items, requiring cryptographic HMAC confirmation tickets.

