# ChargeVisor – sichere SharePoint-Backups und verschlüsselte Session-Snapshots

**Erstellt:** 23.11.2026 · **Status:** Entwicklungsbranch, isolierte Tests vorgesehen. **Kein produktiver Scheduler aktiviert; kein echter Neon-Dump/Upload nachgewiesen.**
Gilt für `mawosned/ChargeVisor-Business-Dev`. Vor privater Freigabe Benutzerentscheidungen in `README.md` und `docs/backup-operations-decision-2026-11-23.md` lesen.

## Was die Implementierung tatsächlich tut

- `scripts/ops/cloud-archive-runner.mjs database`: lädt das bereits existierende `createBackup()` aus `database-archive.mjs`. `pg_dump` streamt die **gesamte** ChargeVisor-Datenbank ins **AES-256-GCM-verschlüsselte** `.cvbak`-Format. `createBackup()` entschlüsselt das Resultat anschließend zur lokalen Kontrolle und prüft dessen `PGDMP`-Signatur. Der neue Uploader akzeptiert ausschließlich verschlüsselte Archive und überprüft nach dem Upload die von SharePoint bestätigte **Dateigröße**.
- `scripts/ops/cloud-archive-runner.mjs sessions`: liest **ohne Schreibzugriff** alle **abgeschlossenen, nicht simulierten** Datensätze aus `cv_ocpp_transactions` über eine konsistente `REPEATABLE READ READ ONLY`-Momentaufnahme. Spalten: stabile Session-ID, Tenant-ID, OCPP-Identity, Connector, Beginn/Ende in UTC, Zähler Start/Ende (Wh), berechnete kWh, Stopgrund, Signaturflag. Stable ID-Order, seitengroße SQL-Abfragen statt eines einzigen sehr großen Resultats.
- Der Session-Export ist `UTF-8 BOM`, Semikolon-CSV mit Excel-Formelschutz und **vollständiger Neuaufnahme** statt fehleranfälliger Delta-Synchronisation. **Offene** Transaktionen stehen ausschließlich im vollständigen DB-Backup. Weitere personenbezogene Angaben wie Namen, E-Mail oder RFID sind **nicht** Teil des CSV.
- Das reine CSV liegt nur kurzzeitig in einem privaten temporären Verzeichnis, wird **vor Upload** authentifiziert verschlüsselt, lokal entschlüsselt und über SHA-256 gegen die ursprünglichen CSV-Bytes verglichen. Dateiendung `.cvcsv`, identischer GCM-Containerheader `CVBKP001` wie `.cvbak`, jedoch **kein** PostgreSQL-`pg_restore`-Archiv.
- `scripts/ops/sharepoint-uploader.py` verwendet die **bestehende** Entra-App `ChargeVisor Backup` mit `Sites.Selected` und Site-`write` zum Upload in `ChargeVisorBackups/Database-Backups` via Graph-Upload-Session. Upload-URL muss per HTTPS auf einer Microsoft-SharePoint-/OneDrive-Domain liegen; `conflictBehavior=fail` verhindert unabsichtliches Überschreiben. Größenvergleich als Upload-Abschlusscheck.
- Nach erfolgreichem Upload oder Fehler wird der temporäre Ordner entfernt. **Kein** Backup oder Secret wird ins Git-Repository, in ein öffentliches GitHub-Artefakt oder in eine Render-Datei kopiert. Exceptions/Logs geben bewusst keine Datenbank-URL, keinen Graph-Token und keine Kundendaten aus.
- `scripts/ops/pg18-dump.sh` startet PostgreSQL-18-`pg_dump` in einem separaten Docker-Container; der Datenstrom geht direkt an Node und wird beim Schreiben verschlüsselt. Lokaler PG16-CI-Restore bleibt unangetastet.

## Ausdrücklich **nicht** aktiviert

Die Entwicklungsimplementierung enthält **weder** Produktionsgeheimnisse **noch** einen produktiven Schedule. Der im privaten Repo bislang vorbereitete Rohdump-Workflow darf **nicht** ungeprüft für echte Kundendaten laufen: Sein SharePoint-Ziel ist noch leer und er verschlüsselt den Dump nicht vor dem Upload.

Das Dev-Repository ist **öffentlich**. Es bleibt ausschließlich für Quellcode und künstliche Testdaten. Kein Produktions-`DATABASE_URL`, GCM-Key, SharePoint-Secret, Kunden-CSV oder echtes Dump in dieses Repository oder seine Actions-Secrets übernehmen. Neue produktive Runner-Konfiguration erst **im privaten** Repo und erst nach dokumentierter Freigabe, CI, Graph- und Restore-Prüfung.

## Für den später freigegebenen privaten Scheduler nötige Einstellungen

Exakt einmal sicher als **private Secret-Werte**, niemals in README oder Chat:
- `CV_DATABASE_URL` (alternativ `NEON_DATABASE_URL`) – dedizierte Neon-**18**-Datenbank, nicht BLITZ;
- `CV_BACKUP_KEY_HEX` – zufällig generierter, separat verwahrter 32-Byte-AES-Schlüssel als 64 Hex-Zeichen; **Wiederherstellung unmöglich, wenn verloren**;
- `CV_MS_TENANT_ID`, `CV_MS_CLIENT_ID`, `CV_MS_CLIENT_SECRET` – App `ChargeVisor Backup` (nicht `ChargeVisor Mail`);
- `CV_BACKUP_SITE_ID` – exakt die registrierte SharePoint-Site-ID, nicht irgendeine Team-Site;
- `CV_BACKUP_FOLDER=Database-Backups` – bestehender, zugriffsgeschützter SharePoint-Ordner.
- Bei auf GitHub-Linux ausgeführtem PostgreSQL-18-Dump: `CV_PG_DUMP_BINARY=./scripts/ops/pg18-dump.sh`, `CV_ALLOW_PRODUCTION_BACKUP=YES_ENCRYPTED_ONLY`, Docker-Verfügbarkeit und Ausführungsrecht des Shell-Skripts. **Nicht** denselben 16er-Dump-Client wie die isolierte Restore-CI verwenden.

Nur nach Benutzerfreigabe und bestätigtem GitHub-Billing auf einem privaten, von Render getrennten Runner starten:
```bash
node scripts/ops/cloud-archive-runner.mjs database
node scripts/ops/cloud-archive-runner.mjs sessions
```

Vorgesehene Zeitintervalle: Vollbackup **täglich**; CSV-Snapshot **zweimal pro Woche** (z.B. Montag/Donnerstag). Das ist **noch kein aktiver Cronjob**. Bei großen Beständen oder starkem laufendem Betrieb RPO und Backup-Frequenz anpassen, beispielsweise häufiger als täglich. Eine doppelte CSV-Sammlung ist ein zusätzliches Archiv und kein vollständiger Restore.

## Tests, die bereits vorgesehen sind
- `node --test scripts/ops/csv-session-format.test.mjs scripts/ops/session-snapshot.test.mjs` prüft deterministische Spalten, CSV-Sicherheit, verschlüsselte Momentaufnahme, Key-Länge und SQL-Read-only gegen künstliche Daten;
- `python -m unittest discover -s scripts/ops -p 'test_sharepoint_uploader.py' -v` prüft Upload/Größenvergleich mit einer **lokal simulierten** Graph-Antwort und Ablehnung von unverschlüsselten Dateien, unsicheren Hostnamen und Größenfehlern;
- `.github/workflows/secure-sharepoint-archive-tests.yml` führt diese Tests (ohne echte Kundendaten/Secrets) auf dem Entwicklungs-PR aus.

**Diese Offline-Tests sind KEIN Live-Upload, keine echte Wiederherstellung der Neon-18-Datenbank, keine Realhardware-Abnahme und keine laufende Datensicherung.** Erst nach privatem Release, Verifikation von Secret-Konfiguration/SQL-Rechten, wirklichem Upload, lokalem Recovery aus **genau der hochgeladenen Datei**, gemessener Wiederherstellungsdauer und Probealarm als für den Betrieb geeignet bezeichnen.

## Aufbewahrung und Betrieb
Vorschlag: tägliche verschlüsselte Vollbackups 30–90 Tage, zusätzlich regelmäßige Monatsstände; die konkrete Frist richtet sich nach Speicher/Verlustziel und einer DSGVO-/steuerrechtlichen Lösch- und Belegaufbewahrungsregel. Für rechtsrelevante Abrechnungsunterlagen gelten ggf. **andere** Aufbewahrungsfristen als für rohe OCPP-Logs oder unnötige Personenstammdaten. **Es findet kein automatisches Löschen statt.** Zunächst ein dokumentiertes Löschkonzept, Schutz vor Löschung/Überschreiben und ein zweiter unabhängiger Offline-Sicherungspunkt.

Das vorhandene Monitoring ist bisher nur vorbereitet, nicht in der echten Kundenumgebung aktiv: separat von Backup prüfen. Vor bezahltem WEG-Betrieb echte Hardware, Rückmeldung bei Stromausfall, Lastmanagement, Messdatenkorrektheit, OCPP-Reconnect, Firmware- und Dokumentations-/Rollback-Abnahme.
