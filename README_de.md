<div align="center">

<img src="assets/logo.jpg" alt="AI-RAG-ENGINE Logo" width="160" style="border-radius: 28px; box-shadow: 0 12px 40px rgba(124, 108, 245, 0.45); margin-bottom: 16px;" />

# ⚡ AI-RAG-ENGINE

**Agentische RAG-Architektur für Unternehmen mit In-Process SML Intent-Routing, Zero-Token Semantischem FAQ-Caching, Multi-Tiered LLM-Failover und OWASP Prompt-Injection-Schutz.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-all--MiniLM--L6--v2_(q8)-FF5722?logo=onnx&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![Tests](https://img.shields.io/badge/Tests-65%2F65_Bestanden-success?logo=checkmarx&logoColor=white)](test/)
[![Security](https://img.shields.io/badge/OWASP-Prompt_Injection_Geschützt-blueviolet?logo=shield&logoColor=white)](#3-️-owasp-prompt-injection--besucher-vertrauensgrenze)
[![DSGVO Datenschutz](https://img.shields.io/badge/DSGVO-TCKN_&_Luhn_Geschützt-blue?logo=security&logoColor=white)](#6--zero-bloat-pii-maskierung-tckn-luhn-und-datensouveränität)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

### 🌐 Sprache / Language / Dil

**[English](README.md)** • **[Türkçe](README_tr.md)** • **[Deutsch](README_de.md)**

---

</div>

## 📌 Zusammenfassung (Executive Summary)

Moderne Unternehmensanwendungen können es sich nicht leisten, jede rohe Benutzeranfrage direkt an teure, langsame und nicht-deterministische Cloud-LLMs zu senden. Dies führt zu explodierenden Token-Kosten, Latenzen von 2 bis 5 Sekunden, Compliance-Risiken und Anfälligkeiten für Prompt-Injection-Angriffe.

**AI-RAG-ENGINE** löst diese Probleme durch eine **kostenminimierende, sicherheitsgehärtete Wasserfall-Pipeline**:

1. **🛡️ 1 ms OWASP-Schutzschild:** Fängt Jailbreaks, System-Prompt-Extraktionen und Rollenübersteuerungen ab, noch bevor ein LLM kontaktiert wird.
2. **💾 2 ms LRU- & Festplatten-Cache:** Beantwortet wiederkehrende Anfragen unmittelbar aus dem Speicher oder der Festplatte ohne LLM-Aufruf.
3. **🎯 5 ms Zero-Token Semantische FAQ:** Löst umformulierte Benutzerfragen über ein lokales 384-dimensionales Vektor-Skalarprodukt gegen vorberechnete Einbettungen (**0 LLM-Tokens verbraucht**).
4. **🧠 In-Process Semantic Model Layer (SML):** Führt Intent-Klassifizierung und Tool-Routing lokal auf der CPU mit quantisiertem ONNX (`all-MiniLM-L6-v2`) in unter 15 ms aus.
5. **🔀 Multi-Tiered LLM-Failover:** Leitet Routineaufgaben automatisch an **Fast LLMs** (`gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2`) und komplexe analytische Abfragen an **Smart LLMs** (`gpt-4o`, `deepseek-r1`, `gemini-1.5-pro`) weiter – mit automatischer Ausfallsicherung zwischen Anbietern.
6. **🔒 100% On-Premise Datenschutzmodus:** Native Adapter für **Ollama**, **vLLM**, **TGI** und interne VPC-Endpunkte mit `ALLOW_PUBLIC_OPENSOURCE_LLM=false` zum Schutz vor Datenabfluss.

---

## 🏛️ Systemarchitektur

### 1. Lebenszyklus einer Anfrage (Request Lifecycle Waterfall)
*Jede Abfrage nimmt den günstigsten und sichersten Weg. Externe LLMs werden nur aufgerufen, wenn lokale semantische und deterministische Schichten die Frage nicht beantworten können.*

<div align="center">

![AI-RAG-ENGINE Lebenszyklus](assets/pipeline.svg)

</div>

---

### 2. Integrationstopologie & Endpunkte
*Flexible Bereitstellung: Nutzung als eigenständiger Microservice mit REST-Endpunkten oder direkte Einbettung als Node.js / Express-Bibliothek mit Unternehmens-Failover.*

<div align="center">

![AI-RAG-ENGINE Integrationstopologie](assets/endpoints.svg)

</div>

---

### 3. Lokaler SML Entscheidungs- und Ausführungsmechanismus (Deep Dive)
*Wie AI-RAG-ENGINE langsames und teures Cloud-LLM-Tool-Routing durch ein in-process 384-dimensionales ONNX-Vektor-Skalarprodukt und deterministische Schwellenwert-Gatter ersetzt:*

<div align="center">

![AI-RAG-ENGINE Lokaler SML Entscheidungs- und Ausführungsmechanismus](assets/sml-mechanism.svg)

</div>

---

### 4. Sichere Dokumentenverarbeitung & PII-Schutz-Pipeline (Ingestion & PII Pipeline)
*Zero-Bloat Magic-Byte-Prüfung, 11-stelliger TCKN Mod-10-Algorithmus, Luhn-Kreditkartenprüfung, asynchrone BullMQ-Warteschlange und lokale Datensouveränität.*

<div align="center">

![AI-RAG-ENGINE Sichere Dokumentenverarbeitung und PII Pipeline](assets/ingestion-pii-pipeline.svg)

</div>

---

## ✨ Wichtigste Kernfunktionen

### 1. 🧠 In-Process Semantic Model Layer (SML) & Deterministisches Tool-Routing
* **Das architektonische Problem:** Herkömmliche Agentic-Frameworks (z. B. LangChain, CrewAI, AutoGen) serialisieren riesige JSON-Tool-Schemas in System-Prompts und befragen ein externes Cloud-LLM (GPT-4 / Claude) nur um zu fragen: *"Welches Tool soll aufgerufen werden?"*. Dies verbraucht **800–2.000 Token** und verursacht **1,5–3,0 Sekunden Latenz**, bevor ein Tool ausgeführt wird.
* **Die SML-Lösung:** Entkoppelt *Intent-Routing* von *Textgenerierung*. Führt quantisiertes `Xenova/all-MiniLM-L6-v2 (q8)` direkt im Node.js-Prozess auf der CPU über die ONNX-Runtime aus (< 15MB RAM, ~8–12ms, 0 Token).
* **Vorberechnetes Vektorregister:** Berechnet 384-dimensionale normalisierte Einheitsvektoren ($\vec{t}_i$) für alle registrierten Tools im Voraus und speichert sie in `src/utils/tools-registry.json`.
* **Mathematisches Entscheidungsgatter (Decision Gate):**
  $$\text{Ähnlichkeitswert} = \vec{q} \cdot \vec{t}_i = \sum_{k=1}^{384} q_k \cdot t_{ik}$$
  * **Zweig A ($\text{Wert} \ge 0.50$): Deterministische Tool-Aktion ausgelöst**
    * Intent mit hoher Konfidenz abgeglichen (z. B. `check_live_stock` mit Wert `0.78`).
    * Schnelles Fast-Tier-LLM extrahiert kompakte JSON-Parameter (`{ productName: "laptop" }`).
    * Native Codeausführung (`tool.execute(args)`) fragt direkt Live-PostgreSQL-, ERP- oder Lager-APIs ab.
    * Echtzeitdaten werden ohne Halluzinationsrisiko direkt in den Kontext eingespeist.
  * **Zweig B ($\text{Wert} < 0.50$): Standard-Vektor-Retrieval**
    * Schaltet nahtlos auf die semantische Dokumentensuche um, wenn kein transaktionales Tool passt.

### 2. 🎯 Zero-Token Semantische FAQ-Engine
* **Tolerant gegenüber Umformulierungen:** Erkennt unterschiedliche Formulierungen derselben Frage (z. B. *"Wie viele Tage habe ich für die Rückgabe Zeit?"* vs. *"Bis wann kann ich einen Artikel zurücksenden?"*) und gleicht sie semantisch ab.
* **Vektor-Skalarprodukt:** Nutzt SIMD-optimierte Skalarprodukt-Ähnlichkeit (Kosinus-Ähnlichkeit bei Einheitsvektoren) mit einem kalibrierten Konfidenz-Schwellenwert (`>= 0.60`).
* **Sofortige Antwort:** Liefert geprüfte Unternehmensantworten in **unter 10 ms bei 0 LLM-Token-Kosten**.

### 3. 🛡️ OWASP Prompt Injection & Besucher-Vertrauensgrenze
* **Explizites Boundary-Framing:** Kapselt rohe Benutzereingaben in isolierten `<untrusted_visitor_message>`-Tags.
* **Autoritäre Sicherheitsanweisungen:** Verbindliche englische System-Prompts weisen das LLM an, dass Benutzereingaben unüberprüfte Daten sind und Systemregeln **niemals** überschreiben oder offenlegen dürfen.
* **Bereinigung unsichtbarer Unicode-Zeichen:** Entfernt Nullbreiten-Zeichen (`\u200B`, `\uFEFF`, `\u200D`) und Steuerbytes, die häufig für Verschleierungsangriffe verwendet werden.
* **Tag-Neutralisierung:** Entschärft schließende XML-Tags in Benutzereingaben, um Context-Breakout-Angriffe zu verhindern.
* **0-Token Heuristik-Blocker:** Hochriskante Angriffsmuster (DAN-Modi, "ignore previous instructions", Developer-Override-Tricks) führen innerhalb von 1 ms zu einer sicheren Ablehnung ohne LLM-Kosten.

### 4. 🔀 Multi-Tiered LLM-Provider mit Ausfallsicherung
* **Komplexitätsbasiertes Routing:**
  * **Fast Tier** (`gpt-4o-mini`, `gemini-1.5-flash`, `llama3.2:3b`): Für kurze Klärungen, Parameter-Extraktion und Standardantworten.
  * **Smart Tier** (`gpt-4o`, `gemini-1.5-pro`, `deepseek-r1:8b`): Aktiviert bei mehreren Teilfragen, vergleichenden Analysen oder tiefem Reasoning.
* **Kaskadierendes Failover:** Bei Ratenbegrenzungen (`429`) oder Ausfällen des primären Anbieters schaltet das System automatisch auf Gemini, Ollama oder interne Endpunkte um.
* **Unternehmens-Compliance:** `ALLOW_PUBLIC_OPENSOURCE_LLM=false` verhindert versehentliche Übertragungen interner Daten an öffentliche Router (wie OpenRouter).

### 5. 💾 Hybrider LRU-Cache & Aktive Datenaktualität (Vermeidung veralteter Daten)
* **Das Problem veralteter Daten:** In herkömmlichen RAG-Systemen wird bei einer Preisänderung von **1.000 € (X)** auf **800 € (B)** der veraltete Preis weiterhin aus statischen Vektoren oder langlebigen Caches ausgeliefert.
* **Die AI-RAG-ENGINE Datenfrische-Architektur:**
  1. **Volatile Fakten umgehen Vektoren über Live-SML-Tools:** Preise, Lagerbestände und Buchungsstatus werden NIEMALS in statischen Vektordatenbanken gespeichert. Das In-Process-SML leitet Preisanfragen direkt an ein aktives Datenbank-Tool (`check_live_price`) weiter, das den aktuellen Stand zur Laufzeit aus PostgreSQL/ERP abruft.
  2. **Keine veralteten Tool-Caches (`cacheToolResults: false`):** Ausgaben von Live-Tools werden standardmäßig vom 24-Stunden-Cache ausgenommen (oder nutzen kurze Mikro-TTLs wie 60 Sekunden), sodass Preisänderungen sofort für Nutzer sichtbar sind.
  3. **Aktive Cache-Invalidierungs-API:** Bei Katalog- oder Richtlinienänderungen können Backend-Systeme den Cache in RAM und Festplatte sofort leeren:
     ```typescript
     // Alle Cache-Einträge für ein Produkt invalidieren
     await engine.invalidateCache('laptop');
     // Über reguläre Ausdrücke invalidieren
     await engine.invalidateCache(/_price$|fiyat/i);
     ```
  4. **Konfigurierbare TTL & automatischer Ablauf:** Der LRU-Speichercache erzwingt über `ttlMs` eine automatische Bereinigung abgelaufener Einträge.

### 6. 🔒 Zero-Bloat PII-Maskierung (TCKN & Luhn) und Datensouveränität
* **DSGVO / Compliance-Herausforderung:** Benutzerfragen und hochgeladene PDF/Text-Dateien enthalten häufig vertrauliche Personendaten wie die türkische Identitätsnummer (TCKN), Kreditkartennummern, IBANs und Kontaktdaten. Herkömmliche Systeme ignorieren dies (Gefahr hoher DSGVO-Bußgelder) oder installieren überdimensionierte 500-MB-Python-NLP-Bibliotheken, die Server überlasten.
* **Die Zero-Bloat-Lösung:** In reinem TypeScript ohne externe Abhängigkeiten implementiert, mit Ausführungszeiten von unter **4,03 Mikrosekunden** (245.408 Operationen/Sekunde):
  1. **Algorithmische 11-stellige TCKN Mod-10-Prüfung:** Verifiziert offizielle Prüfziffer-Formeln:
     $$d_{10} = \left(\left(\sum \text{ungerade} \times 7 - \sum \text{gerade}\right) \bmod 10 + 10\right) \bmod 10, \quad d_{11} = \left(\sum_{k=1}^{10} d_k\right) \bmod 10$$
     *Keine False Positives:* Zufällige 11-stellige Nummern (z. B. Bestellnummern) bleiben unverändert, nur echte TCKNs werden maskiert (`[TCKN_100*****46]`).
  2. **Kreditkarten-Luhn-Algorithmus:** Verdoppelt Ziffern alternierend von rechts nach links, um echte Bankkarten zu erkennen und zu maskieren (`[CARD_****_****_****_5671]`).
  3. **IBAN & Kontaktdaten-Schwärzung:** Neutralisiert türkische (`TR..`) und europäische IBANs, E-Mails und Telefonnummern.
* **Strikte Datensouveränität (Data Sovereignty):**
  * **Öffentliche Cloud-LLMs (OpenAI, Gemini):** PII-Daten werden **garantiert zu 100% maskiert**. Keine Rohdaten verlassen das Unternehmensnetzwerk.
  * **Lokale On-Premise-LLMs (Ollama, interne VPC):** Sofern unternehmensinterne Richtlinien es gestatten (`allowUnmaskedForLocalLLM: true`), können Rohdaten für lokale In-House-Inferenz erhalten bleiben.

### 7. ⚡ Asynchrone BullMQ- & In-Memory-Warteschlange (Job Queue)
* **Blockierungsfreie Architektur:** Das Einlesen von Dokumenten, Parsen von PDF-Streams, Chunking, Schwärzen vertraulicher Daten und Berechnen von ONNX-Vektoren sind rechenintensiv. Eine synchrone Verarbeitung würde den Express-Server blockieren.
* **Modulares Queue-System (`IJobQueue`):**
  * **Vollständig autarke `InMemoryJobQueue`:** Standardmäßig aktiv mit gleichzeitigen Worker-Pools und Fortschrittsüberwachung – läuft ohne externe Infrastruktur wie Redis.
  * **Enterprise `BullMQJobQueue`:** Redis-gestützt mit verteilten Workern, automatischen Wiederholungsversuchen und Ausfallsicherheit für Kubernetes-Cluster.
* **Zweistufiger REST-Ablauf:**
  1. `POST /api/ingest`: Prüft Dateisicherheit anhand der Dateikopf-Bytes (Magic Bytes) und gibt `202 Accepted` mit einer `jobId` zurück.
  2. `GET /api/ingest/status/:jobId`: Liefert den aktuellen Status (`0% -> 30% -> 70% -> 100%`) in Echtzeit.
* **Schutz vor schädlichen Binärdateien (Magic Bytes):** Selbst wenn eine ausführbare Datei in `.pdf` oder `.txt` umbenannt wird, werden Header (`MZ` Windows PE, `\x7fELF` Linux, `#!` Shebang, `0xCAFEBABE`, `.exe`, `.sh`, `.bin`, `.docm`) in **1,26 µs** sofort abgewiesen.

### 8. 📊 FinOps-Telemetrie & Token-Kostenerfassung in Echtzeit
* **Volle Kostentransparenz:** Exakte Erfassung, wie viele Tokens und Dollar durch Caching, semantische FAQs und SML-Routing im Vergleich zu reinen LLM-Aufrufen eingespart werden.
* **Detaillierte Metriken in jeder Antwort:** Jede `engine.query()`-Antwort enthält eine genaue Aufschlüsselung:
  ```json
  {
    "answer": "Rückgabe innerhalb von 14 Tagen möglich.",
    "intent": "FAQ",
    "resolvedBy": "SEMANTIC_FAQ",
    "metrics": {
      "tokensConsumed": 0,
      "tokensSaved": 450,
      "estimatedCostSavedUsd": 0.00135,
      "latencyMs": 4.2,
      "source": "FAQ"
    }
  }
  ```
* **Kumulativer FinOps-Endpunkt (`GET /api/metrics`):**
  Liefert Gesamtabfragen, Zero-Token-Quote (z. B. `78.4%`), verbrauchte vs. eingesparte Tokens, monetäre Ersparnis und p95-Latenzen.

---

## 🚀 Schnellstart

### Voraussetzungen
* **Node.js** >= 20.0.0
* **npm** >= 10.0.0

### 1. Installation
```bash
# Repository klonen
git clone https://github.com/Denizsvnc/ai-rag-engine.git
cd ai-rag-engine

# Abhängigkeiten installieren
npm install
```

### 2. Umgebungsvariablen konfigurieren
Kopieren Sie die Vorlage `.env.example` nach `.env`:
```bash
cp .env.example .env
```

#### Option A: Lokale & private Bereitstellung (Ollama / vLLM / On-Premise)
*Es verlassen keine Unternehmensdaten Ihr lokales Netzwerk.*
```env
ALLOW_PUBLIC_OPENSOURCE_LLM=false

# Lokale Ollama-Instanz
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL_FAST=llama3.2:3b
OLLAMA_MODEL_SMART=deepseek-r1:8b

# Oder allgemeiner OpenAI-kompatibler VPC-Endpunkt (vLLM, TGI, LocalAI)
CUSTOM_LLM_URL=http://internal-llm-service.corp.local:8000/v1/chat/completions
CUSTOM_LLM_MODEL=meta-llama/Llama-3.2-3B-Instruct
```

#### Option B: Cloud-Anbieter (OpenAI & Google Gemini)
```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL_FAST=gpt-4o-mini
OPENAI_MODEL_SMART=gpt-4o

GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Entwicklungsserver starten
```bash
npm run dev
```
Der Server initialisiert das lokale ONNX-Modell und lauscht auf `http://localhost:3000`.

---

## 💻 Verwendungsbeispiele

### Beispiel 1: Als Express-Middleware einbinden
Mit weniger als 10 Zeilen Code in eine bestehende Express-Anwendung integrieren:

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

// RAGEngine initialisieren
const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv(),
    inputs: {
        rules: new StaticRulesAdapter([
            'Die Rückgabefrist für alle Elektronikartikel beträgt 14 Tage.',
            'Pflegen Sie stets einen höflichen, professionellen und hilfsbereiten Ton.'
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

// Route in Express registrieren
app.post('/api/chat', createRagMiddleware(engine));

app.listen(3000, () => {
    console.log('⚡ AI-RAG-ENGINE läuft unter http://localhost:3000/api/chat');
});
```

---

### Beispiel 2: Programmatische Nutzung mit benutzerdefinierten Tools

```typescript
import { RAGEngine, TieredLLMProvider } from 'ai-rag-engine';

const engine = new RAGEngine({
    llmProvider: TieredLLMProvider.createFromEnv()
});

await engine.init();

// Benutzerdefiniertes Live-Datenbank-Tool registrieren
engine.registerTool({
    name: 'check_live_stock',
    description: 'Prüft den Echtzeit-Lagerbestand für ein Produkt',
    parameters: {
        type: 'object',
        properties: {
            productName: { type: 'string', description: 'Produktname oder Artikelnummer' }
        },
        required: ['productName']
    },
    execute: async (args) => {
        return { inStock: true, unitsAvailable: 42, warehouseLocation: 'Frankfurt-Hub-01' };
    }
});

// Anfrage verarbeiten
const result = await engine.process('Haben Sie derzeit Laptops auf Lager?');
console.log(result.answer);
console.log(`Gelöst durch: ${result.resolvedBy} (Latenz: ${result.latencyMs}ms)`);
```

---

## 📡 REST-API-Referenz

### 1. `POST /api/query`
Verarbeitet eingehende Benutzeranfragen über die gesamte RAG-Wasserfall-Pipeline.

#### Header
| Header | Wert | Beschreibung |
| :--- | :--- | :--- |
| `Content-Type` | `application/json` | Erforderlich |

#### Request-Body
```json
{
  "query": "Wie lauten Ihre Rückgabebedingungen für geöffnete Artikel?",
  "context": {
    "userId": "usr_9876",
    "region": "DE"
  }
}
```

#### Antwort: Zero-Token Semantischer FAQ-Treffer (`200 OK`)
```json
{
  "answer": "Sie können jeden unbeschädigten Artikel in der Originalverpackung innerhalb von 14 Tagen nach Lieferung für eine vollständige Rückerstattung zurücksenden.",
  "intent": "FAQ",
  "resolvedBy": "SEMANTIC_FAQ",
  "appliedRules": [],
  "latencyMs": 7
}
```

#### Antwort: Sicherheitsblockierung bei Prompt-Injection-Angriff (`200 OK`)
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
Health-Check für Kubernetes- und Docker-Liveness-Probes.

```json
{
  "status": "ok",
  "uptime": 348.12,
  "timestamp": "2026-10-26T02:50:00.000Z"
}
```

---

## 🧪 Tests & Verifizierung

Das Framework verfügt über eine automatisierte Testsuite, die alle Schichten abdeckt:

```bash
# Unit- und Integrationstests ausführen (65 Tests in 13 Suiten)
npm test

# High-Throughput Smoke Benchmark ausführen
npm run benchmark

# k6 Multi-User Lasttest ausführen
k6 run test/performance/k6-load-test.js

# Strikte TypeScript-Typprüfung
npm run typecheck

# Produktions-Bundle kompilieren
npm run build

# Interaktive Vitrinen-Beispiele ausführen
npm run example:ecommerce
npm run example:minimal
```

### High-Throughput Smoke Benchmark Ergebnisse
*Gemessen auf Apple Silicon M-Serie (100% In-Process CPU, keine dedizierte GPU erforderlich):*

| Benchmark-Ziel | Iterationen | Durchsatz (Throughput) | Durchschn. Latenz | p95 Latenz | Architektonische Rolle |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`PIIGuard.sanitize`** | 10.000 | **245.408 ops/s** | **4,03 µs** | 4,87 µs | Algorithmische TCKN Mod-10 + Luhn-Prüfung |
| **`CacheManager.get`** | 20.000 | **7.276.034 ops/s** | **0,10 µs** | 0,25 µs | In-Memory Hot Path Cache |
| **`Dot Product` (384-dim)** | 50.000 | **2.307.741 ops/s** | **0,41 µs** | 0,58 µs | all-MiniLM-L6-v2 ONNX SIMD Skalarprodukt |
| **`Document Chunking`** | 5.000 | **778.993 ops/s** | **1,26 µs** | 1,50 µs | Magic Bytes Dateiprüfung & Boundary Chunker |
| **`TokenTracker`** | 20.000 | **5.946.554 ops/s** | **0,14 µs** | 0,21 µs | FinOps Echtzeit-Kostentelemetrie |

### Zusammenfassung der Testsuite
```text
✔ Integration - Express API Routes (3/3 bestanden)
✔ Integration - RAGEngine Full Lifecycle (7/7 bestanden)
✔ Integration - Document Ingestion & PII Protection Pipeline (4/4 bestanden)
✔ Core Engine - CacheManager & Data Freshness (7/7 bestanden)
✔ FAQ Layer - LocalFaqAdapter (4/4 bestanden)
✔ Asynchronous Queue - InMemory & BullMQ (4/4 bestanden)
✔ LLM Adapters & Multi-Tier Failover (6/6 bestanden)
✔ Math Utilities - Dot Product (4/4 bestanden)
✔ Security Guard - PIIGuard & Data Sovereignty (6/6 bestanden)
✔ Security Layer - Prompt Injection & Boundary Framing (11/11 bestanden)
✔ FinOps Metrics - TokenTracker (5/5 bestanden)

Gesamt: 65 bestandene Tests in 13 Test-Suiten (0 Fehler, ~980ms Dauer)
```

---

## 📂 Verzeichnisstruktur

```text
ai-rag-engine/
├── assets/
│   ├── logo.jpg               # Visuelle Identität und Projektlogo
│   ├── pipeline.svg           # 2D-animiertes Flussdiagramm der Anfrage
│   ├── endpoints.svg          # 2D-animierte Integrationstopologie
│   ├── sml-mechanism.svg      # 2D-animierter SML-Entscheidungs-Engine Plan
│   └── ingestion-pii-pipeline.svg # 2D-animierte sichere Ingestion & PII Pipeline
├── dist/                      # Kompilierte Produktions-Bundles & Typen
├── src/
│   ├── adapters/              # FAQ-, LLM-, Regel- und Vektor-Adapter
│   ├── api/                   # Express Middleware & REST-Routen (/query, /ingest, /metrics)
│   ├── core/
│   │   ├── cache-manager.ts   # Zweistufiger LRU- & Festplatten-Cache (TTL & Invalidation)
│   │   ├── engine.ts          # Zentraler Orchestrierungs-Kern & Telemetrie
│   │   ├── metrics/           # TokenTracker (FinOps Kosten- & Latenzerfassung)
│   │   ├── prompt-builder.ts  # Prompt-Injection-Schutz mit Sandbox-Tags
│   │   ├── queue/             # InMemoryJobQueue, BullMQJobQueue & QueueFactory
│   │   ├── security/          # PIIGuard (TCKN/Luhn), Sanitizer & InjectionDetector
│   │   ├── sml-engine.ts      # Lokale ONNX all-MiniLM-L6-v2 In-Process Pipeline
│   │   └── tool-registry.ts   # Semantischer Tool- und Intent-Router
│   ├── services/
│   │   └── document-ingestion.service.ts # Magic Bytes & PII-Schwärzungs-Service
│   ├── examples/              # Ausführbare Referenzbeispiele
│   ├── interfaces/            # TypeScript-Schnittstellen und Verträge
│   └── utils/                 # Vorberechnete 384-dim Vektordatensätze
├── test/
│   ├── integration/           # Lifecycle-, API- und Ingestion-Tests
│   ├── performance/           # High-Throughput Smoke Benchmark & k6 Lasttest
│   └── unit/                  # Cache-, SML-, LLM-, Mathe-, PII- und Sicherheitstests
├── TASKS.md                   # Echtzeit-Aufgabenverfolgung und Feature-Status
├── CLAUDE.md                  # Umfassender Leitfaden für KI-Assistenten und Entwickler
├── LICENSE                    # MIT-Lizenz
├── package.json               # Paket-Metadaten und Skripte
├── README.md                  # Englische Dokumentation (Standard)
├── README_tr.md               # Türkische Dokumentation
└── README_de.md               # Deutsche Dokumentation
```

---

## 📄 Lizenz

Dieses Projekt ist unter der [MIT-Lizenz](LICENSE) lizenziert.
Frei verwendbar für kommerzielle Anwendungen, Open-Source-Projekte und Unternehmenssysteme.
