# ChargeVisor Business – Entwicklungsstand und Sicherheitsregeln (23.11.2026)

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

- [Aktuelle Backup-, Microsoft-365-, Kosten- und Render-Freigabeentscheidung](docs/backup-operations-decision-2026-11-23.md) – **zuerst lesen**, insbesondere bei Weiterentwicklung von Backup oder Deployment
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

