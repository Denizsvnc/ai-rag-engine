# Versionierung und Release-Checkliste

## Versionsrichtlinie

Die offizielle erste öffentliche Version ist **2.2.0**, veröffentlicht auf npm unter `@denizsvnc/ai-rag-engine`. Bereits veröffentlichte Versionen dürfen niemals überschrieben oder wiederverwendet werden.

## Lokale Qualitätskontrollen

1. Überprüfen Sie den Scope-Besitz als autorisierter Maintainer.
2. Prüfen Sie `CHANGELOG.md`, Paketnamen und ESM/Node-Anforderungen.
3. Führen Sie `npm ci`, Typecheck, Tests mit separaten pgvector/Redis-Diensten, Build, Paketverifikation und Konsumententests aus.
4. Stellen Sie sicher, dass keine Zugangsdaten, lokalen Pfade oder Modelldateien im Paket enthalten sind.
5. Bestätigen Sie den Tarball-Hash und das Dist-Tag vor der Veröffentlichung.

## Manuelle Befehle für den Paket-Eigentümer

```sh
# Vorbereitung und Verifikation:
npm ci
npm run typecheck
PG_TEST_URL=postgresql://postgres:test@localhost/rag_test \
REDIS_TEST_URL=redis://localhost:6379 npm test
REDIS_TEST_URL=redis://localhost:6379 npm run test:security
npm run test:package
npm run test:consumer
npm audit --audit-level=high
npm pack
shasum -a 256 denizsvnc-ai-rag-engine-2.2.0.tgz

# Veröffentlichung (nach Maintainer-Login):
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @denizsvnc/ai-rag-engine versions --json --registry=https://registry.npmjs.org/
npm publish ./denizsvnc-ai-rag-engine-2.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm view @denizsvnc/ai-rag-engine@2.2.0 dist.integrity --registry=https://registry.npmjs.org/
```

