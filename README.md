# ChargeVisor Business – Entwicklungsstand und Sicherheitsregeln (23.11.2026)

## Verbindliche Entwicklungs- und Hostingentscheidung – 23.11.2026

**Diese Festlegung gilt für beide ChargeVisor-Repositories und ist bei jedem neuen Chat zuerst zu beachten. Sie korrigiert ältere allgemeine Upgrade-Empfehlungen.**

- **Neon bleibt vorerst kostenlos.** Wir nutzen für die separate ChargeVisor-Datenbank das bestehende Neon-Free-Projekt `chargevisor-business` (PostgreSQL 18) weiter und beobachten **reale Nutzungsgrenzen, Speicher, Verfügbarkeit, Wiederherstellungsfenster und Last**. **Kein vorsorgliches Neon-Upgrade und keine kostenpflichtigen Datenbankänderungen.** Wenn Neon Free nicht mehr ausreicht, prüfen wir **dann** die Optionen: ggf. Neon kostenpflichtig oder die **vollständige Datenbankmigration zu Render PostgreSQL**, sofern sinnvoll. Eine Migration ist eine **spätere Entscheidung**, kein bereits beschlossener Schritt. Produktions-Backups und unabhängige Restore-Tests bleiben trotzdem Pflicht.
- **Warum gibt es ein öffentliches und ein privates GitHub-Repository?** Beim privaten Repository `mawosned/ChargeVisor-Business` waren weitere GitHub-Actions-Tests durch die **Abrechnungs-/Budget-Sperre** blockiert. Deshalb wurde die separate Entwicklungskopie `mawosned/ChargeVisor-Business-Dev` **öffentlich** geführt, damit wir die dort ausführbaren Tests und die Weiterentwicklung ohne diesen Blocker fortsetzen können. **Das öffentliche Repo ist unser aktueller Arbeits- und Teststand.** Es darf **keine** echten Kundendaten, Passwörter, Tokens, DB-URLs, vollständige Datenbank-Dumps oder privaten Konfigurationswerte enthalten.
- **Rollen der Repositories:** `ChargeVisor-Business-Dev` = neue Backend-Funktionen, vorhandener Mobility-House-/Windows-Simulator, automatische OCPP-/Frontend-/Backup-/Restore-Tests, Fehlerkorrekturen und Dokumentation. `ChargeVisor-Business` = **privates Repository mit Verbindung zum bestehenden Render-Service**, aktuell **nicht** automatisch mit dem neuen Dev-Stand gleichzusetzen. Alles Bestehende bleibt erhalten; keine unaufgeforderten Refactorings, Löschungen oder ungeprüfte Übernahme.
- **Wann auf Render deployen?** **Erst wenn die öffentliche Entwicklung ausreichend fertig und nachweisbar durchgetestet ist** (CI, OCPP-Simulator, Mandanten/RFID/UI, Verschlüsselung/Backup/Restore, reale Hardwaretests soweit möglich). Dann wird der geprüfte Code **kontrolliert** ins private Repo übernommen und nach konkreter Freigabe auf Render deployed. **Nicht jetzt, kein automatischer Übertrag aus dem öffentlichen Dev-Repo.** Der Nutzer möchte den bestehenden Render-Deployment-/Freigabeablauf **nicht verändert** haben und gibt Releases selbst frei. Technisch ist beim privaten Render-Demo-Service `autoDeploy=yes` für privaten `main` aktiv; deshalb **keine ungefragten Commits auf privaten `main`**, auch nicht nur für Dokumentation.
- **Kosten:** Render für dauerhaft verfügbaren Betrieb ggf. kleinster geeigneter kostenpflichtiger Service **erst nach gesonderter Freigabe**. Neon **bleibt Free**, soweit es praktisch und sicher vertretbar ist. Kein Upgrade, keine Bezahlfunktion, kein Tarifwechsel und keine Migration ohne explizite Bestätigung.
- **Verbindlicher Startpunkt für künftige Assistenten:** Zuerst beide READMEs und `AGENTS.md`, die V1-Funktions-/Abnahmeliste sowie Backup-Runbooks lesen, den neuesten Dev-Commit und die tatsächlich grünen Tests prüfen und die Unterschiede zum privaten Render-Stand feststellen. Keine bereits erledigten Arbeiten erneut bauen; **immer im öffentlichen Dev-Repo weiterentwickeln** und erst am Ende freigegeben in privat/Render übertragen. Jede Änderung mit Commit, Testergebnis, offenen Punkten und nächstem Schritt dokumentieren.



> **ZUERST LESEN:** ChargeVisor Business ist ein vollständiges, eigenständiges OCPP-1.6J-Backend für Walectra (WEG/Firmenkunden), nicht nur die historische Browserdemo. Der aktive Entwicklungsstand und die funktionsfähigen CI-Tests liegen in diesem **öffentlichen Entwicklungsrepository**. Die nachfolgende alte Demo-Beschreibung bleibt ausschließlich als historischer Bezug bestehen.
>
> **Render-Freigabe ausdrücklich bestätigt:** Der Benutzer hat erklärt, dass der bisherige Render-Deployment-/Freigabeablauf **so bleiben soll**, weil er die Freigaben selbst steuert. **Keine Änderung an Render-Auto-Deploy-Einstellungen, Tarifen oder Produktivdiensten ohne erneuten ausdrücklichen Auftrag.** Technische Besonderheit: Die private Render-Demo ist mit `mawosned/ChargeVisor-Business` `main` verbunden und in Render ist `autoDeploy=yes` konfiguriert. Daher kann ein Commit auf privatem `main` tatsächlich einen Deploy auslösen. **Nicht ohne ausdrücklich freigegebenen Release auf private `main` schreiben.** Diese Unterscheidung ist verbindlich und darf nicht bei einem neuen Chat vergessen werden.
>
> **Verifizierter Dev-Referenzstand:** Commit `2ffdf095aac7cca57189585ff2271dd6b7ae70d9` – am 23.11.2026 **6/6 GitHub-Actions-Workflows grün**, darunter unabhängiger OCPP-Test, zehn Connectoren, Simulator, API/Frontend-Regression sowie **verschlüsseltes Backup und Restore einer isolierten PostgreSQL-16-Testdatenbank**. Das bedeutet **NICHT**, dass die echte Neon-18-Datenbank schon gesichert ist oder eine bezahlte WEG produktiv freigegeben ist.
>
> **Echte Infrastruktur (geprüft 23.11.2026):** Neon `chargevisor-business` auf PostgreSQL **18**, Free mit **6 Stunden PITR**; die Microsoft-365-SharePoint-Site `ChargeVisorBackups` mit Ordner `Database-Backups` ist erreichbar, aber noch **leer**. Der private GitHub-Backup-Workflow wurde vom Billing-System **vor dem Start** blockiert. Die Entra-App `ChargeVisor Backup` besitzt nach Einrichtung `Sites.Selected` + Site-`write`; ein erfolgreiches Upload steht aus.
>
> **Zielbetrieb vor Kundenstart:** Täglich verschlüsselte volle PostgreSQL-Backups nach SharePoint; zusätzlich zweimal wöchentlich verschlüsselte CSV-Snapshots abgeschlossener Nicht-Test-Ladevorgänge, getrennte Schlüsselverwaltung, echte Wiederherstellungsprobe, unabhängige Ausfallalarme und kontrollierter Release-/Rollback-Test. **CSV ersetzt keinen DB-Dump. Keine zusätzlichen Kosten ohne Benutzerfreigabe.**

## Maßgebliche Dokumente – nach jedem Arbeitsblock aktualisieren

- [Neue verschlüsselte Cloud-Backup- und Session-CSV-Implementierung (noch NICHT produktiv aktiviert)](docs/secure-sharepoint-archive-runbook.md) – verschlüsselter DB-Dump, 2×/Woche CSV, Microsoft Graph Upload und Tests\n- [Aktuelle Backup-, Microsoft-365-, Kosten- und Render-Freigabeentscheidung](docs/backup-operations-decision-2026-11-23.md) – **zuerst lesen**, insbesondere bei Weiterentwicklung von Backup oder Deployment
- [V1 Funktionsliste und offene Abnahmen](docs/v1-feature-implementation-and-gaps.md) – Code, CI und Hardware-Pilot strikt unterscheiden
- [Betriebs-, Backup-, Monitoring- und Restore-Runbook](docs/v1-production-readiness-runbook.md) – bereits getestete Wiederherstellungslogik; Produktivaktivierung offen
- [Verbindliche Entwicklungsregeln](AGENTS.md) – keine Funktionen entfernen, Tests/Freigaben vor Übernahme
- [Unabhängiger OCPP-Simulator](tools/ocpp-chain-simulator/README.md) und [Mobility-House-Simulator](docs/mobilityhouse-simulator.md) – vorhandene Simulatoren erhalten, nicht neu bauen

**Fortsetzung im nächsten Chat:** Beide Repositories lesen (`ChargeVisor-Business-Dev` und `ChargeVisor-Business`), diese README, `AGENTS.md`, das Runbook und die aktuelle Funktionsliste prüfen, Commit/CI/Render-Status abgleichen. Keine vorhandene Funktion überschreiben, keine stille Übernahme in den privaten Live-Branch. Erst dann beim neuesten offenen Punkt ansetzen.

---

# ChargeVisor Business – isolierte Demo

Web-Frontend-Prototyp für das Firmenkunden- und WEG-Lademanagement von Walectra.

Die aktuelle Anwendung ist unter `/login` und `/app` erreichbar. Sie enthält
die Mandantenverwaltung, die OCPP-1.6J-Anbindung und die RFID- und
Ladehistorie für den Hardwarepilot. Der [Hardwarepilot-Leitfaden](docs/hardware-pilot.md)
beschreibt Inbetriebnahme, Tests und offene Voraussetzungen für den Kundenbetrieb.

## Ursprüngliche Demo

## Stand
- Drei **simulierte** Rollen: Walectra-Superadmin, Mandanten-Admin, Nutzer
- Mehrere Beispielmandanten und Ladepunkte
- Monatliche Ladevorgänge, Verbrauch in kWh, CSV-Export
- Nutzer einladen und Ladepunkte anlegen (**nur Simulation**; Änderungen im Browser-LocalStorage)
- Master-/Slave-Anzeige (**Simulation**, keine Hardware-Steuerung)

**Es gibt hier noch KEINE echte Authentifizierung, Mandanten-Trennung auf Serverseite, E-Mail-Einladung, Datenbank oder OCPP-Verbindung.** Die Rollenansicht ist eine Frontend-Demo, keine Zugriffskontrolle. Keine echten Kundendaten eingeben.

## Lokal starten
Node.js 20 oder neuer installieren, dann:
```bash
npm start
```
Danach http://localhost:10000 öffnen.

## Render: isolierter Testservice
- Neuer separater Web Service, nur dieses Repository: `mawosned/ChargeVisor-Business`
- Runtime: **Node**
- Region: **Frankfurt**
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Für Vorschau ist Free möglich, aber Free-Dienste können inaktiv werden. **Nicht** für produktives OCPP verwenden.
- Keine bestehenden BLITZ-Services, Datenbanken oder OCPP-Adressen ändern.

## Weiterentwicklung
- Separate API und PostgreSQL-Datenbank
- Serverseitige Mandanten- und Benutzerberechtigungen
- E-Mail-Einladungen mit einmaligen Tokens
- OCPP 1.6J und Hardwarevalidierung (sechs OCPP-IDs oder ein Master mit mehreren Connectoren)
- Tests, Lasttests, Sicherung/Wiederherstellung, Security Hardening
- Originales ChargeVisor-Logo noch nicht eingebunden

**Technische und organisatorische Trennung von BLITZ ist zwingend.**

## Neu: Echte Anmeldung als separater Pilot

Unter `/login` gibt es nun eine echte PostgreSQL-basierte Backend-/Login-Implementierung mit Nutzer-Einladungen, Tenant-Rechten und Walectra-Lizenzfreigabe. Die vorhandene Frontend-Demo bleibt bewusst unabhängig.

**Wichtig:** Die Anmeldung ist derzeit nicht aktiviert, weil eine dedizierte ChargeVisor-Datenbank fehlt; wir verwenden nicht heimlich die BLITZ-Staging-Datenbank. Siehe [Auth Setup und Grenzen](docs/auth-foundation.md).

