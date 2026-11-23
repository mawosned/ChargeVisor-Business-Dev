# ChargeVisor Business V1 – Betrieb, Backup, Monitoring, Deployment & Rollback

## Gültigkeit und Freigabestatus

**Zielgruppe:** Firmenstandorte, Dienstwagen und WEG (kein öffentliches Laden).
Diese Implementierung betrifft nur das öffentliche Entwicklungsrepository
\`mawosned/ChargeVisor-Business-Dev\`.

**Frontend eingefroren:** Die bestehenden 14 HTML-/JS-/CSS-/Bilddateien bleiben
byteidentisch. Jede Änderung wird durch \`verify-frontend-unchanged.mjs\`
verhindert und zusätzlich mit Playwright geprüft.

**Produktionsbetrieb ist noch NICHT freigegeben.** Das private, auf Render
live geschaltete Repository und seine Datenbank bleiben unverändert.
Automatisierte Tests sind keine reale Hardwareabnahme.

## Backup / Restore – wie die Betriebssicherung funktioniert

\`scripts/ops/database-archive.mjs\` kann:

- einen vollständigen \`pg_dump\` im PostgreSQL-Custom-Format erzeugen;
- den Dump **während des Streams** mit AES-256-GCM verschlüsseln;
- eine verschlüsselte \`.cvbak\`-Datei mit beschränkten Dateirechten erzeugen;
- jede Sicherung durch Entschlüsselung und Authentifizierung prüfen;
- sie ausschließlich in eine **leere, isolierte lokale**
  \`chargevisor_restorecheck\`-Datenbank zurückspielen;
- korrupte Backups, falsche Schlüssel und vorhandene Zieldaten ablehnen.

Keine Produktionsdaten, Kennwörter oder verschlüsselten Sicherungsarchive
werden in GitHub gespeichert oder als öffentliches CI-Artefakt hochgeladen.

### Einmalige Einrichtung auf einem abgesicherten Backup-Rechner

Der Betreiber benötigt einen PostgreSQL-Client, eine Netzwerkverbindung zur
**dedizierten ChargeVisor-Produktionsdatenbank**, einen separaten
Backup-Speicherort sowie einen **stark geschützten** 32-Byte-Schlüssel.
Beispiel für Linux (nur Platzhalter, nicht in Git/GitHub eingeben):

\`\`\`bash
export CV_DATABASE_URL='<GEHEIMER-POSTGRES-URL>'
export CV_BACKUP_KEY_HEX='<64-HEX-ZEICHEN-AUS-KRYPTOSICHEREM-ZUFALL>'
node scripts/ops/database-archive.mjs backup /private/chargevisor-backups
node scripts/ops/database-archive.mjs verify /private/chargevisor-backups/<DATEI>.cvbak
\`\`\`

Der Key muss getrennt von den Backups aufbewahrt werden. Wer den Key verliert,
kann Backups nicht mehr entschlüsseln. Ein einzelnes lokales Laufwerk ist
**kein** belastbares Backup-Ziel; benötigt wird externes und redundant
geschütztes Storage mit regelmäßiger Prüfung.

**Sicherheitsgrenze:** Die Restore-Automatik ist absichtlich auf lokale
\`chargevisor_restorecheck\`-Datenbanken begrenzt. Sie darf **nicht**
versehentlich die produktive Datenbank löschen oder überschreiben.

\`\`\`bash
export CV_RESTORE_TARGET_URL='postgresql://...@127.0.0.1/chargevisor_restorecheck'
export CV_RESTORE_CONFIRM=RESTORE_TO_EMPTY_ISOLATED_DATABASE
node scripts/ops/database-archive.mjs restore /private/chargevisor-backups/<DATEI>.cvbak
\`\`\`

Ein echter Restore wird separat vorbereitet, während die Kundendatenbank
unverändert bleibt. Erst nach Validierung von Nutzern, Standorten, RFID,
Transaktionen, Zählerständen und Protokollhistorie kann in einem
freigegebenen Wartungsfenster umgeschaltet werden.

**Zusätzliche Wiederherstellungsvoraussetzung:** Nicht in PostgreSQL
gespeicherte Render-/Provider-Konfiguration und Secrets müssen getrennt
sicher abgelegt werden: \`CV_MS_TENANT_ID\`, \`CV_MS_CLIENT_ID\`,
\`CV_MS_CLIENT_SECRET\`, \`CV_MS_ENCRYPTION_KEY\`, \`CV_RFID_HMAC_KEY\`,
SMTP-/OCPP-/Webhook-Konfiguration und sämtliche Runtime-/DNS-Parameter.
Die Werte selbst gehören **nicht** in diese Dokumentation oder Git.

### Automatisierte reale Restore-Übung

\`.github/workflows/v1-backup-restore.yml\` erstellt für jeden PR eine
frische **wegwerfbare PostgreSQL-16-Datenbank**, verschlüsselt einen echten
Dump, stellt ihn in einer zweiten Datenbank wieder her, vergleicht
Kunden-/Systemdatensätze und Kern-Tabellen und verhindert überschreibende
oder manipulierte Restores. Der PostgreSQL-Client stammt aus dem
**identischen PostgreSQL-16-Docker-Image**.

Für die Produktion müssen noch eingerichtet und überprüft werden:
- Backup-Ausführung auf einem unabhängigen, zuverlässigen Host,
  mindestens täglich (bei kritischen Ladevorgängen häufiger entsprechend
  festgelegtem RPO).
- Gesicherter externer Speicher, Rotation, Zugriffskontrolle und
  getrennt verwaltete Entschlüsselungsschlüssel.
- Wiederkehrende Restore-Übung und dokumentiertes RPO/RTO.
  **Keiner dieser Punkte ist durch die CI automatisch aktiviert.**

## Ausfallerkennung

### Intern (ohne Frontendänderung)

\`GET /api/ocpp/ops-summary\`: bestehende Cookie-Authentisierung,
**ausschließlich Superadmin**, liest:
- angeschlossene physische Stationen,
- getrennte Stationen,
- Stationen mit seit mehr als 180 Sekunden fehlendem OCPP-Lebenszeichen,
- offene und nicht bestätigte Ladevorgänge,
- letzte OCPP-Verbindung und Firmware-Metadaten.

Es werden **keine** Kundentransaktionen geändert, keine RFID-UIDs oder
OCPP-Passwörter ausgegeben. Ein Verbindungsabbruch ist **kein**
Stromausfallbeweis. Der Ablauf verwendet nur unverändernde SQL-Abfragen.

### Extern (unabhängiger Prozess)

\`scripts/ops/health-probe.mjs\` prüft \`https://.../health\` in bis zu
drei Versuchen. HTTP 200 allein genügt nicht: \`status=ok\`,
\`authReady=true\` und \`mode=auth\` müssen übereinstimmen.
Demo-Modus ist ausdrücklich **NICHT** gesund.

\`.github/workflows/v1-availability-watchdog.yml\` ist eine optionale
15-Minuten-Überwachung außerhalb des Backend-Prozesses. Bei Ausfall wird
ein einzelnes GitHub-Incident-Ticket eröffnet; bei Erholung geschlossen.
**Der GitHub-Workflow ist noch DEAKTIVIERT** und benötigt später in
Repository-Variablen:
- \`CV_MONITOR_ENABLED=1\`
- \`CV_MONITOR_TARGET_URL=https://<echte-domain>/health\`

Der Betreiber muss die GitHub-Benachrichtigungen beobachten, eine
Kontakt-/Eskalationsregel für Nächte und Wochenenden festlegen und
Fehlalarme sowie Wiederherstellung testen. GitHub Scheduled Actions
sind **kein SLA-basierter 24/7-Monitoringdienst**; bei ernsthaftem
Betrieb müssen die Alarmierungs- und Laufzeitgarantien geprüft werden.

## Kontrollierter Deploy

\`scripts/ops/prepare-private-release.ps1\`:
1. liest den **aktuellen** öffentlichen Dev-Commit;
2. verlangt **sechs erfolgreich abgeschlossene CI-Workflows** exakt auf
   diesem Commit (Backend, Browser, OCPP, Windows-Simulator, WEG,
   Backup/Restore);
3. verifiziert, dass alle 14 Frontend-Dateien **byteidentisch** mit
   der privaten Produktion sind;
4. klont private Produktion und öffentlichen Dev-Stand getrennt;
5. legt zunächst einen gesicherten **privaten Backup-Branch** an;
6. übernimmt ausschließlich Backend, Tests, Scripts, Dokumentation und
   Runtime-Manifest-Dateien in einen **neuen privaten Release-Branch**;
7. führt Node-Tests und die Frontend-Sperre erneut aus;
8. erstellt einen **DRAFT-Pull-Request im privaten GitHub-Repository**.
   **Kein Merge, kein Render-Deploy, keine Datenbankänderung.**

Die Freigabe des privaten Release-PRs erfolgt erst **nach** einem
echten Backup, dokumentiertem Hardwaretest, DB-Migrationscheck,
Ausfallsimulation, Restore-Probe, Abrechnungsprüfung und abgestimmtem
Wartungsfenster. Produktionsdeploys sind nicht Teil des automatischen
Skripts.

## Kontrollierter Rollback

\`scripts/ops/prepare-private-rollback.ps1\`:
1. liest die im Release abgelegte \`ops-release-manifest.json\`;
2. prüft den **vorherigen privaten Backup-Commit** und dessen SHA;
3. setzt nur die im Release geänderten Backend-/Runtime-Dateien auf
   diesen geprüften Stand zurück;
4. testet die resultierende Anwendung;
5. erstellt einen **neuen privaten Draft-Rollback-PR**.

**Kein** automatisches \`git reset --hard\` auf Produktions-\`main\`.
**Keine** automatische Zurücksetzung oder Überschreibung von
Kundendatenbanken. Neue additive Tabellen dürfen bei einem
Application-Rollback vorhanden bleiben. Destruktive Migrationen
werden vor Release grundsätzlich separat behandelt.

## Simulator und Dauertests

- Die Windows-GUI bleibt optisch unverändert. Sie simuliert
  WEG-Master mit bis zu 20 Connectoren, 11/22 kW, RFID und Fehler.
- Der unabhängige OCPP-1.6J-Protokollpfad simuliert nun
  \`UpdateFirmware\`, \`Downloading\`, \`Downloaded\`,
  \`Installing\`, \`Installed\` und eine neue \`BootNotification\`.
  **Das simuliert einen Ablauf – keine echte Firmware wird geladen.**
- Das eigenständige \`power_cycle_scenario.py\` trennt die
  OCPP-TCP-Verbindung während einer aktiven Transaktion abrupt,
  verifiziert den offenen Datenbankdatensatz, verbindet neu und
  beendet die Transaktion mit \`PowerLoss\`; echte elektrische
  Stromunterbrechungen kann nur der Hardwarepilot abnehmen.
- Die bestehenden Windows-Dauertests und Desktop-Tests bleiben
  erhalten. Der lokale Updater prüft den neuen Stand zunächst
  und kann beim Fehler auf die vorherige Version zurückrollen.

## Vor Freigabe noch wirklich OFFEN

| Abnahme | Voraussetzung |
|---|---|
| Echte Wallbox nach Stromausfall: RFID, Transaktionsspeicherung, Messwert | Hardware + Netzausfalltest |
| Firmware-Update inkl. Stromverlust während Flash & Recovery | Vom Hersteller freigegebene Testfirmware + Testgerät |
| 10 physische Ladepunkte / Lastmanagement / §14a-Steuerung | Elektrischer Hardwarepilot |
| Mess-, Tarif-, Abrechnungs- und ggf. Eichrechtskonformität | Rechtliche/messtechnische Abnahme |
| Produktions-Backup wirklich regelmäßig in externen Speicher geschrieben | Externer Storage + Betreiberentscheidung |
| Echte Production-Datenbank 1:1 in isoliertem Restore-Pilot wiederhergestellt | Betreiberzugang + geschütztes Recovery-Ziel |
| Externe Benachrichtigung nachts und am Wochenende | Konfiguration + Probealarm |
| Dedizierter immer erreichbarer Produktionsservice statt Demo-Free | Hosting-/Kostenentscheidung |
| Finaler privater Release-PR und überwachte Pilotbereitstellung | Alle vorherigen Nachweise und Operator-Freigabe |

**Anforderung:** Nicht „fertig“ melden, solange eine dieser zwingenden
Abnahmen offen ist. Alles CI-getestete wird als **automatisiert geprüft**,
nicht als vollständige Hardware-/Produktionsabnahme bezeichnet.


### OCPP-Stationsmonitor: einmalige Secret-Konfiguration bei Produktivfreigabe

Neben der Web-App-Erreichbarkeit prüft der Watchdog die echte Verbindung
**physischer** Stationen. Der neue Maschinenendpunkt
GET /api/ops/health ist **standardmäßig deaktiviert** und antwortet 404,
bis CV_OPS_MONITOR_TOKEN_SHA256 als 64-stelliger SHA-256-Hash eines
zufälligen privaten Tokens in der Backend-Umgebung gesetzt ist.

Für den echten Produktionsbetrieb ist einmalig einzurichten:

- Backend (private Laufzeitkonfiguration):
  CV_OPS_MONITOR_TOKEN_SHA256 = SHA256 des Monitortokens;
  CV_OPS_EXPECT_STATIONS = Anzahl der erwarteten physischen OCPP-Verbindungen.
- GitHub-Actions-Secret des öffentlichen Development-Repos:
  CV_OPS_MONITOR_TOKEN = derselbe unverschlüsselte lange, zufällige Token.
  **Niemals** im Quelltext, Query-String oder Log speichern.
- Repository-Variablen:
  CV_MONITOR_ENABLED = 1 und
  CV_MONITOR_TARGET_URL = https://<echte-domain>/health.

Der externe Prüfer fragt /health sowie /api/ops/health ab.
Beide müssen gesund sein. "Demo" zählt nicht, eine fehlende Station,
ein veralteter Heartbeat oder eine getrennte Wallbox ebenfalls nicht.
Für die Details meldet sich der Walectra-Superadmin an und nutzt
GET /api/ocpp/ops-summary. Die öffentlich an GitHub gemeldeten
Störungstickets enthalten **keine** Kunden- oder Ladepunktidentität.

Der Schutz lässt sich unmittelbar widerrufen, indem das Backend-
Tokenhash entfernt wird. Ein solcher Widerruf löst zurecht einen
Monitorfehler aus, bis die Konfiguration aktualisiert wurde.

**Nicht behaupten, die Überwachung laufe bereits:** Solange keine
geeignete Produktionsinstanz und keine einmalig freigegebenen
Secret-/Alarm-Einstellungen existieren, bleibt die externe
Überwachung deaktiviert. Auch erfolgreich konfigurierte GitHub-
Scheduled-Actions ersetzen keine rund um die Uhr garantierte
Monitoring-/Alarmierungsplattform.
