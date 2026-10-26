<div align="center">

<img src="assets/logo.jpg" alt="AI-RAG-ENGINE Logo" width="160" style="border-radius: 28px; box-shadow: 0 12px 40px rgba(124, 108, 245, 0.45); margin-bottom: 16px;" />

# ⚡ AI-RAG-ENGINE

**Agentische RAG-Architektur für Unternehmen mit In-Process SML Intent-Routing, Zero-Token Semantischem FAQ-Caching, Multi-Tiered LLM-Failover und OWASP Prompt-Injection-Schutz.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-all--MiniLM--L6--v2_(q8)-FF5722?logo=onnx&logoColor=white)](https://huggingface.co/docs/transformers.js)
[![Tests](https://img.shields.io/badge/Tests-36%2F36_Bestanden-success?logo=checkmarx&logoColor=white)](test/)
[![Security](https://img.shields.io/badge/OWASP-Prompt_Injection_Geschützt-blueviolet?logo=shield&logoColor=white)](#3-️-owasp-prompt-injection--besucher-vertrauensgrenze)
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

### 5. 💾 Persistenter hybrider LRU-Cache
* Zweistufiges Caching: Ultraschneller In-Memory-LRU-Cache kombiniert mit persistenter Festplattenspeicherung (`query-cache.json`).
* Bleibt auch nach Server-Neustarts erhalten und beantwortet wiederkehrende Anfragen in Sub-Millisekunden.

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
# Unit- und Integrationstests ausführen
npm test

# Strikte TypeScript-Typprüfung
npm run typecheck

# Produktions-Bundle kompilieren
npm run build

# Interaktive Vitrinen-Beispiele ausführen
npm run example:ecommerce
npm run example:minimal
```

### Zusammenfassung der Testsuite
```text
✔ Integration - Express API Routes (3/3 bestanden)
✔ Integration - RAGEngine Full Lifecycle (5/5 bestanden)
✔ Core Engine - CacheManager (3/3 bestanden)
✔ FAQ Layer - LocalFaqAdapter (4/4 bestanden)
✔ LLM Adapters & Multi-Tier Failover (6/6 bestanden)
✔ Math Utilities - Dot Product (4/4 bestanden)
✔ Security Layer - Prompt Injection & Boundary Framing (11/11 bestanden)

Gesamt: 36 bestandene Tests in 13 Test-Suiten (0 Fehler, ~750ms Dauer)
```

---

## 📂 Verzeichnisstruktur

```text
ai-rag-engine/
├── assets/
│   ├── logo.jpg               # Visuelle Identität und Projektlogo
│   ├── pipeline.svg           # 2D-animiertes Flussdiagramm der Anfrage
│   └── endpoints.svg          # 2D-animierte Integrationstopologie
├── dist/                      # Kompilierte Produktions-Bundles & Typen
├── src/
│   ├── adapters/
│   │   ├── faq/               # Lokale Vektor- und Remote-FAQ-Adapter
│   │   ├── llm/               # Tiered, Ollama, Custom LLM, OpenAI, Gemini
│   │   ├── rules/             # Statische und dynamische Geschäftsregeln
│   │   └── vector/            # In-Memory-Vektorspeicher-Adapter
│   ├── api/
│   │   ├── middleware.ts      # Express-Middleware-Generator
│   │   ├── routes.ts          # REST Query- und Health-Routen
│   │   └── server.ts          # Eigenständiger Express-Server
│   ├── core/
│   │   ├── cache-manager.ts   # Zweistufiger LRU- & Festplatten-Cache
│   │   ├── engine.ts          # Zentraler Orchestrierungs-Kern
│   │   ├── prompt-builder.ts  # Prompt-Injection-Schutz mit Sandbox-Tags
│   │   ├── sml-engine.ts      # Lokale ONNX all-MiniLM-L6-v2 In-Process Pipeline
│   │   ├── tool-registry.ts   # Semantischer Tool- und Intent-Router
│   │   └── security/          # Sanitizer, InjectionDetector & SecurityGuard
│   ├── examples/              # Ausführbare Referenzbeispiele
│   ├── interfaces/            # TypeScript-Schnittstellen und Verträge
│   └── utils/                 # Vorberechnete 384-dim Vektordatensätze
├── test/
│   ├── integration/           # Lifecycle- und HTTP-Endpunkt-Tests
│   └── unit/                  # Cache-, SML-, LLM-, Mathe- und Sicherheitstests
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
