# Persistente Datenschicht & Cache-Invalidierung

Prüfungsdatum: 9. November 2026. Dieses Dokument spezifiziert den persistenten PostgreSQL/pgvector-Adapter, verteiltes Caching mit Redis und Prometheus-Metriken.

## Cache- & Metrik-Verhalten

Bei aktiver Redis-Konfiguration speichert `RedisCacheAdapter` keine lokale speicherinterne Kopie von Antworten. Bei Verbindungsabbrüchen verhält sich das System standardmäßig wie bei einem Cache-Miss; die Live-Abfragepipeline bleibt funktionsfähig. Die Option `enableFallbackMemory: false` leitet Redis-Lese- und Schreibfehler direkt an den Aufrufer weiter. Fehlgeschlagene `delete`-, `invalidate`- oder `clear`-Operationen erzeugen in jedem Fall Fehler, um veraltete Zustände transparent zu machen.

- Regex-Invalidierung durchsucht und löscht Remote-Redis-Schlüssel innerhalb des Namespaces.
- Schlüsselabfragen nutzen `SCAN` in Batches von bis zu 100 Schlüsseln zur Schonung der Redis-Ereignisschleife.
- `size()` meldet ausschließlich die Anzahl lokaler LRU-Einträge, nicht die Gesamtschlüsselanzahl auf dem Remote-Server.

Latenzmetriken erfassen die tatsächliche Summe (`_sum`) und Anzahl (`_count`) über den Prozesslebenszyklus. Nicht-endliche Werte (`NaN`, `Infinity`, negative Zahlen) werden vor der Zählung abgewiesen.

Prometheus-Histogrammabfrage:

```promql
histogram_quantile(0.95, sum by (le) (rate(rag_query_duration_seconds_bucket[5m])))
```

## PostgreSQL / pgvector Datenspeicher

`PostgresVectorAdapter` bietet persistente dichte Vektorsuche sowie hybrides Retrieval über Volltextsuche und Reciprocal Rank Fusion (RRF). Standardmäßig wird exakte Vektorsuche genutzt; approximative HNSW-Indizierung ist über `createHnswIndex: true` bei der Migration verfügbar.

Sämtliche Such-, Lösch- und Bereinigungsoperationen verlangen zwingend eine gültige `filter.tenantId`. Der zusammengesetzte Primärschlüssel `(tenant_id, id)` stellt vollständige Mandantentrennung sicher. Direkter SQL-Zugriff nutzt kein RLS; Mandantenfilter müssen aus authentifizierten Anwendungskontexten stammen.

Batch-Einfügungen erfolgen innerhalb einer gemeinsamen Datenbanktransaktion. Modellname und Vektordimensionen werden in einer Konfigurationstabelle abgeglichen; Abweichungen führen zum Initialisierungsabbruch.

## Installation & Migration

```sh
npm ci
npm run build
npm run db:migrate
```

