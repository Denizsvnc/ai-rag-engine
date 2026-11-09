# Dauerhafte Verarbeitungswarteschlange & Unabhängige Konsumentenprüfung

Prüfungsdatum: 9. November 2026. Dieses Modul dokumentiert die Worker- und Ingestion-Warteschlangenarchitektur, Ausfallsicherheit und transaktionale Outbox-Garantien.

## Betriebsmodell

Die HTTP-API fungiert ausschließlich als Producer. Dateiuploads werden zuerst in einer PostgreSQL-`bytea`-Spalte und einem transaktionalen Job-Ledger/Outbox-Eintrag persistiert. Lediglich schlanke Job- und Mandantenreferenzen werden an Redis übergeben. Ein separater Hintergrund-Worker (`ai-rag-worker`) liest die Datei aus der Datenbank, verifiziert Prüfsummen und Dateisicherheit, führt PII-Maskierung vor der Chunk-Erstellung durch und berechnet dichte Vektor-Embeddings. Es ist kein `/tmp`- oder Dateisystem-Sharing zwischen Containern erforderlich.

Falls die Redis-Verteilung nach dem PostgreSQL-Commit fehlschlägt, verbleibt der Upload im Status `pending`. Der Worker durchsucht die Outbox regelmäßig und reiht ausstehende Aufträge erneut ein. BullMQ bietet At-Least-Once-Zustellung. Ein transaktionales Dokumenten-Versionsmanifest und atomarer Chunk-Ersatz gewährleisten Idempotenz. Ältere Dokumentversionen können neuere nicht überschreiben; veraltete Chunks verkleinerter Dokumente werden bereinigt.

- `Idempotency-Key`-Header geben denselben Job für identische Mandanten-/Payload-Paare zurück; abweichende Payloads führen zu HTTP 409.
- Standardkonfiguration: 3 Wiederholungsversuche mit exponentiellem Backoff; globale Parallelität 4, pro Worker 2.
- Fehlgeschlagene Jobs verbleiben 7 Tage im BullMQ-Fehlerspeicher (max. 10.000). Erfolgreiche Rohdateien werden sofort gelöscht; fehlgeschlagene Rohdaten verfallen nach 7 Tagen.
- `POST /api/ingest/status/:jobId/retry` ermöglicht autorisierten Mandanten das erneute Einreihen fehlgeschlagener Aufgaben.
- Standardlimits: 5 MiB Uploadgröße, 100 ausstehende Jobs pro Mandant, 50 MiB Rohdatenpuffer pro Mandant. Redis Lua Sliding-Window-Limiter setzt ein Limit von 120 Anfragen/Minute pro Mandant durch.
- SIGTERM/SIGINT bewirken kontrolliertes Herunterfahren mit 30 Sekunden Frist. Abrupte Prozessabbrüche werden über BullMQ-Stall-Locks wiederhergestellt.
- PDF-Textextraktion ist auf extrahierbaren Text ohne OCR beschränkt; nicht-textuelle PDFs schlagen explizit fehl.

## Konfiguration & Bereitstellung

Im Repository: `npm ci && npm run build`. PostgreSQL mit `pgvector` und Redis sind erforderlich:

```sh
DATABASE_URL=postgresql://owner:password@localhost/rag npm run db:migrate
```

Umgebungsvariablen für API und Worker:

```dotenv
NODE_ENV=production
VECTOR_STORE=postgres
VECTOR_AUTO_MIGRATE=false
INGESTION_QUEUE=bullmq
DATABASE_URL=postgresql://runtime:password@localhost/rag
REDIS_URL=redis://localhost:6379
JWT_SECRET=<zufaelliger-geheimer-schluessel-32+-bytes>
CONFIRMATION_SECRET=<weiterer-geheimer-schluessel-32+-bytes>
PRIVATE_LLM_ENDPOINT=http://localhost:8000/v1/chat/completions
```

Dienste starten:

```sh
npm start
# In separatem Prozess/Container:
npm run start:worker
```

Bei npm-Installation stehen CLI-Befehle als `npx ai-rag-migrate`, `npx ai-rag-server` und `npx ai-rag-worker` zur Verfügung. SDK-Exporte umfassen `PostgresIngestionStore`, `QueuedIngestionService`, `IngestionWorker` und `BullMQJobQueue`.

