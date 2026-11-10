<div align="center">

<img src="https://raw.githubusercontent.com/Denizsvnc/ai-rag-engine/main/assets/logo.jpg" alt="AI-RAG-ENGINE" width="380" style="max-width: 100%; height: auto; border-radius: 12px; margin-bottom: 16px;" />

**Değiştirilebilir LLM ve vektör adaptörleri, yerel semantik FAQ/tool yönlendirme, tenant bağlamı ve dayanıklı doküman alımı sağlayan Node.js/TypeScript RAG kütüphanesi.**

[![Sürüm](https://img.shields.io/badge/npm-@denizsvnc/ai--rag--engine-6C5CE7?logo=npm&logoColor=white)](https://www.npmjs.com/package/@denizsvnc/ai-rag-engine)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![CI](https://github.com/Denizsvnc/ai-rag-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Denizsvnc/ai-rag-engine/actions)
[![Lisans](https://img.shields.io/badge/Lisans-MIT-blue.svg)](LICENSE)

---

### 🌐 Dokümantasyon Dilleri

**[English](README.md)** • **[Türkçe](README_tr.md)** • **[Deutsch](README_de.md)**

---

</div>

`@denizsvnc/ai-rag-engine@2.2.0` resmi olarak npm üzerinde yayımlanmıştır. ESM ve Node.js 22.14+ gereklidir. Bellek adaptörleri yeniden başlatmada veriyi korumaz. Model ağırlıkları pakete dahil değildir; embedding kullanımı ilk çalıştırmada yerel cache yoksa indirme gerektirebilir. Güvenlik filtreleri savunma katmanıdır; her türlü saldırının veya kişisel verinin %100 tespitini matematiksel olarak garanti etmez.

## Gereksinimler ve Kurulum

ESM zorunludur. Node.js **22.14 veya üzeri**; uyumluluk matrisi Node 22 ve 24'ü kapsar. TypeScript kullanıcıları NodeNext veya Bundler çözünürlüğü ile TypeScript 5.8+ kullanmalıdır.

```sh
npm install @denizsvnc/ai-rag-engine
```

## Hızlı Başlangıç (Quick Start)

Dış bağımlılık, model indirme veya veritabanı gerektirmeyen deterministik test örneği:

```js
import { RAGEngine } from '@denizsvnc/ai-rag-engine';

const engine = new RAGEngine({
  smlConfig: { enabled: false },
  cache: { enabled: false },
  inputs: {
    vectorStore: {
      async search(_query, _topK, filter) {
        if (filter?.tenantId !== 'demo') return [];
        return [{ id: 'iade', content: 'İadeler 14 gün içinde kabul edilir.' }];
      }
    }
  },
  llmProvider: {
    async generate({ systemPrompt }) {
      return { content: systemPrompt.includes('14 gün') ? 'İade süresi: 14 gündür.' : 'Bilinmiyor.' };
    }
  }
});

await engine.init();
const result = await engine.query('İade süresi kaç gündür?', {
  tenantId: 'demo', userId: 'demo-user', roles: ['viewer']
});
console.log(result.answer); // İade süresi: 14 gündür.
```

### Kurumsal Üretim Örneği (Gemini, pgvector & Redis)

Harici LLM, kalıcı PostgreSQL vektör deposu ve dağıtık Redis önbelleği ile üretim örneği:

```ts
import {
  RAGEngine,
  GeminiAdapter,
  PostgresVectorAdapter,
  RedisCacheAdapter,
  LocalFaqAdapter
} from '@denizsvnc/ai-rag-engine';

const engine = new RAGEngine({
  // 1. LLM Sağlayıcısı (Gemini, OpenAI, Ollama veya Özel API)
  llmProvider: new GeminiAdapter(
    process.env.GEMINI_API_KEY,
    'gemini-1.5-flash'
  ),

  // 2. Bilgi Getirimi & Semantik FAQ Eşleme
  inputs: {
    vectorStore: new PostgresVectorAdapter({
      connectionString: process.env.DATABASE_URL,
      tableName: 'enterprise_embeddings'
    }),
    faq: new LocalFaqAdapter({
      filePath: './faq.json',
      defaultMatchThreshold: 0.65
    })
  },

  // 3. Dağıtık Önbellek & Güvenlik Duvarı
  cache: {
    enabled: true,
    adapter: new RedisCacheAdapter({
      url: process.env.REDIS_URL,
      defaultTtlMs: 3600000 // 1 saat
    })
  },
  security: {
    enabled: true,
    blockHighRiskInjections: true,
    pii: {
      enabled: true,
      maskTCKN: true,
      maskCreditCards: true,
      maskEmails: true
    }
  }
});

// Kiracı izolasyonu ve RBAC yetkileriyle sorgulama
const response = await engine.query('3. çeyrek denetim raporu özeti nedir?', {
  tenantId: 'tenant-acme',
  userId: 'usr_8472',
  roles: ['compliance_officer']
});

console.log(response.answer);
console.log('Intent:', response.intent);
console.log('Latency (ms):', response.latencyMs);
console.log('Kaynaklar:', response.sources);
```

## Dokümantasyon

- [Yapılandırma, Sağlayıcılar, Vektörler ve Sorun Giderme](docs/USAGE_tr.md)
- [Sürüm Yönetimi ve Yayın Kontrol Listesi](docs/RELEASING_tr.md)
- [Değişiklik Günlüğü (Changelog)](CHANGELOG.md)
- [Yayın Hazırlığı ve Kalite Raporu](docs/NPM_RELEASE_READINESS_tr.md)
