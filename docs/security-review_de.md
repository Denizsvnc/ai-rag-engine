# Sicherheitsüberprüfung & Korrekturprotokoll

Aktualisierung vom 9. November 2026: Nachfolgende architektonische Änderungen bezüglich Cache-Invalidierung, Latenzmetriken und pgvector-Persistenz sind in [production-data-layer_de.md](production-data-layer_de.md) dokumentiert.

## Verifizierte und behobene Sicherheitsbefunde

| Schweregrad & Befund | Ursprüngliches Verhalten | Behobener Zustand & Verifikation |
|---|---|---|
| **P0 Boolean Confirmation Bypass** | `confirmedAction: true` führte mutierende Werkzeuge ohne Ticketprüfung aus. | Die Engine erzwingt signierte HMAC-Tickets; HTTP-Flags werden ignoriert. |
| **P0 Statische Standardschlüssel** | Feste Fallback-Strings für JWT und Bestätigungstickets. | Der Produktionsmodus erzwingt unabhängige, kryptografisch sichere Schlüssel (>= 32 Bytes). |
| **P0 Replay-Angriffe bei lokalen Nonces** | Prozesslokale Maps ermöglichten Replay-Angriffe über mehrere Instanzen hinweg. | Implementierung von `RedisConfirmationNonceStore` über atomare `SET key 1 PX ttl NX`-Befehle. |
| **P1 Mandantenübergreifende Job-Einsicht** | Ingestion-Status wurde ohne Mandantenprüfung zurückgegeben. | Mandantenkontext ist an Abfragen gebunden; unbefugte Abfragen liefern 404. |
| **P1 FAQ-Zugriff ohne Mandantenfilter** | Fehlender Mandantenkontext durchsuchte alle Mandanten-FAQs. | `getFaqs` und `findBestMatch` schließen mandantenspezifische Einträge ohne expliziten Kontext aus. |
| **P0 Client-Rollenfälschung** | Middleware akzeptierte unauthentifizierte Rollen aus Headern. | Unauthentifizierte Anfragen erhalten HTTP 401; Rollen stammen ausschließlich aus verifiziertem `req.auth`. |

## Verifikationsbefehle

```sh
npm ci
npm run typecheck
REDIS_TEST_URL=redis://127.0.0.1:6379 npm test
REDIS_TEST_URL=redis://127.0.0.1:6379 npm run test:security
npm run build
npm audit --audit-level=high
```

