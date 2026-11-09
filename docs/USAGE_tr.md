# SDK Kullanım ve Operasyon Kılavuzu

## Çalışma Zamanı ve Modül Sözleşmesi

Yayınlandıktan sonra `@denizsevinc/ai-rag-engine` paketini, yayın öncesinde ise yerel `.tgz` dosyasını kurun. ESM kullanın (uygulamada `"type": "module"`). CommonJS `require()` desteklenen bir sözleşme değildir; CommonJS uygulamaları dinamik `import()` kullanabilir. Node.js 22.14+ gereklidir (test matrisi Node 22 ve 24'tür). TypeScript 5.8+ önerilir; `NodeNext` ve `Bundler` çözünürlükleri katı kontrollerle test edilmiştir. `skipLibCheck` zorunlu değildir. Desteklenen export'lar root API ve `./package.json`'dur.

Kütüphane asla otomatik olarak `.env` yüklemez. Kütüphaneyi import etmek sunucu başlatmaz, veritabanı veya Redis bağlantısı açmaz ve model indirmez. Transformers kütüphanesi ilk embedding çağrısında tembelce (lazily) yüklenir.

## Yaşam Döngüsü ve Varsayılanlar

`RAGEngine`'i `llmProvider` ve `inputs` ile başlatın. `init()` idempotanttır. Varsayılan SML MiniLM modelini yükler; yerel yönlendirme kullanmayan adaptörlerde `smlConfig: { enabled: false }` ayarlayın. Varsayılan cache `./data/query-cache.json` dosyasını kullanır. Yeni oluşturulan dosyalar POSIX üzerinde `0600` izinleriyle yazılır.

`LocalFaqAdapter()` başlangıçta boştur; verileri `setFaqs()` ile verin veya açık bir `filePath` belirtin.

## LLM Sağlayıcı Yapılandırması

```js
import { RAGEngine, CustomLLMAdapter } from '@denizsevinc/ai-rag-engine';

const provider = new CustomLLMAdapter({
  endpoint: 'http://127.0.0.1:8000/v1/chat/completions',
  model: 'your-deployed-model'
});

const engine = new RAGEngine({
  llmProvider: provider,
  inputs: {},
  smlConfig: { enabled: false },
  cache: { enabled: false }
});
```

Diğer kurucular: `new OpenAIAdapter(apiKey, model)`, `new GeminiAdapter(apiKey, model)`, `new OllamaAdapter({ host, model })`. `FallbackLLMProvider` sıralı yedekleme sunar; `TieredLLMProvider.createFromEnv()` hızlı ve akıllı model zincirleri oluşturur. HTTP çağrılarını sınırlamak için `LLM_TIMEOUT_MS` (varsayılan 30000) yapılandırın.

## Yerel Embedding, SSS ve Yönlendirme

```js
import { SMLEngine, LocalFaqAdapter } from '@denizsevinc/ai-rag-engine';

const embeddings = new SMLEngine({
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './models',
  localFilesOnly: false // Çevrimdışı kullanım için true
});

const faq = new LocalFaqAdapter({ smlEngine: embeddings });
await faq.setFaqs([
  { id: 'support', question: 'Destek saatleri nedir?', answer: 'Hafta içi 09:00 - 18:00.', tenantId: 'acme' }
]);
```

## Vektör Deposu ve Arama

```js
import { PostgresVectorAdapter, RAGEngine } from '@denizsevinc/ai-rag-engine';

const vectors = new PostgresVectorAdapter({
  connectionString: process.env.DATABASE_URL,
  tableName: 'rag_documents',
  modelName: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
  autoMigrate: false
});

await vectors.init();
await vectors.addDocuments([{ id: 'policy', content: 'İade süresi 14 gündür.', metadata: { tenantId: 'acme' } }]);

const engine = new RAGEngine({
  llmProvider: provider,
  inputs: { vectorStore: vectors },
  smlConfig: { enabled: false },
  cache: { enabled: false },
  retrieval: { strategy: 'hybrid', topK: 3 }
});

const answer = await engine.query('İade politikası nedir?', { tenantId: 'acme', userId: 'u1', roles: ['viewer'] });
await vectors.close();
```

## Güvenli Tool Yönetimi ve Tenant Bağlamı

```ts
import { z } from 'zod';
import type { IAgentTool } from '@denizsevinc/ai-rag-engine';

const reserve: IAgentTool<{ sku: string }> = {
  name: 'reserve_item',
  description: 'Müşteri için stok rezervasyonu yapar',
  parameters: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
  zodSchema: z.object({ sku: z.string().min(1) }),
  requiredRoles: ['editor'],
  isMutating: true,
  async execute(args, context) {
    return { sku: args.sku, tenantId: context?.tenantId };
  }
};
```

Mutasyon gerektiren tool'lar için dönen `confirmationRequests` kullanıcıya sunulmalı ve onay alındıktan sonra istek `context.confirmationTicket` ile yinelenmelidir.
