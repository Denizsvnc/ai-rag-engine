<div align="center">

<img src="assets/logo.jpg" alt="AI-RAG-ENGINE Logosu" width="160" style="border-radius: 28px; box-shadow: 0 12px 40px rgba(124, 108, 245, 0.45); margin-bottom: 16px;" />

# ⚡ AI-RAG-ENGINE

**Süreç İçi SML Niyet Yönlendirmesi, Sıfır-Token Anlamsal SSS Önbelleklemesi, Çok Katmanlı LLM Yedeklemesi ve OWASP Prompt Enjeksiyonu Savunmasına Sahip Kurumsal Agentic RAG Mimarisi.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-all--MiniLM--L6--v2_(q8)-FF5722?logo=onnx&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![Tests](https://img.shields.io/badge/Tests-36%2F36_Geçti-success?logo=checkmarx&logoColor=white)](test/)
[![Security](https://img.shields.io/badge/OWASP-Prompt_Injection_Korumalı-blueviolet?logo=shield&logoColor=white)](#3-️-owasp-prompt-enjeksiyonu--ziyaretçi-güven-sınırı)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

### 🌐 Dil / Language / Sprache

**[English](README.md)** • **[Türkçe](README_tr.md)** • **[Deutsch](README_de.md)**

---

</div>

## 📌 Yönetici Özeti (Executive Summary)

Modern kurumsal uygulamalarda kullanıcıdan gelen her ham sorunun doğrudan pahalı, yavaş ve deterministik olmayan bulut LLM'lerine gönderilmesi sürdürülemez maliyetlere, 2-5 saniyelik gecikmelere, veri gizliliği ihlallerine ve prompt injection (komut enjeksiyonu) açıklarına yol açar.

**AI-RAG-ENGINE**, bu darboğazları aşmak için **maliyeti en aza indiren ve güvenlik katmanlarıyla güçlendirilmiş bir şelale (waterfall) mimarisi** sunar:

1. **🛡️ 1 ms OWASP Güvenlik Kalkanı:** Jailbreak, sistem istemi sızdırma ve rol geçersiz kılma girişimlerini herhangi bir LLM çağrılmadan önce anında bertaraf eder.
2. **💾 2 ms LRU & Disk Önbelleği:** Daha önce sorulmuş ve önbelleğe alınmış soruları bellekten veya diskten anında yanıtlar.
3. **🎯 5 ms Sıfır-Token Anlamsal SSS (FAQ):** Farklı kelimelerle ifade edilmiş kullanıcı sorularını yerel 384 boyutlu vektör nokta çarpımı (dot-product) ile eşleştirir (**0 LLM token maliyeti**).
4. **🧠 Süreç İçi Semantik Model Katmanı (SML):** Kuantize edilmiş ONNX modeli (`all-MiniLM-L6-v2`) ile CPU üzerinde harici hiçbir API'ye ihtiyaç duymadan 15 ms altında niyet sınıflandırması ve araç yönlendirmesi yapar.
5. **🔀 Çok Katmanlı LLM ve Otomatik Yedekleme (Failover):** Rutin soruları **Hızlı LLM**'lere (`gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2`), derin akıl yürütme gerektiren soruları ise **Akıllı LLM**'lere (`gpt-4o`, `deepseek-r1`, `gemini-1.5-pro`) yönlendirir; olası kesintilerde sağlayıcılar arasında otomatik geçiş yapar.
6. **🔒 %100 Kurum İçi (On-Premise) Gizlilik Modu:** **Ollama**, **vLLM**, **TGI** ve şirket içi özel VPC uç noktaları için yerleşik adaptörler sunar; `ALLOW_PUBLIC_OPENSOURCE_LLM=false` ayarı ile şirket verilerinin dışarı sızmasını engeller.

---

## 🏛️ Sistem Mimarisi

### 1. İstek Yaşam Döngüsü (Request Lifecycle Waterfall)
*Gelen her sorgu daima en ucuz ve en güvenli yolu izler. Harici LLM'ler yalnızca yerel katmanların yanıtlayamadığı durumlarda devreye girer.*

<div align="center">

![AI-RAG-ENGINE İstek Yaşam Döngüsü](assets/pipeline.svg)

</div>

---

### 2. Entegrasyon Topolojisi ve Uç Noktalar (Integration Topology)
*REST uç noktaları ile bağımsız bir mikroservis olarak çalıştırabilir veya Node.js / Express projelerinize doğrudan bir kütüphane olarak entegre edebilirsiniz.*

<div align="center">

![AI-RAG-ENGINE Entegrasyon Topolojisi](assets/endpoints.svg)

</div>

---

### 3. Yerel SML Karar ve İş Yürütme Mekanizması (Derinlemesine Bakış)
*AI-RAG-ENGINE'in süreç içi 384 boyutlu ONNX vektör nokta çarpımı ve deterministik eşik kapısı ile pahalı ve yavaş bulut LLM araç yönlendirmesini nasıl ortadan kaldırdığı:*

<div align="center">

![AI-RAG-ENGINE Yerel SML Karar ve İş Mekanizması](assets/sml-mechanism.svg)

</div>

---

## ✨ Öne Çıkan Mühendislik Yetenekleri

### 1. 🧠 Süreç İçi Semantik Model Katmanı (SML) ve Deterministik Araç Yönlendirmesi
* **Mimarideki Kritik Sorun:** Geleneksel Agentic çerçeveler (LangChain, CrewAI, AutoGen vb.) kullanıcı sorusunu ve yüzlerce satırlık JSON araç şemasını uzak bulut LLM'ine (GPT-4 / Claude) göndererek *"Hangi aracı çalıştırmalıyım?"* diye sorar. Bu yöntem tek bir araç çalıştırmak için bile **800–2.000 token harcar** ve **1.5–3.0 saniye ağ gecikmesi** yaratır.
* **SML Çözümü:** *Niyet Yönlendirmesi* ile *Metin Üretimini* birbirinden ayırır. `@huggingface/transformers` ile kuantize edilmiş `Xenova/all-MiniLM-L6-v2 (q8)` modelini doğrudan Node.js sürecinde CPU üzerinde çalıştırır (< 15MB RAM, ~8–12ms, 0 Token).
* **Önceden Hesaplanmış Vektör Kaydı:** Tanımlı tüm araçların açıklamaları için 384 boyutlu normalleştirilmiş birim vektörleri ($\vec{t}_i$) önceden hesaplar ve `src/utils/tools-registry.json` dosyasında saklar.
* **Matematiksel Karar Kapısı (Decision Gate):**
  $$\text{Benzerlik Skoru} = \vec{q} \cdot \vec{t}_i = \sum_{k=1}^{384} q_k \cdot t_{ik}$$
  * **Dal A ($\text{Skor} \ge 0.50$): Deterministik Araç Eylemi Tetiklenir**
    * Yüksek güvenle niyet eşleşir (örn. `check_live_stock` skoru `0.78`).
    * Hızlı LLM katmanı yalnızca parametre JSON'ını ayıklar (`{ productName: "laptop" }`).
    * Yerel fonksiyon (`tool.execute(args)`) doğrudan canlı PostgreSQL, ERP veya depo API'sini sorgular.
    * Gerçek zamanlı veriler, halüsinasyon riski olmadan doğrudan bağlama enjekte edilir.
  * **Dal B ($\text{Skor} < 0.50$): Standart Vektör Aramasına Geçiş**
    * Herhangi bir işlem aracı eşleşmediğinde akış kesintisiz olarak doküman/vektör alma aşamasına aktarılır.

### 2. 🎯 Sıfır-Token Anlamsal SSS Motoru (Semantic FAQ)
* **İfade Çeşitliliğine Tolerans:** Farklı şekillerde sorulan soruları (örn. *"iade süresi kaç gün?"* ile *"ürünü ne zamana kadar geri gönderebilirim?"*) semantik olarak kurumsal bilgi tabanı ile eşleştirir.
* **Vektör Nokta Çarpımı:** SIMD dostu hızlı nokta çarpımı (birim vektörlerde kosinüs benzerliği) ve kalibre edilmiş eşik değeri (`>= 0.60`) ile çalışır.
* **Anında Çözüm:** Doğrulanmış kurumsal yanıtları **<10 ms gecikme ve 0 LLM token maliyeti** ile döndürür.

### 3. 🛡️ OWASP Prompt Enjeksiyonu & Ziyaretçi Güven Sınırı
* **Açık Sınırlandırma (Boundary Framing):** Tüm ziyaretçi girdilerini yalıtılmış `<untrusted_visitor_message>` etiketleri arasına alır.
* **Otoriter Güvenlik Talimatları:** LLM'e ziyaretçi metninin denetlenmemiş ham veri olduğunu ve sistem talimatlarını **asla** değiştiremeyeceğini bildiren İngilizce sistem istemleri üretir.
* **Görünmez Unicode ve Kontrol Baytı Temizliği:** Kaçırma saldırılarında sıkça kullanılan sıfır genişlikli karakterleri (`\u200B`, `\uFEFF`, `\u200D`) temizler.
* **Ayırıcı Etiket Nötralizasyonu:** Kullanıcı metnindeki kapanış etiketlerini etkisiz hale getirerek bağlamdan kaçış (context escape) açıklarını engeller.
* **0-Token Sezgisel Engelleyici:** Yüksek riskli saldırı kalıplarını (DAN modları, "ignore previous instructions", developer override denemeleri) LLM'e göndermeden 1 ms içinde engeller.

### 4. 🔀 Çok Katmanlı LLM Sağlayıcısı ve Kurumsal Yedekleme (Failover)
* **Karmaşıklık Tabanlı Yönlendirme:**
  * **Hızlı Katman (Fast Tier)** (`gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2:3b`): Kısa soruları, araç parametresi çıkarımlarını ve genel konuşmaları üstlenir.
  * **Akıllı Katman (Smart Tier)** (`gpt-4o`, `gemini-1.5-pro`, `deepseek-r1:8b`): Çoklu soru içeren, karşılaştırma veya derin analiz gerektiren sorgularda devreye girer.
* **Kademeli Yedekleme (Failover):** Birincil modelde (örn. OpenAI) kota aşımı (`429`) veya ağ hatası oluştuğunda sistem kesintisiz olarak Gemini veya Ollama'ya geçiş yapar.
* **Kurumsal Veri Koruma:** `ALLOW_PUBLIC_OPENSOURCE_LLM=false` ayarı sayesinde şirket verilerinin kontrolsüz açık kaynak yönlendiricilerine sızması önlenir.

### 5. 💾 Çift Katmanlı Kalıcı Önbellek (LRU Cache)
* Bellek içi ultra hızlı LRU önbellek ile disk üzerinde kalıcı JSON depolama (`query-cache.json`) birlikte çalışır.
* Sunucu yeniden başlatılsa bile doğrulanmış önbellek kayıtları korunur.

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
* **Node.js** >= 20.0.0
* **npm** >= 10.0.0

### 1. Kurulum
```bash
# Depoyu klonlayın
git clone https://github.com/Denizsvnc/ai-rag-engine.git
cd ai-rag-engine

# Bağımlılıkları yükleyin
npm install
```

### 2. Ortam Değişkenlerini Yapılandırın
`.env.example` dosyasını `.env` olarak kopyalayın:
```bash
cp .env.example .env
```

#### Senaryo A: Yerel & Özel Kurulum (Ollama / vLLM / Şirket İçi Sunucu)
*Şirket verileriniz yerel ağınızın dışına asla çıkmaz.*
```env
ALLOW_PUBLIC_OPENSOURCE_LLM=false

# Yerel Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL_FAST=llama3.2:3b
OLLAMA_MODEL_SMART=deepseek-r1:8b

# Veya şirket içi OpenAI-uyumlu VPC uç noktası (vLLM, TGI, LocalAI)
CUSTOM_LLM_URL=http://internal-llm-service.corp.local:8000/v1/chat/completions
CUSTOM_LLM_MODEL=meta-llama/Llama-3.2-3B-Instruct
```

#### Senaryo B: Bulut Sağlayıcılar (OpenAI & Google Gemini)
```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_FAST=gpt-4o-mini
OPENAI_MODEL_SMART=gpt-4o

GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Geliştirme Sunucusunu Başlatın
```bash
npm run dev
```
Sunucu yerel ONNX embedding modelini yükler ve `http://localhost:3000` adresinde dinlemeye başlar.

---

## 💻 Kullanım ve Kod Örnekleri

### Örnek 1: Express Middleware Olarak Kullanım
Projelerinize sadece birkaç satır kod ile entegre edebilirsiniz:

```typescript
import express from 'express';
import {
    RAGEngine,
    createRagMiddleware,
    TieredLLMProvider,
    LocalFaqAdapter,
    StaticRulesAdapter
} from 'ai-rag-engine';

const app = express();
app.use(express.json());

// RAGEngine motorunu başlatın
const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv(),
    inputs: {
        rules: new StaticRulesAdapter([
            'Tüm elektronik ürünlerde iade süresi 14 gündür.',
            'Daima kurumsal, nazik ve çözüm odaklı bir üslup kullanın.'
        ]),
        faq: new LocalFaqAdapter({
            filePath: './src/utils/faq-embeddings.json',
            defaultMatchThreshold: 0.60
        })
    },
    security: {
        enabled: true,
        blockHighRiskInjections: true
    },
    cache: {
        enabled: true,
        filePath: './src/utils/query-cache.json'
    }
});

// Endpoint'i Express'e bağlayın
app.post('/api/chat', createRagMiddleware(engine));

app.listen(3000, () => {
    console.log('⚡ AI-RAG-ENGINE http://localhost:3000/api/chat üzerinde aktif');
});
```

---

### Örnek 2: Özel Araçlar (Tools) ile Doğrudan Kod İçinden Kullanım

```typescript
import { RAGEngine, TieredLLMProvider } from 'ai-rag-engine';

const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv()
});

await engine.init();

// Canlı veritabanı sorgulayan özel bir araç kaydedin
engine.registerTool({
    name: 'check_live_stock',
    description: 'Bir ürünün canlı depo stok miktarını sorgular',
    parameters: {
        type: 'object',
        properties: {
            productName: { type: 'string', description: 'Ürün adı veya kodu' }
        },
        required: ['productName']
    },
    execute: async (args) => {
        return { inStock: true, unitsAvailable: 42, warehouseLocation: 'Istanbul-Depo-1' };
    }
});

// Soruyu işleyin
const result = await engine.process('Şu an depoda laptop var mı?');
console.log(result.answer);
console.log(`Çözümleyen Katman: ${result.resolvedBy} (Gecikme: ${result.latencyMs}ms)`);
```

---

## 📡 REST API Referansı

### 1. `POST /api/query`
Kullanıcı sorusunu tüm RAG güvenlik ve çözümleme basamaklarından geçirir.

#### İstek Başlıkları
| Başlık | Değer | Açıklama |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | Zorunlu |

#### İstek Gövdesi
```json
{
  "query": "Kutusu açılmış ürünlerde iade politikanız nedir?",
  "context": {
    "userId": "usr_9876",
    "region": "TR"
  }
}
```

#### Başarılı Yanıt: Sıfır-Token Anlamsal SSS Eşleşmesi (`200 OK`)
```json
{
  "answer": "Satın aldığınız ürünleri, teslimat tarihinden itibaren 14 gün içerisinde orijinal kutusu ve faturasıyla birlikte ücretsiz iade edebilirsiniz.",
  "intent": "FAQ",
  "resolvedBy": "SEMANTIC_FAQ",
  "appliedRules": [],
  "latencyMs": 7
}
```

#### Güvenlik Engeli Yanıtı: Yüksek Riskli Enjeksiyon Girişimi (`200 OK`)
```json
{
  "answer": "Güvenlik politikası nedeniyle bu talimat işlenemez. Lütfen yalnızca ürün ve hizmetlerimizle ilgili sorularınızı iletin.",
  "intent": "SECURITY_BLOCKED",
  "resolvedBy": "SECURITY_GUARD",
  "appliedRules": [],
  "latencyMs": 1
}
```

---

### 2. `GET /api/health`
Kubernetes ve Docker konteynerleri için sağlık kontrolü uç noktası.

```json
{
  "status": "ok",
  "uptime": 348.12,
  "timestamp": "2026-10-26T02:50:00.000Z"
}
```

---

## 🧪 Testler ve Doğrulama

Tüm katmanlar otomatik bir test paketi ile doğrulanmaktadır:

```bash
# Birim ve entegrasyon testlerini çalıştırın
npm test

# TypeScript tür kontrolü yapın
npm run typecheck

# Üretim paketini derleyin
npm run build

# Canlı vitrin örneklerini çalıştırın
npm run example:ecommerce
npm run example:minimal
```

### Test Paketi Özeti
```text
✔ Integration - Express API Routes (3/3 geçti)
✔ Integration - RAGEngine Full Lifecycle (5/5 geçti)
✔ Core Engine - CacheManager (3/3 geçti)
✔ FAQ Layer - LocalFaqAdapter (4/4 geçti)
✔ LLM Adapters & Multi-Tier Failover (6/6 geçti)
✔ Math Utilities - Dot Product (4/4 geçti)
✔ Security Layer - Prompt Injection & Boundary Framing (11/11 geçti)

Toplam: 13 test paketinde 36 test başarıyla geçti (0 hata, ~750ms süre)
```

---

## 📂 Proje Dizin Yapısı

```text
ai-rag-engine/
├── assets/
│   ├── logo.jpg               # Proje görsel kimliği ve logosu
│   ├── pipeline.svg           # 2D animasyonlu istek akış şeması
│   └── endpoints.svg          # 2D animasyonlu entegrasyon topolojisi
├── dist/                      # Derlenmiş üretim ESM paketleri ve tipleri
├── src/
│   ├── adapters/
│   │   ├── faq/               # Yerel vektör ve URL SSS adaptörleri
│   │   ├── llm/               # Tiered, Ollama, Custom LLM, OpenAI, Gemini
│   │   ├── rules/             # Statik ve dinamik iş kuralları
│   │   └── vector/            # Bellek içi vektör veritabanı adaptörü
│   ├── api/
│   │   ├── middleware.ts      # Express ara yazılım üreticisi
│   │   ├── routes.ts          # REST sorgu ve sağlık uç noktaları
│   │   └── server.ts          # Bağımsız Express sunucusu
│   ├── core/
│   │   ├── cache-manager.ts   # Çift katmanlı LRU + disk önbellek yöneticisi
│   │   ├── engine.ts          # Ana orkestrasyon motoru
│   │   ├── prompt-builder.ts  # Prompt enjeksiyon korumalı bağlam oluşturucu
│   │   ├── sml-engine.ts      # Yerel ONNX all-MiniLM-L6-v2 süreç içi boru hattı
│   │   ├── tool-registry.ts   # Anlamsal araç ve niyet yönlendiricisi
│   │   └── security/          # Sanitizer, InjectionDetector & SecurityGuard
│   ├── examples/              # Çalıştırılabilir hazır referans örnekler
│   ├── interfaces/            # TypeScript sözleşmeleri ve arayüzler
│   └── utils/                 # Önceden hesaplanmış 384 boyutlu vektör verileri
├── test/
│   ├── integration/           # Tam yaşam döngüsü ve HTTP uç nokta testleri
│   └── unit/                  # Önbellek, SML, LLM, Matematik ve Güvenlik testleri
├── LICENSE                    # MIT Lisansı
├── package.json               # Paket tanımı ve komutları
├── README.md                  # İngilizce Dokümantasyon (Varsayılan)
├── README_tr.md               # Türkçe Dokümantasyon
└── README_de.md               # Almanca Dokümantasyon
```

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında lisanslanmıştır.
Ticari projelerinizde, açık kaynak girişimlerinizde ve kurumsal sistemlerinizde serbestçe kullanabilirsiniz.
