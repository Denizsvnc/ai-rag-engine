# Güvenlik incelemesi ve düzeltme kaydı

Tarih: 27 Ekim 2026. İncelenen başlangıç commit'i: `cd6fa63` (v2.1.0).
Kaynak: kullanıcı tarafından paylaşılan teknik inceleme ve mevcut çalışma ağacı.

## Doğrulanan ve kapatılan bulgular

| Bulgu | Kaynakta doğrulanan davranış | Düzeltme ve kanıt |
|---|---|---|
| P0 Boolean confirmation bypass | `confirmedAction: true` ticket olmadan mutasyonu çalıştırıyordu. | Engine yalnızca imzalı ticket kabul ediyor; HTTP bayrağı iletilmiyor. Engine testi gerçek execute sayacını sıfırda tutuyor. |
| P0 Bilinen varsayılan secret | JWT ve confirmation için sabit anahtarlar vardı. | Üretimde eksik, eski varsayılan veya 32 byte altında anahtar yapılandırma hatası. Geliştirme fallback'i süreç başına rastgele. JWT HS256/typ, issuer, audience, iat/exp/nbf ve kimlik şeması doğrulanıyor. |
| P0 Süreç yerel replay kaydı | Statik Map başka Node süreçleriyle paylaşılmıyordu. | Redis `SET key 1 PX ttl NX` adaptörü; üretimde mutating tool içeren engine paylaşılan nonce deposu ister. Depo hatası işlemi reddeder. Gerçek Redis ile sekiz bağımsız süreçten yalnızca biri ticket tüketebildi; yeni süreçte yeniden kullanım reddedildi. |
| P1 Ingestion status tenant izolasyonu | Rol kontrolünden sonra job doğrudan dönüyordu. | HTTP kimliğinin tenant'ı engine/service lookup'a taşınıyor; farklı tenant ve eksik job 404. Job data, base64 belge ve spool yolu HTTP yanıtından çıkarıldı. HTTP yüklemelerinde tenant ve oluşturucu doğrulanmış kimlikten kaydediliyor. |
| P1 Kimliksiz FAQ erişimi | Tenant verilmediğinde tüm FAQ'lar listelenip eşleştirilebiliyordu. | Hem getFaqs hem findBestMatch tenant-specific kayıtları kimliksiz bağlamda dışlıyor. Mevcut veri sözleşmesine göre tenantId'siz FAQ globaldir. |
| P0 HTTP kimliği için istemci fallback'i | Middleware auth yokken body/header içinden tenant, user, roles alıyordu. | Middleware auth yoksa 401; kimlik yalnızca req.auth'dan, istemciden yalnızca izin verilen query seçenekleri alınır. Anonim dev erişimi açık opt-in ister ve üretimde yasaktır. |

## İnceleme sırasında bulunan ek açıklar

- Ticket'taki userId hiç kontrol edilmiyordu; tenant karşılaştırması ise çağrıda tenant bulunmadığında atlanıyordu. Artık iki alan da eksik/farklı bağlamı reddeder.
- Aynı tenant ve role sahip farklı kullanıcılar cache paylaşabiliyordu. Anahtar tenant + user + sıralanmış roles dizisinin JSON gösterimini içerir; role ayırıcı çakışmaları engellenir. Eski anahtarlara erişilmez.
- Onay ticket'ı sadece LLM tool bağlamına iletiliyordu. Artık `response.confirmationRequests` yapılandırılmış önerileri içerir; ticket LLM bağlamına verilmez. Onay önerileri ve mutasyon sonuçları cache'e yazılmaz; ticket'lı çağrı cache okumaz.
- LLM'in döndürdüğü tool adı ile yönlendirilen/çalıştırılan tool adı eşleştirilmiyordu. Uyumsuz ad artık execute öncesi reddedilip audit kaydına yazılır.
- API key lookup, prototipten gelen property'leri kabul edebiliyordu. Yalnızca own property ve şeması geçerli servis kimliği kabul edilir.
- Genel engine metriklerine `guest` rolünün erişimi kaldırıldı.

## Doğrulama sonuçları

Yerel ortam: Node 24.22.1, Redis 8.6.2; LLM/tool extraction için deterministik mock'lar, mevcut semantik testlerde yerel embedding modeli.

- Başlangıç: **140/140** test geçti.
- Son sürüm: **148/148** test, 24 suite, **0 hata ve 0 skip**; gerçek Redis testi dahil.
- `npm run typecheck` ve `npm run build`: başarılı.
- `npm audit`: yeni ioredis bağımlılığı dahil **0 bilinen açık**.
- `git diff --check`: başarılı.
- Mevcut smoke benchmark tamamlandı. Bu mikrobenchmark gerçek HTTP/LLM p95/p99 veya üretim yük testi değildir; bazı cache ölçümleri async işlemi await etmez.
- Eksik secret ile derlenmiş production sunucusu port açmadan exit 1 verdi.
- `docker compose config --quiet`: başarılı. Docker daemon çalışmadığından image build/runtime testi yapılmadı.
- CI'a Redis servisi ve high/critical bağımlılık güvenlik kapısı eklendi. GitHub Actions bu yerel oturumda çalıştırılmadı.

Tekrarlama:

```sh
npm ci
npm run typecheck
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
REDIS_TEST_URL=redis://127.0.0.1:6379 npm run test:security
npm run build
npm audit --audit-level=high
npm run benchmark
```

REDIS_TEST_URL verilmezse yalnızca gerçek dağıtık Redis testi açıkça skip edilir; CI değişkeni sağlar. Redis test hesabının disposable bir veritabanına erişmesi önerilir; test nonce anahtarları TTL ile temizlenir.

## Geçiş ve production yapılandırması

1. Birbirinden bağımsız, rastgele en az 32 byte JWT_SECRET ve CONFIRMATION_SECRET tanımlayın. `openssl rand -hex 32` her anahtar için ayrı çalıştırılabilir. Secret'ları kaynak kontrolüne koymayın. Geliştirmede farklı süreçler arasında JWT kullanmak için de sabit, size ait JWT_SECRET gerekir.
2. Mevcut JWT'leri yeniden üretin: `iss`, `aud`, `iat`, `exp`, dolu tenantId/userId ve string roles dizisi zorunludur. Varsayılan issuer `ai-rag-engine`, audience `ai-rag-engine-api`; middleware seçenekleri veya JWT_ISSUER/JWT_AUDIENCE ile yapılandırılabilir.
3. `confirmedAction` artık etkisizdir. Kullanıcıya `confirmationRequests[].toolName` ve `proposedArgs` gösterin; açık onaydan sonra aynı query'yi `context.confirmationTicket` ile tekrar gönderin. Argümanlar yeniden çıkarılır; değişirse ticket reddedilir. API istemcisi için boolean'a geri dönüş yoktur.
4. `ConfirmationService.verifyTicket()` artık Promise döner; hem statik hem instance çağrıları await edilmelidir. Statik API `{valid,error}` döndürür; instance API geçersiz ticket için reject eder.
5. SDK'da production mutasyonları için `EngineConfig.confirmation.nonceStore` alanına `RedisConfirmationNonceStore` verin. Tüm instance'lar aynı Redis DB/prefix ve confirmation secret'ını kullanmalıdır. Hazır sunucu `CONFIRMATION_REDIS_URL` yapılandırmasını kullanır; hazır sunucuda henüz mutating tool kayıtlı değildir.
6. Nonce deposu kayıp/eviction olmadan TTL dolana kadar kayıt tutmalıdır. Compose Redis'i AOF, appendfsync always ve noeviction ile yapılandırır. Redis veri kaybı, yedekten eski veriye dönüş veya asenkron failover sonrası exactly-once garantisi bu testle kanıtlanmaz. Kritik iş işlemleri ayrıca kalıcı iş idempotency anahtarı kullanmalıdır. Depo kapalıysa mutasyon engellenir.
7. Route'lar varsayılan olarak auth ister. Yalnızca yerel geliştirmede `auth.allowDevAnonymous: true` (hazır sunucuda ALLOW_ANONYMOUS_DEV_AUTH=true) opt-in kullanılabilir. SDK QueryContext güvenilir sunucu entegrasyonunun sorumluluğudur; doğrudan istemci JSON'unu engine.query'ye aktarmayın.
8. Ingestion status yanıtı artık job.data içermez. SDK'daki scopesuz job/audit/vector yönetim API'leri güvenilir sunucu yönetim işlevleridir; doğrudan internete açılmamalıdır.

SDK paylaşılan onay deposu örneği:

```ts
import Redis from 'ioredis';
import { RAGEngine, RedisConfirmationNonceStore } from 'ai-rag-engine';

const redis = new Redis(process.env.CONFIRMATION_REDIS_URL!, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
});
// client ready olduktan sonra engine'i oluşturun; hata ve shutdown yaşam döngüsünü host yönetsin.
const engine = new RAGEngine({
    llmProvider, inputs, tools,
    confirmation: {
        secret: process.env.CONFIRMATION_SECRET!,
        nonceStore: new RedisConfirmationNonceStore(redis)
    }
});
```

## Açık kalan geliştirme önerileri ve iddia sınırları

Rapordaki pgvector/Qdrant, reranker, parent-child retrieval, NLI/LLM-as-judge, etiketli TR/EN veri seti, OpenTelemetry, tenant kotaları, durable agent state ve framework adapter'ları yeni ürün/yol haritası çalışmalarındandır; bu düzeltmede uygulanmadı. `topK`, `minRelevanceScore`, document deletion ve sources document ID'leri zaten mevcut; bunlar hiç yokmuş gibi yeniden eklenmedi. MinRelevanceScore'un her retrieval stratejisindeki etkinliği ve tam citation kalitesi ayrıca ölçülmelidir.

Redis cache adaptörünün mevcut bellek fallback'i için instance'lar arasında kesinti/invalidation tutarlılığı bu nonce testiyle kanıtlanmaz. Onay deposu cache adaptörünün fallback yolunu kullanmaz. Tenant bazlı olmayan operasyon metriklerinin paylaşımı yalnızca yetkilendirilmiş operasyon rolleri içindir.

Rakip karşılaştırmaları, 6/10 production puanı, Recall@5 iyileşmesi, %90 faithfulness ve üretim p95 hedefleri bu çalışmada doğrulanmış ölçümler değildir. Tam penetrasyon testi, dış LLM kalite değerlendirmesi veya eş donanımda rakip benchmark'ı yapılmadı. Bağımlılık audit'inin sıfır sonucu tüm kaynak kodun açık içermediği anlamına gelmez.

Teknik referanslar: [JWT BCP / RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html), [Redis SET NX PX](https://redis.io/docs/latest/commands/set/).
