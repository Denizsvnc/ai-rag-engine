# Versioning and Release Checklist

## Policy

The recommended first public version is **2.2.0**: the repository already identifies its preceding API as 2.1.0, and the new distribution includes durable ingestion and persistence. Version **2.2.0** is the official initial release published on npm under `@denizsvnc/ai-rag-engine`.

After the first public release, use patch releases for compatible fixes, minor releases for compatible features, and major releases for incompatible public API, security-contract or supported-runtime changes. Document security-driven breaks and migration paths. Never reuse a published version; do not silently modify artifacts after review.

## Required local gates

1. Verify scope ownership and registry state while authenticated as the intended maintainer. A public 404 does not prove an available or owned scope.
2. Review `CHANGELOG.md`, package name/version, ESM/Node requirements and compatibility notes.
3. Run `npm ci`, typecheck, full tests with disposable pgvector/Redis, security regressions, build, package verification, dependency audit and independent consumer installation.
4. Run real-model consumer integration when model/provisioning changes warrant it. Keep it distinct from the deterministic package gate.
5. Inspect packed files and ensure no credentials, demo fixtures, model weights, absolute workstation paths, caches or install-time SDK hooks are shipped.
6. Inspect transitive native dependency scripts/permissions; `npm audit` does not prove absence of malicious code or unpublished vulnerabilities. Models have separate licenses.
7. Approve the exact tarball hash, package version and dist-tag. Review CI results on Node 22/24.
8. Only after explicit authorization, publish the reviewed tarball. Tags, pushes and GitHub releases require their own authorization.

## Manual commands for the owner

Preparation (no publication):

```sh
npm ci
npm run typecheck
PG_TEST_URL=postgresql://postgres:test@localhost/rag_test \
REDIS_TEST_URL=redis://localhost:6379 npm test
REDIS_TEST_URL=redis://localhost:6379 npm run test:security
npm run test:package
npm run test:consumer
npm audit --audit-level=high
npm pack --dry-run
npm pack
shasum -a 256 denizsvnc-ai-rag-engine-2.2.0.tgz
```

Only when the repository owner is ready to authenticate and publish:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @denizsvnc/ai-rag-engine versions --json --registry=https://registry.npmjs.org/
# Confirm namespace rights, intended version and reviewed tarball hash before proceeding.
npm publish ./denizsvnc-ai-rag-engine-2.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm view @denizsvnc/ai-rag-engine@2.2.0 dist.integrity --registry=https://registry.npmjs.org/
```

A 404 from `npm view` is expected for a genuinely new name but is not an authorization check. `npm login`/`npm publish` were not executed by the preparation agent. Do not store tokens in the repository, `.npmrc`, logs or CI artifacts. Prefer owner-approved short-lived authentication and enforced account security.

## Trusted Publishing (optional, not configured)

No automatic publication workflow is installed. For later owner-approved CI publication, npm supports OIDC Trusted Publishing with matching repository/workflow/environment settings, npm CLI 11.5.1+ and Node.js 22.14+. Configure it in the npm package settings, use an approved environment and `id-token: write`, and keep all validation gates. Trusted publication automatically attaches provenance. First-publication and package-ownership prerequisites must be resolved by the owner. Do not add token secrets as a fallback.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), [Node.js release schedule](https://github.com/nodejs/Release).
