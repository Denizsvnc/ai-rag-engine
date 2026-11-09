# Kalıcı veri katmanı ve cache düzeltmeleri

9 Kasım 2026. Önceki güvenlik düzeltmelerinin üzerine uygulanan ilk iki geliştirme aşaması.

## Cache ve metrik davranışı

RedisCacheAdapter artık Redis yapılandırıldığında yerel cevap kopyası tutmaz. Bağlantı kesilince varsayılan davranış cache miss ve atlanan cache yazımıdır; canlı sorgu yolu çalışmaya devam edebilir. `enableFallbackMemory: false` Redis okuma/yazma hatalarını çağırana iletir. Redis tanımlanmamışsa mevcut yerel LRU modu kullanılabilir. `delete`, `invalidate` ve `clear` başarısızlığı her durumda hata üretir: ortak cache silinmediyse başarı bildirilmez.

- Regex invalidation uzak Redis anahtarlarını da siler. Global/sticky regex'in lastIndex durumu çağrılar arasında taşınmaz, verilen RegExp değiştirilmez.
- String keyword eşleştirmesi büyük/küçük harfe duyarsızdır. `*` ve `?` içeren string'ler namespace içinde tam wildcard eşleştirmesi yapar; diğer karakterler literaldir.
- Anahtarlar önce SCAN ile gezilir; KEYS yalnızca SCAN sağlamayan özel istemciler için uyumluluk yoludur. Silme komutları en fazla 100 anahtar içerir. Başka namespace anahtarları silinmez.
- SCAN bir transaction snapshot'ı değildir. Eşzamanlı stale cevap üretip yeniden cache'e yazan producer'lar için uygulama düzeyinde version/generation sözleşmesi ayrıca gerekir. Bu değişiklik Redis replikasyon/failover garantisi oluşturmaz.
- Özel Redis istemci sözleşmesi ioredis biçimindedir; node-redis istemcisi doğrudan aynı komut imzalarına sahip değildir.
- `size()` yalnızca yerel LRU sayısını verir; uzak Redis anahtar sayısı değildir.

Latency `_sum` artık ölçümlerin gerçek toplamı, `_count` aynı yaşam döngüsünün ölçüm sayısıdır. Kayan p50/p95/p99 penceresinin eski ölçümleri atması toplamı değiştirmez. NaN, Infinity ve negatif latency ölçümleri sayaçlara eklenmeden reddedilir. Reset hem toplamları hem histogram bucket'larını sıfırlar.

Yeni `rag_query_duration_seconds` histogramı instance'lar arasında birleştirilebilir. Örneğin Prometheus'ta p95:

```promql
histogram_quantile(0.95, sum by (le) (rate(rag_query_duration_seconds_bucket[5m])))
```

Mevcut `rag_latency_ms` summary korunur; instance quantile değerlerini ortalamak global quantile vermez. EngineMetricsSummary.latency tipine sumMs, count, p99Ms ve buckets eklendi; elle telemetry fixture üreten entegrasyonlar bunları sağlamalıdır.

## PostgreSQL / pgvector

`PostgresVectorAdapter` kalıcı yoğun vektör araması ve PostgreSQL full-text + dense RRF hybrid retrieval sağlar. Full-text dalı PostgreSQL `simple` sözlüğünü kullanır; BM25 veya Türkçe dilbilimsel analiz değildir. Varsayılan vektör araması exact'tir; `createHnswIndex: true` ile approximate indeks migration sırasında açılabilir. Filtreli approximate aramada recall ayrıca ölçülmelidir.

Her arama, silme ve clear işlemi açık, dolu bir `filter.tenantId` ister; eksik bağlam reddedilir. Eklenecek belgelerde metadata.tenantId zorunludur. `(tenant_id, id)` primary key sayesinde aynı ID başka tenant'ta bağımsızdır. Metadata filtreleri parametrik JSONB containment ile uygulanır. SDK filtrelerini yalnızca doğrulanmış server context'ten üretin; adaptör kendi başına kimlik doğrulamaz. SQL kullanıcısının doğrudan veritabanı erişimi için tenant bazlı RLS sağlandığı iddia edilmez.

`addDocuments` aynı tenant/ID için upsert yapar. İçerik, metadata veya vektör değiştiğinde version artar; aynı veriyle tekrar yazma version'ı artırmaz. Bir batch'in SQL yazımları tek transaction'dır; hata olursa tüm batch geri alınır. Bellek adaptörü de tenant/ID upsert ve filtreli delete/clear destekler. BM25 ve fusion içinde tenant'lar arası ID çakışması giderildi.

Model adı ve boyut bilgisi ayrı config tablosunda tutulur. Model/boyut uyuşmazlığı başlangıçta reddedilir. Model değişiminde yeni tableName ile yeniden indeksleyip doğruladıktan sonra geçiş yapın; eski vektörler yeni modelle sessizce karşılaştırılmaz. Özel embeddingProvider verildiğinde modelName etiketinin gerçek modele karşılık gelmesi entegrasyonun sorumluluğudur.

## Kurulum ve migration

PostgreSQL ve pgvector eklentisi gerekir. Kaynak checkout'ta:

```sh
npm ci
# DATABASE_URL'ı migration yetkili kullanıcıyla tanımlayın.
npm run build
npm run db:migrate
```

Migration `CREATE EXTENSION vector`, tablolar ve indeksleri oluşturur; extension/DDL yetkileri gerekir. Uygulamayı migration kullanıcısıyla çalıştırmayın. Runtime rolü için schema USAGE, config tablosunda SELECT; doküman, epochs, manifests ve ingestion tablolarında DML gerekir. Migration CLI isteğe bağlı RUNTIME_DB_USER/PASSWORD ile sınırlı rolü oluşturup gerekli grant işlemlerini yapar. Runtime rolünün şema değiştiremediği gerçek PostgreSQL testiyle doğrulandı.

Hazır sunucu ayarları:

```dotenv
VECTOR_STORE=postgres
DATABASE_URL=postgresql://runtime_user:password@localhost:5432/rag_db
VECTOR_TABLE_NAME=rag_documents
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
EMBEDDING_DIMENSIONS=384
VECTOR_AUTO_MIGRATE=false
```

Mevcut JWT ve confirmation secret gereksinimleri de geçerlidir. VECTOR_STORE verilmezse yerel geliştirme için memory kullanılır; bilinmeyen değer reddedilir. Postgres seçiliyken bağlantı/schema/model hatası bellek adaptörüne geri düşmez. Model ve boyut migration ile runtime'da aynı olmalıdır. Üretimde güvenilen CA ile TLS/SSL kullanan bir Pool veya bağlantı yapılandırması sağlayın; bu değişiklik sertifika doğrulamasını kapatmaz.

SDK kullanımında `new PostgresVectorAdapter({ connectionString, autoMigrate: false })` veya hazır `pool` verilebilir. Sahip olduğu pool'u `close()` kapatır; enjekte edilen pool'un yaşam döngüsü host'a aittir. Schema public search_path üzerinden kullanılır; migration ve runtime aynı veritabanı/schema bağlamını kullanmalıdır.

Durable ingestion artık sabit documentId, sürüm manifesti ve transaction içinde stale chunk silme sağlar. Tenant epoch aynı transaction içinde artar; engine cache anahtarına revision eklenir. Ayrı worker yazımları eski cevap cache'ini geçersiz kılar. [Worker kurulumu ve doğrulama](durable-ingestion.md).

## Doğrulama ve devam sırası

İlk iki aşamanın sonucu: **169/169 test**, 24 suite, 0 hata ve 0 skip. Typecheck, build, mevcut smoke benchmark ve git diff --check başarılı; bağımlılık audit'i 0 bilinen açık bildirdi. Smoke benchmark üretim HTTP/LLM yük testi değildir. Docker daemon çalışmadığından container runtime ve GitHub Actions sonuçları doğrulanmadı.

- Test ortamı Node 24.22.1, Redis 8.6.2, PostgreSQL 18.3 ve yerel pgvector. CI PostgreSQL 17 pgvector servisiyle yapılandırıldı; GitHub Actions bu yerel oturumda çalıştırılmadı.
- Gerçek Redis ve bağımsız Node süreciyle invalidation; bağlantı kapandığında stale yerel cevap dönmemesi.
- Gerçek pgvector ile eşzamanlı schema init, upsert/version, tenant/metadata filtreleri, SQL injection negatifleri, batch rollback, HNSW oluşturma, sınırlı runtime rolü ve engine retrieval akışı.
- Yeni Node sürecinden okuma yanında, geçici PostgreSQL tamamen yeniden başlatıldı ve belge tekrar okundu. Test için kullanıcının mevcut veritabanı durdurulmadı.
- Otomatik testlerde PG_TEST_URL veya REDIS_TEST_URL verilmezse ilgili gerçek servis testleri skip edilir; CI iki değişkeni de sağlar.

```sh
PG_TEST_URL=postgresql://postgres:test-only-password@localhost:5432/rag_test \
REDIS_TEST_URL=redis://localhost:6379 npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

Sonraki worker aşaması idempotency/ledger, tenant kota/rate limit ve sağlayıcı timeout eksiklerini tamamlar; bkz. durable-ingestion.md. TR/EN etiketli retrieval baseline ve ölçüme göre model/reranker seçimi ayrı ürün çalışması olarak devam eder.

Referanslar: [Redis SCAN](https://redis.io/docs/latest/commands/scan/), [Prometheus histogramları](https://prometheus.io/docs/practices/histograms/), [pgvector](https://github.com/pgvector/pgvector), [node-postgres transaction](https://node-postgres.com/features/transactions).
