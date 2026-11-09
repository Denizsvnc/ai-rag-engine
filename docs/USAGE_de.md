# SDK Nutzungs- und Betriebsanleitung

## Laufzeit und Modulspezifikation

Installieren Sie nach der Veröffentlichung `@denizsevinc/ai-rag-engine` oder vorab das lokale `.tgz`-Paket. Verwenden Sie ESM (`"type": "module"`). CommonJS `require()` wird nicht unterstützt; CommonJS-Anwendungen können dynamisches `import()` nutzen. Node.js 22.14+ ist erforderlich (Testmatrix: Node 22 und 24). TypeScript 5.8+ wird empfohlen; `NodeNext` und `Bundler` werden strikt unterstützt.

Die Bibliothek lädt niemals automatisch `.env`-Dateien und erzeugt beim Import keine Hintergrundprozesse, Datenbankverbindungen oder Modelldownloads.

## Initialisierung und Konfiguration

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

## Lokale Embeddings, FAQ und semantisches Routing

```js
import { SMLEngine, LocalFaqAdapter } from '@denizsevinc/ai-rag-engine';

const embeddings = new SMLEngine({
  modelName: 'Xenova/all-MiniLM-L6-v2',
  cacheDir: './models',
  localFilesOnly: false
});

const faq = new LocalFaqAdapter({ smlEngine: embeddings });
await faq.setFaqs([
  { id: 'support', question: 'Wann ist der Support erreichbar?', answer: 'Werktags 09:00 - 18:00 Uhr.', tenantId: 'acme' }
]);
```

## Persistente Vektoren mit PostgreSQL

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
await vectors.addDocuments([{ id: 'policy', content: 'Rueckgabefrist betraegt 14 Tage.', metadata: { tenantId: 'acme' } }]);

const engine = new RAGEngine({
  llmProvider: provider,
  inputs: { vectorStore: vectors },
  smlConfig: { enabled: false },
  cache: { enabled: false },
  retrieval: { strategy: 'hybrid', topK: 3 }
});

const answer = await engine.query('Wie lange ist die Rueckgabefrist?', { tenantId: 'acme', userId: 'u1', roles: ['viewer'] });
await vectors.close();
```

