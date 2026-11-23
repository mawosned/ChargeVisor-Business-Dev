# ChargeVisor Business – Entwicklungsstand und Sicherheitsregeln (23.11.2026)

## Bestätigter Windows-Simulator-Start – 23.11.2026 (aktuell)

**Ergebnis nach fehlgeschlagenem Updater-Versuch: DER BESTEHENDE SIMULATOR STARTET WIEDER.** Der Nutzer hat bestätigt, dass nach Ausführung des folgenden PowerShell-Blocks die vorhandene Windows-Simulator-Oberfläche wieder funktioniert. Das belegt den **lokalen GUI-Start**, aber noch keinen neuen Download, keine aktuelle Versionsnummer, keine aktive OCPP-Verbindung und keinen erfolgreichen Lade-/End-to-End-Test.

**Ab sofort zuerst diesen funktionierenden Startweg nutzen – ohne automatisches Update:**

~~~powershell
$root = 'C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests'

$starts = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'START-SIMULATOR.cmd' |
    Where-Object { $_.FullName -notmatch '\\backup-\d' })

if ($starts.Count -eq 1) {
    Start-Process -FilePath $starts[0].FullName -WorkingDirectory $starts[0].DirectoryName
}
else {
    $starts | Select-Object -ExpandProperty FullName
    Write-Host "Gefundene Simulator-Starts: $($starts.Count)"
}
~~~

**Warum das funktioniert:** Der Block sucht die reale Startdatei rekursiv, statt eine vermutete Ordnerstruktur vorauszusetzen. Nur bei **genau einem** Treffer wird die GUI gestartet; andernfalls erscheinen die gefundenen Pfade/Anzahl. Er lädt nichts herunter, ersetzt keine Dateien, ändert kein GitHub/Render/Neon und unterbricht nicht die echte Lumina. Für eine neue Unterhaltung diesen Block als **letzten bestätigten funktionierenden Start** bevorzugen.

**Gescheiterter Einmalversuch davor (keine Reparatur behaupten):** Ein vorheriger PowerShell-Block ging irrtümlich von einem festen Ort für `UPDATE-SIMULATOR.ps1` unter `tools\ocpp-chain-simulator` aus. Die Benutzerkonsole zeigte `Copy-Item: Pfad nicht vorhanden` und `WriteAllBytes: Ein Teil des Pfades konnte nicht gefunden werden`. Die abschließende Ausgabe `Neuer DEV-Updater installiert` war nur eine irreführende `Write-Host`-Zeile; tatsächlich wurde **kein erfolgreicher Austausch des Updaters** bestätigt. Der genaue Installationspfad/Updater-Stand auf Windows wurde nicht aus der Ferne verifiziert. Einen neuen Update-Versuch **nicht zur Voraussetzung des Simulator-Starts machen**. Falls später nötig: erst vorhandene Datei(en) lokalisieren, exakte `$repo`-Quelle prüfen, funktionierende Installation sichern und danach gezielt aktualisieren – nicht blind überschreiben.

**Nächste Tests, sobald die GUI läuft:** Eine separate, nicht abrechnungsrelevante Teststation/OCPP-ID und eigenes Passwort einsetzen (niemals Zugangsdaten/Identität der echten Lumina). Verbinden → Boot/Heartbeat/Status → RFID/Authorize → StartTransaction/MeterValues/StopTransaction → Störung/Reconnect. Dann 5-Minuten-Rauchtest, später Dauertest mit lokalem Ergebnisbericht. Der neue Kettensimulator kann künstliche Sessions wie reale Transaktionen speichern; deshalb Testmandant/Teststation klar abgrenzen und die Trennung in Historie/Reports prüfen.

**Reale Enelion Lumina erhalten:** `Lumina Garage / Stellplatz 1` ist laut Nutzer echte bereits erfolgreich ladende Hardware; nicht als Simulator einsetzen, nicht neu provisionieren, nicht unterbrechen. Öffentliche Entwicklung `ChargeVisor-Business-Dev` und privater Render-Stand `ChargeVisor-Business` bleiben getrennt; Neon Free und bestehende Render-Freigabe bleiben unverändert. Keine finanzielle Änderung oder privater Deploy ohne Benutzerfreigabe.



## Windows-Simulator: geprüfte Updatequelle und gewohnter PowerShell-Start (23.11.2026)

**Konkreter lokaler Benutzerpfad** (nur Dokumentation, kein Zugriff auf diesen PC):
`C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests`

**Bisheriger Startweg des Nutzers** (der Updater wird rekursiv gesucht, Sicherungsordner `backup-<Zahl>` ausgenommen):

```powershell
$root = 'C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests'

$updater = Get-ChildItem -LiteralPath $root -Recurse -File -Filter UPDATE-SIMULATOR.ps1 |
    Where-Object { $_.FullName -notmatch '\\backup-\d' } |
    Select-Object -First 1

if (!$updater) { throw 'Updater nicht gefunden' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater.FullName
```

**Achtung, dieses alte Verfahren kann die FALSCHE VERSION laden.** Am 23.11.2026 wurde der Quellcode beider Updater ausdrücklich verglichen:
- Im **alten privaten** Branch `mawosned/ChargeVisor-Business` / `feature/mobilityhouse-ocpp-chain-tests` enthält `tools/ocpp-chain-simulator/UPDATE-SIMULATOR.ps1` tatsächlich `$repo = 'mawosned/ChargeVisor-Business'`. Der alte Updater lädt damit weitere Dateien aus der **alten privaten Feature-Version**, nicht automatisch den heutigen Entwicklungsstand.
- In der **aktuellen öffentlichen Entwicklung** `mawosned/ChargeVisor-Business-Dev` / `main` ist die gleichnamige Datei korrekt auf `$repo = 'mawosned/ChargeVisor-Business-Dev'` und `param([string]$Branch = 'main')` eingestellt.
- **Beide Updater aktualisieren ihre eigene Datei `UPDATE-SIMULATOR.ps1` nicht** (sie fehlt in ihrer `$files`-Liste). Wer einmal den alten Updater auf dem PC liegen hat, landet durch bloßes wiederholtes Ausführen nicht automatisch bei der neuen öffentlichen Version.
- Der genaue lokale Inhalt ist **noch nicht geprüft**, da keine Verbindung zum Windows-Dateisystem vorliegt. Der Ordnername weist auf die alte Feature-ZIP hin, beweist aber nicht, welche Datei der Nutzer heute tatsächlich dort liegen hat.

**Sicherer Einmalschritt:** Zuerst den lokalen Updater aus dem angegebenen Ordner ermitteln, die Zeile `$repo = ...` anzeigen und vor einem Update eine Kopie der vorhandenen Datei anlegen. Falls sie noch auf `ChargeVisor-Business` zeigt, die **einzelne Updater-Datei** gezielt aus `https://github.com/mawosned/ChargeVisor-Business-Dev/blob/main/tools/ocpp-chain-simulator/UPDATE-SIMULATOR.ps1` beziehen, Inhalt auf `ChargeVisor-Business-Dev` + `main` kontrollieren und anschließend den gewohnten PowerShell-Aufruf wiederholen. Kein pauschales Überschreiben des gesamten Arbeitsordners. Nicht unkritisch den ersten Treffer nehmen, wenn mehrere aktive Updater gefunden werden. GitHub-CLI- und Python-Voraussetzungen des neuen Updaters beachten.

**Bewährter Schnellstart nach korrekter Aktualisierung:** Eine eigens erstellte, **nicht real genutzte** OCPP-Teststation (eigene WSS-URL, eigene Charge-Point-ID und eigenes Basic-Auth-Passwort) verwenden, niemals die echte Lumina-Identität oder ihre Zugangsdaten. `START-SIMULATOR.cmd` im `tools/ocpp-chain-simulator`-Ordner startet die vorhandene GUI. Die GUI kann Master + bis zu 20 Connectoren, Laden/Stoppen, Fehler, RFID, Reconnect und 5- bzw. 120-Minuten-Dauertests simulieren.

**Wichtiger Isolationsunterschied:** Der **erweiterte Windows-Ketten-Simulator** arbeitet laut seiner eigenen aktuellen README mit einer als `normale` OCPP-Hardware angelegten **TEST-Station**, nicht zwingend mit `is_simulator=true`. Seine Testtransaktionen können dadurch wie reale Ladevorgänge aussehen und in Auswertungen eingehen. Deshalb ausschließlich in einem klar getrennten Testmandanten/Testsystem ohne reale Abrechnung betreiben, bis die Trennung code- und datenbankseitig nachweisbar ist. Der **separate, ältere `scripts/ocpp-test-wallbox.py`** dagegen sieht eine explizit virtuelle Teststation und `simulated=true` vor. Nicht beide Szenarien vermischen.

**Reale Referenz-Hardware beibehalten:** Im bisherigen ChargeVisor-Backend ist eine **echte** Enelion Lumina eingerichtet (Screenshot: `Lumina Garage`, `Stellplatz 1`, Master Connector 1, `Bereit`); laut Nutzer war sie bereits angeschlossen und hat tatsächlich erfolgreich geladen. Kein Simulator. Nicht löschen, nicht neu provisionieren, nicht auf eine Simulator-ID umstellen. Weitere echte Wallboxen nur mit eigenen OCPP-Zugangsdaten anschließen.

**Architektur- und Freigabestand:** `ChargeVisor-Business-Dev` öffentlich = Weiterentwicklung/Tests (öffentlich wegen früherer GitHub-Actions-Abrechnungssperre des privaten Repo). `ChargeVisor-Business` privat = Render-gebundener, bestehender Stand. Neon Free zunächst behalten, ggf. später zu Render PostgreSQL wechseln, falls sinnvoll. Render-Einstellungen bleiben wie vom Nutzer gewünscht; **kein ungefragter privater `main`-Push/Deploy**. Erst Simulator-/CI-/Hardwaretests und Freigabe, dann kontrolliert übernehmen.

**Aktualisierter nächster Schritt beim nächsten Chat:** Der Simulator startet wieder mit dem oben dokumentierten **START-SIMULATOR.cmd-Suchbefehl**. Den Updater nicht als Voraussetzung behandeln. Zuerst GUI und getrennte Teststation kontrollieren; danach 5-Minuten-Rauchtest und längeren Dauertest durchführen. Eine spätere Updater-Korrektur setzt die Prüfung des tatsächlichen lokalen Pfads und eine Sicherung voraus. Ergebnisse und echte Hardwarezustände strikt getrennt kontrollieren. Testerfolg erst nach Log/Screenshot oder tatsächlichem Live-Nachweis markieren.



## Reale Enelion Lumina bereits verbunden – Hardware-Referenz (23.11.2026)

**Verifizierte Benutzerinformation und Screenshot, keine neue Live-Abfrage:** Im bestehenden **privaten** ChargeVisor-Backend ist bereits eine **echte physische Enelion Lumina** eingerichtet. Der Nutzer bestätigt ausdrücklich, dass diese Wallbox **bereits erfolgreich verbunden war und real geladen hat**. Der Screenshot aus `Standorte & Ladepunkte` zeigt die Station **„Lumina Garage“** mit einem Ladepunkt **„Stellplatz 1“**, OCPP **Connector #1 · Master**, Status **„Bereit“**, **0 kW** zum Zeitpunkt des Screenshots. **Die Statusanzeige zeigt keinen aktuellen Ladevorgang; erfolgreiche frühere reale Ladevorgänge sind Nutzerangabe, kein hier neu ausgeführter Hardwaretest.** Keine OCPP-Identität, Passwörter, RFID-Daten oder personenbezogene Nutzerinformationen in einem öffentlichen README ablegen.

- **WICHTIG:** Diese Lumina ist **keine Simulation** und darf niemals versehentlich zu `is_simulator=true` konvertiert, gelöscht, ersetzt, neu provisioniert oder als Simulator-OCPP-Identität genutzt werden. Ihre bestehende OCPP-Verbindung und die erfolgreiche Ladefunktion dürfen durch neue Tests nicht unterbrochen werden.
- **Der richtige nächste Entwicklungsschritt ist ein Mischbetrieb:** (1) vorhandene reale Lumina erhalten und ihre realen OCPP-Ereignisse/abgeschlossenen Ladevorgänge kontrolliert prüfen; (2) zusätzliche physische Wallboxen jeweils mit **eigenem** OCPP-Profil/Connector-Mapping verbinden; (3) externe OCPP-Simulatoren parallel mit **eigenen, eindeutig getrennten Test-Identitäten** starten.
- **Schnellstart manuelles Testgerät:** Das bereits vorhandene Python-Bedienfeld `scripts/ocpp-test-wallbox.py` (Dokumentation: `docs/mobilityhouse-simulator.md`) kann lokal mit `python scripts/ocpp-test-wallbox.py --port 8765` gestartet werden, nachdem seine Abhängigkeiten installiert sind. Für getrennte virtuelle Test-IDs weitere eigene Prozesse/Ports. Die Teststation in ChargeVisor **ausdrücklich als virtuelle Test-Wallbox kennzeichnen**, nur Testnutzer/-RFID nutzen; Testtransaktionen müssen `simulated=true` bleiben und dürfen nicht in Abrechnung auftauchen.
- **Erweiterter Windows-Simulator:** `tools/ocpp-chain-simulator/START-SIMULATOR.cmd` startet das bereits vorhandene GUI für **eine OCPP-Master-ID mit bis zu 20 Connectoren**, Status, Laden/Stop, Fehler, Reconnect und Dauertests (siehe `tools/ocpp-chain-simulator/README.md`). **Achtung – anderes Datenmodell:** Die dortige aktuelle Anleitung verlangt eine als **normale physische Station** angelegte Test-ID und warnt ausdrücklich, dass ihre künstlichen Ladevorgänge **nicht automatisch von realen Ladevorgängen unterscheidbar** sind. Daher diesen Simulator **nicht** mit der realen Lumina-ID verwenden und bis zur überprüften Testdatenisolation nur in einer eigens getrennten Testanlage/Testmandanten bzw. isolierten Testumgebung verwenden, **niemals** für abrechnende echte Kunden. Vor dauerhaften Mischtests die Unterscheidung in Code, Datenbank und Berichten absichern und mit Tests belegen.
- **Keine Codebasis verwechseln:** Das aktuelle öffentliche Entwicklungsrepository enthält neuere Funktionen als das private, mit Render verbundene Repository. Eine bereits funktionierende reale Lumina im privaten Backend ist **kein Nachweis**, dass der neueste öffentliche Entwicklungs-Commit auf Render läuft. Bestehenden privaten Render-Service unverändert lassen; Dev-Code zuerst isoliert testen, später erst kontrolliert nach ausdrücklicher Freigabe deployen.
- **Nächster Testplan:** eigene virtuelle Testanlage anlegen, Simulator mit neuer WSS/OCPP-Test-ID verbinden, Heartbeat/Status → Authorize/RFID → StartTransaction → MeterValues → StopTransaction → Reconnect/Störung testen. Live-Status und Historie pro Connector sowie korrekte Abgrenzung von echten/virtuellen Vorgängen prüfen. Danach **parallel** reale Lumina beobachten und weitere echte Hardware mit je eigener OCPP-ID/Connector-Zuordnung hinzufügen. Abschließend 24h-Dauertest auf einer unabhängigen Laufzeit und Hardwaretests (Netzausfall, Offline-RFID, Lastmanagement); keine Erfolgsbehauptung ohne tatsächlichen Nachweis.
- **Hostingentscheidungen bleiben:** Neon Free weiter nutzen; keine kostenpflichtige Änderung oder privater Render-Deploy ohne Freigabe. Das öffentliche Repo ist Entwicklungs-/Teststand, das private Repo enthält den momentan mit Render verbundenen älteren Stand.


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

