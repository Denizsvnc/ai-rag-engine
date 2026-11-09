# Kalıcı işlem kuyruğu ve bağımsız kullanıcı testi

9 Kasım 2026. Bu aşama worker/kuyruk eksiklerini tamamlar. OCR, etiketli TR/EN retrieval benchmark'ı ve reranker seçimi ayrı ürün çalışmalarıdır.

## Çalışma modeli

API yalnızca producer'dır. Upload önce PostgreSQL bytea alanına ve iş ledger/outbox kaydına transaction ile yazılır; Redis'e sadece tenant ve job referansı gönderilir. Ayrı `ai-rag-worker` süreci ortak dosyayı okuyup checksum ve dosya güvenliğini denetler, PII maskelemesini chunking öncesinde yapar ve gerçek embedding üretir. `/tmp` dosya paylaşımı gerekmez.

PostgreSQL kaydından sonra Redis dispatch başarısız olursa upload `pending` kalır. Çalışan worker outbox'ı periyodik tarayıp kuyruğa alır. Redis işi kaybolsa bile pending/queued/processing kayıtlar yeniden dispatch edilir. BullMQ teslimatı en az bir keredir; tam bir kez teslimat iddiası yoktur. Document manifesti ve transaction içindeki replace işlemi tekrarlanan yazımın etkisini idempotent yapar. Eski belge sürümü yenisinin üzerine yazamaz; küçülen belgelerin eski chunk'ları temizlenir. Aynı transaction içindeki tenant revision artışı cache anahtarını değiştirir.

- `Idempotency-Key` aynı tenant ve aynı payload için aynı işi verir; farklı payload 409 döndürür. Anahtar yoksa aynı belgenin son aynı içeriği dedup edilir. A → B → A ayrı sürümlerdir.
- Varsayılan 3 deneme, üstel bekleme; global concurrency 4, worker başına 2.
- Başarısız işler BullMQ failed kümesinde tutulur (7 gün / en fazla 10.000). PostgreSQL sonuç ledger'ı kalır. Başarılı upload'ın raw içeriği silinir; başarısız raw içerik 7 gün sonra silinir. Ledger/manifest büyümesi için işletimsel arşiv politikası gerekir.
- `POST /api/ingest/status/:jobId/retry` yetkili tenant için retained başarısız işi tekrar dener. Süresi dolan payload yeniden yüklenmelidir.
- Varsayılan upload limiti 5 MiB, tenant başına 100 bekleyen iş ve 50 MiB retained raw içerik. Redis Lua rate limit tenant başına dakikada 120 istek; limiter arızası 503 döndürür.
- SIGTERM/SIGINT aktif işleri drain eder; varsayılan shutdown deadline 30 saniyedir. Zorla kapanan süreçlerin işleri BullMQ lock/stall mekanizmasıyla geri alınır.
- PDF için mevcut metin çıkarıcısı sınırlıdır; extractable text bulunmayan PDF açıkça başarısız olur. OCR varmış gibi boş placeholder indekslenmez.

## Kaynak checkout kurulumu

Önce `npm ci` ve `npm run build`. PostgreSQL pgvector ve Redis gerekir. Migration için DDL yetkili bağlantıyla:

```sh
DATABASE_URL=postgresql://owner:password@localhost/rag npm run db:migrate
```

Migration'a `RUNTIME_DB_USER` ve 32+ karakter `RUNTIME_DB_PASSWORD` verilirse rol oluşturulur ve gerekli sınırlı grant'ler uygulanır; var olan rolün şifresi değiştirilmez. Runtime rolü schema DDL yetkisi almaz. SQL doğrudan erişiminde tenant RLS sağlanmaz; API/SDK tenant bağlamı güvenilen kimlikten gelmelidir.

API ve worker için ortak ayarlar:

```dotenv
NODE_ENV=production
VECTOR_STORE=postgres
VECTOR_AUTO_MIGRATE=false
INGESTION_QUEUE=bullmq
DATABASE_URL=postgresql://runtime:password@localhost/rag
REDIS_URL=redis://localhost:6379
JWT_SECRET=<bağımsız-rastgele-32+-karakter>
CONFIRMATION_SECRET=<başka-rastgele-32+-karakter>
PRIVATE_LLM_ENDPOINT=http://localhost:8000/v1/chat/completions
```

```sh
npm start
# Ayrı terminal/süreç:
npm run start:worker
```

npm tarball tüketicisinde aynı komutlar `npx ai-rag-migrate`, `npx ai-rag-server`, `npx ai-rag-worker` olur. SDK'da `PostgresIngestionStore`, `QueuedIngestionService`, `IngestionWorker` ve `BullMQJobQueue` dışa aktarılır; `engine.ingestion.backend` üzerinden bağlanır.

`INGESTION_QUEUE_NAME`, `INGESTION_TABLE_NAME`, `VECTOR_TABLE_NAME` değerleri API/worker/migration arasında aynı olmalıdır. Embedding modeli ve boyut migration ile aynı olmalı; değişimde yeni tablolarla reindex gerekir. `.env.example` limitleri gösterir. Development bellek modu tek süreç içindir; restart dayanıklılığı sağlamaz.

Compose API, worker, migration, Redis ve pgvector'u birlikte tanımlar. `.env` içinde JWT/confirmation secret'ları ile bağımsız `POSTGRES_PASSWORD` ve `RUNTIME_DB_PASSWORD` belirleyin; URL güvenliği için rastgele hex şifre kullanın. Sonra `docker compose up --build -d`. Redis AOF/noeviction kullanır; işletimde yedekleme ve disk/Redis kapasitesi izlenmelidir. API portu localhost'a bağlıdır. Bu oturumda Docker daemon çalışmadığından gerçek container çalıştırması yapılmadı; Compose config doğrulandı.

## Doğrulama kanıtı

Yerel ortam: Node 24.22.1, PostgreSQL 18.3/pgvector, Redis 8.6.2. Tam otomatik paket: **183 test, 24 suite, 0 hata, 0 skip**. Gerçek servislerle quota, tenant sınırları, dispatch arızasından outbox kurtarma, retry/manual retry, post-commit tekrar, sürüm yarışları, global worker limiti ve shutdown drain kapsanır. Güvenlik bulguları için [security-review.md](security-review.md).

`npm run test:consumer`, `npm pack` çıktısını bağımsız geçici projeye kurar; NodeNext strict/skipLibCheck:false typecheck ve dört dağıtım dosyasının byte eşitliğini denetler. API ve worker farklı Node süreçlerinde, migration'dan ayrı sınırlı DB rolüyle çalışır. Kaynak TS import edilmez. Gerçek MiniLM embedding ve yerel `Xenova/flan-t5-small` q8 üretimi kullanılır; sabit/mock LLM cevabı verilmez. Sentetik İngilizce test fixture'ları kullanılır; bu, geniş kapsamlı dil/cevap kalitesi ölçümü değildir.

```sh
PG_TEST_URL=postgresql://postgres:test@localhost/rag_test \
REDIS_TEST_URL=redis://localhost:6379 npm run test:consumer
```

Bu komut yalnızca disposable servislerde çalıştırılmalı; kendi rastgele adlandırdığı tabloları, rolü ve Redis anahtarlarını temizler. Model indirmesi için ağ gerekir. CI Node 22 job'ına bu test eklendi; GitHub Actions bu oturumda çalıştırılmadı.

Bu oturumda başarılı bağımsız proje:
`/var/folders/f4/99_bl5gd1qq0qq4zwhdd09nc0000gn/T/rag-consumer-lhYGnu`

Projedeki `verification.json` 11 başarılı kontrolü kaydeder: migration CLI, sınırlı runtime rolü, auth, worker başlamadan upload/idempotency/tenant sınırı, gerçek RAG cevabı, cache hit, replace sonrası cache revision, işlem ortasında SIGKILL/restart, zararlı upload reddi, API restart sonrası durum ve public SDK FAQ akışı.

Makinedeki boş alan az olduğu için yalnızca bağımlılık dosyaları APFS copy-on-write ile başlangıçta çoğaltıldı (`CONSUMER_SEED_MODULES`). npm gerçek SDK tarball'ını kurdu, gereksiz paketleri prune etti ve bağımsız dosya yollarını kullandı; kaynak klasörüne symlink/import yoktu. Normal CI kurulumu seed kullanmaz. Önceki dış disk denemeleri bozulan bağımlılık dosyaları nedeniyle başarısızdı; başarı kanıtı yerel APFS projesine aittir.
