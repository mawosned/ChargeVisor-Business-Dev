# ChargeVisor – Backend-Regressionsschutz (Phase 1)

## Referenzstand – NICHT verändern

- Repository: `mawosned/ChargeVisor-Business`
- Referenzbranch: `main`
- Ausgangscommit: `b541e5c34006dd3697037bf2ebcdd254a4cd0398`
- Zeitpunkt der Bestandsaufnahme: 2026-11-22
- Diese Phase verändert **keine** produktive API-, OCPP- oder Datenbankimplementierung.
- Die existierenden `tools/ocpp-chain-simulator/`-Dateien sind unabhängig.

Eine grüne Unit-Test-Suite beweist **nicht**, dass alle Benutzeroberflächen,
Ladeverläufe, Berechtigungen und Hardwarefunktionen im Produktivsystem funktionieren.
Der Commit ist ein technischer Vergleichsstand, keine Produktivfreigabe.

## Verifizierte Ausgangslage (Render Build-Log, 22.11.2026)

Der Deploy `dep-dc1fmf6417fc73bgisk0` des Render-Dienstes
`chargevisor-business-demo` hat am 22.11.2026 den Commit
`b541e5c34006dd3697037bf2ebcdd254a4cd0398` ausgecheckt.
Der `npm install`-Build löste über `postinstall` die vorhandene
`npm test`-Suite aus. **Echte Render-Logausgabe:**

```text
> node --test backend/*.test.mjs
ℹ tests 57
ℹ pass 57
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
==> Build successful
```

Das ist ein belegter Unit-/Integrationstest-Referenzstand für `main`.
Er ist **kein** vollständiger Nachweis sämtlicher OCPP-Kommandos,
Frontend-Anzeigen, Hardware-Funktionen oder Kundenflüsse. Da Render
bei einem nicht erfolgreichen `npm install` kein neues Build
veröffentlichen kann, bestehen die alten Build-Tests als erste
Deployment-Schranke. Automatisches Deploy auf `main` ist aktiv.

## Aktueller CI-Blocker – nach Wiederholung bestätigt

Der neue [PR #11](https://github.com/mawosned/ChargeVisor-Business/pull/11)
hat das neue Backend-CI unter Node 20/22 ausgelöst. Workflow
[45060763141](https://github.com/mawosned/ChargeVisor-Business/actions/runs/45060763141)
scheiterte beim ersten Versuch und erneut nach Re-Run. Laut
GitHub-Run-/Job-Metadaten: `runner_id=0`, `runner_name=""`,
`steps=[]`, Fehler nach etwa einer Sekunde. Alte CI-Workflows
auf `main` scheitern ebenfalls vor dem Start der Schritte.

**Wichtig:** Die Ursache des fehlgeschlagenen Runner-Starts ist
noch nicht verifiziert. Billing-/Budget-/Account-Beschränkungen
sind möglich, aber ohne den nicht zugänglichen GitHub-Check-Annotation-
Text keine gesicherte Diagnose. Der GitHub-Kontoinhaber kann das
im verlinkten Actions-Lauf und unter `Settings → Billing and licensing`
sowie `Repository → Settings → Actions → General` prüfen.

**Kein Merge von PR #11**, bevor die CI tatsächliche Tests ausgeführt
und bestanden hat; kein manuelles Deployment.
Die neuen API-Vertragstests sind derzeit nur im Draft-Branch vorhanden.

## Der bestehende Schutz

`package.json` verwendet bereits `npm test`, das
`node --test backend/*.test.mjs` startet. Beispiele vorhandener
Backend-Testdateien:

- `backend/ocpp.test.mjs`: WebSocket-Authentifizierung, OCPP-Grundnachrichten,
  virtuelle Teststation, Identität und Rollenprüfung
- `backend/structure.test.mjs`: Mandantenisolation,
  Stations-/Connector-Provisionierung, Berechtigung,
  keine Passwort-Rückgabe
- `backend/auth.test.mjs`: Authentifizierung, Point Access,
  idempotente Zuweisungen und Mandantenisolation
- `backend/test-rfid.test.mjs`: Test-RFID und Rollen-/Originprüfung
- `backend/freecharge.test.mjs`: Freecharge-Konfigurationspfad
- `backend/charging-report.test.mjs`: PDF-Zugriffsrechte und Mandantentrennung

**Neu in dieser Phase:**

- `backend/ocpp-read-contract.test.mjs`: Endpunktvertrag für
  `GET /api/ocpp/live` und `GET /api/ocpp/sessions`,
  nicht angemeldete Nutzer, fehlenden Superadmin-Mandanten,
  Mandantentrennung, API-Datenschutz und exakten Connector-Lesepfad.
  Diese Tests benötigen keine reale Datenbank und keine laufende
  ChargeVisor-Teststation.
- `.github/workflows/backend-regression.yml`: `npm test` auf
  Node 20 und Node 22 bei Pull Requests gegen `main` und Push auf
  `main`. Der Workflow installiert mit `npm ci --ignore-scripts`,
  weil `package.json` sonst über `postinstall` bereits Tests ausführt.
  Keine Render- oder Datenbankzugangsdaten in CI nötig.

## Verpflichtender Freigabeprozess (ab jetzt anzuwenden)

1. Jede Änderung am Backend in einem neuen, von `main` abgezweigten Branch.
2. GitHub Pull Request; keine direkten Änderungen an `main`.
3. **Beide** Regressionstest-Jobs müssen erfolgreich beendet sein.
4. Regressionstest für die betroffene Bestandsfunktion und für die neue
   Funktion ergänzen.
5. Externe OCPP-WebSocket-/Hardware-Integration und reale API-/Datenbankprüfung
   auf separater isolierter Testinstanz ausführen.
6. Erst nach sachlicher Prüfung der Ergebnisse zusammenführen und deployen.
7. Falls ein Test zuvor **nicht** vorhanden war, ist das kein PASS; offen
   lassen und als Prüfung ergänzen. Nicht durch Entfernen des Tests lösen.

**Noch von GitHub-Repository-Admin einzustellen:** Unter
`Settings → Branches / Rulesets` eine verpflichtende PR-Regel für `main`
und erforderliche Statuschecks
`backend-regression (Node 20)` und `backend-regression (Node 22)`
aktivieren. Solange die Regel nicht aktiv ist, ist der Testworkflow eine
Kontrolle, aber noch **keine technische Merge-Sperre**.

## OCPP-Test-Roadmap

Die REST-Regressionstests sind nur der erste Schutzwall. Danach:

- CSMS-zu-Wallbox: RemoteStartTransaction, RemoteStopTransaction,
  SetChargingProfile, ClearChargingProfile, ChangeAvailability,
  Konfiguration, Reset und TriggerMessage
- Wallbox-zu-CSMS: BootNotification, Authorize, Start/StopTransaction,
  StatusNotification, MeterValues und Diagnose-/Firmwarestatus
- Berechtigungen, RFID, parallele Ladepunkte und Nutzerzuordnung
- Ladehistorie, Energie-/Leistungswerte, Tarife und CSV/PDF-Export
- Fehlercodes, Offline/Online, Reconnect und Standby
- Smart Charging und Master-/Slave-Lastmanagement
- weitere reguläre und optional unterstützte OCPP 1.6J Aktionen

Jede Funktion erhält separate Felder für
**implementiert**, **OCPP-Protokollantwort geprüft**,
**Backend-Resultat geprüft**, **Frontend-Zustand geprüft**,
**Hardware-Integration geprüft**. `PROTOCOL_OK` allein bedeutet
keinen erfolgreichen End-to-End-Test.

## Betriebsgrenzen

Diese Phase ändert nichts an der Render-Konfiguration und erstellt keine
Dauerzugangsdaten. Für den nächsten Schritt soll ein dauerhaft konfigurierter,
**ausschließlich auf isolierte Teststationen begrenzter** technischer Zugang
eingerichtet werden. Keine Test- oder Produktivzugangsdaten in GitHub,
Test-Logs oder Berichten ablegen.

**Verifizierungsstatus:** Testworkflow und neue Regressionstests liegen
zunächst als nicht gemergter Pull-Request-Entwurf vor. Ein erfolgreicher
GitHub-Actions-Lauf sowie Backend-Live-Tests müssen noch nachgewiesen werden.
