# Sürüm Yönetimi ve Yayın Kontrol Listesi

## Sürüm Politikası

Önerilen ilk public sürüm **2.2.0**'dır: önceki sürüm 2.1.0 olarak tanımlanmış olup yeni dağıtım kalıcı alım işleyicileri ve pgvector entegrasyonu içermektedir. Yayınlanmış hiçbir sürüm tekrar kullanılamaz; inceleme sonrası artifact'ler üzerinde sessiz değişiklik yapılamaz.

## Zorunlu Yerel Kalite Kapıları

1. Yetkili kullanıcı olarak scope sahipliğini doğrulayın.
2. `CHANGELOG.md`, paket adı/sürümü ve ESM/Node gereksinimlerini inceleyin.
3. `npm ci`, typecheck, disposable pgvector/Redis ile testler, güvenlik regresyonu, build, paket doğrulaması ve bağımsız tüketici testini çalıştırın.
4. Paket içeriğini denetleyin; hiçbir kimlik bilgisi, demo armatürü, model ağırlığı veya mutlak yerel dosya yolu gönderilmemelidir.
5. Tarball hash'ini, sürüm numarasını ve etiketini onaylayın.
6. Yalnızca açık onay sonrası yayınlayın.

## Paket Sahibi İçin Manuel Komutlar

```sh
# Hazırlık ve doğrulama:
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
shasum -a 256 denizsevinc-ai-rag-engine-2.2.0.tgz

# Yayınlama adımı (yalnızca paket sahibi oturum açtığında):
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm view @denizsevinc/ai-rag-engine versions --json --registry=https://registry.npmjs.org/
npm publish ./denizsevinc-ai-rag-engine-2.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
npm view @denizsevinc/ai-rag-engine@2.2.0 dist.integrity --registry=https://registry.npmjs.org/
```

