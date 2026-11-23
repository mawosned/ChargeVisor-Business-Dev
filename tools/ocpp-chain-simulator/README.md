# ChargeVisor – unabhängiger Ladeketten-Simulator

## FIX BESTÄTIGT / AUSGELIEFERT IM DEV – HTTP 403 bei normalem OCPP-Simulator behoben (23.11.2026)

- **Öffentliches `ChargeVisor-Business-Dev/main`**, Merge-Commit `d6e3bf32778a59d1fca78d734cb95a0456dab7f6`, <https://github.com/mawosned/ChargeVisor-Business-Dev/pull/12>. **Alle sechs PR-CI-Workflows erfolgreich** (einschließlich OCPP-Desktop-Simulator-Tests und ChargeVisor-Browserregression). Der neue Regressionstest stellt sicher, dass `desktop_simulator.py` **keinen `X-ChargeVisor-Test-Wallbox`-Header** mehr an eine reguläre OCPP-Verbindung anhängt.
- **Verbindliche technische Vorgabe:** Der Windows-Simulator emuliert eine echte OCPP-1.6J-Wallbox und verbindet sich mit den normalen ChargeVisor-Daten: WSS-Endpunkt `.../ocpp/`, Charge-Point-ID und zugehöriges OCPP-Basic-Auth-Passwort. **Normale, als `is_simulator=false` registrierte Ladeketten sind zugelassen**, auch `Ladekette Tiefgarage Süd` (`cv6zgvs85d`, 6 Ladepunkte). Keine Pflicht, auf `lumina KI test`/`cv24067z51` (20 Ladepunkte) zu wechseln. Die Standardprüfungen auf korrektes Passwort, autorisierte Station und eindeutige aktive Verbindung gelten weiterhin. `is_simulator` entscheidet lediglich über Kennzeichnung der gespeicherten Test-Ladevorgänge: bei `false` als normale `simulated=false`-Transaktion, bei `true` als simuliert. Keine zusätzlichen Kundenabrechnungen während dieser Tests ausführen.
- **Andere Funktionen bleiben erhalten:** automatischer WebSocket-Reconnect und der ehrliche 120-Minuten-Soak-Bericht mit Unterbrechungs-/Reconcile-Ereignissen, keine Änderung am Web-Frontend, kein neues Render-Deployment. Nachkontrolle: Der auf Render laufende private Commit ist weiter `52116c1a4538061b2fcbb61f100bc7fad967d3b2`, Status `live`. Alle GUI-, Auth-, RFID-, Benutzer-, Customer-, LED- und Design-Dateien unberührt.
- **Was jetzt auf Windows zu tun ist:** In der bereits geöffneten Windows-GUI auf **„Simulator aktualisieren“** klicken. Der installierte, vorher geprüfte `UPDATE-SIMULATOR.ps1` lädt aus dem öffentlichen Dev-`main`, führt **alle Offline-Tests inklusive `test_reconnect.py` vor Austausch** aus, legt ein Backup an und startet die GUI neu. Alternativ den im Simulator-README beschriebenen funktionierenden PowerShell-Startweg verwenden. Danach bisherige WSS-Adresse, `cv6zgvs85d`, **6 Connectoren**, zugehöriges OCPP-Passwort und berechtigte Test-RFID einsetzen und `Verbinden` testen. **GitHub-CI ist kein Beleg für Windows-/Render-Echtverbindung**, die live noch überprüft werden muss.
- **Separate offene Aufgabe bleibt:** **WICHTIG** – verschlüsseltes Neon→SharePoint-Backup samt echtem Upload/Download/Restore testen, keine Abnahme erfolgt.



## VERBINDLICH: Simulator verhält sich wie eine echte OCPP-Wallbox (Korrektur 23.11.2026)

**Nutzeranforderung:** Die OCPP-WebSocket-ID, Server-URL und das Basic-Auth-Passwort **aus ChargeVisor direkt im Simulator eingeben** – dann soll die Verbindung **genau wie mit einer echten Enelion/OCPP-1.6J-Wallbox** funktionieren. Eine besondere `is_simulator`-Markierung, spezielle HTTP-Header oder eine andere Login-Art dürfen **keine Voraussetzung** für den externen Windows-Simulator sein. Eine ganz normale, passend konfigurierte 6er-Ladekette muss mit ihren sechs Connectoren ebenso funktionieren wie eine dedizierte virtuelle 20er-Teststation.

**Behobene Regression:** Bei der letzten Version sendete die GUI den nicht standardmäßigen Header `X-ChargeVisor-Test-Wallbox: 1`; der existierende OCPP-Server antwortete bei jeder regulären `is_simulator=false`-Station mit **HTTP 403**, auch wenn ID und Passwort korrekt waren. Dieser Header ist im Desktop-Client **entfernt**. Die GUI stellt wieder die reguläre WSS-OCPP-1.6J-Verbindung mit Standard-Basic-Auth her. Die bestehenden Backend-Prüfungen auf registrierte ID, OCPP-Passwort, aktive Station und doppelte Verbindung bleiben erhalten; **kein Backend-Code geändert**. Die Reconnect- und Soak-Testverbesserungen bleiben enthalten.

**Wichtige Datenwirkung:** Bei `is_simulator=false` (z. B. **Ladekette Tiefgarage Süd**, OCPP-ID `cv6zgvs85d`, sechs Connectoren) behandelt das Backend die künstlichen Test-Ladevorgänge **als reguläre Transaktionen** (`simulated=false`). Für reinen Testbetrieb ist das technisch zulässig, muss aber bei Historien/Exports bewusst berücksichtigt werden. Bei `is_simulator=true` werden sie als simuliert gekennzeichnet. Keine personenbezogenen Produktiv-Daten/Kundenabrechnungen mit dem Simulator unbeabsichtigt verändern. Eine echte aktive Wallbox kann nicht gleichzeitig mit einem Simulator unter **derselben OCPP-ID** verbunden sein.

**Bedienung nach lokalem Update:** GUI öffnen; `wss://chargevisor-business-demo.onrender.com/ocpp/` + OCPP-ID + **zu dieser ID gehörendes** OCPP-Passwort + passende Anzahl Connectoren eingeben und **Verbinden** drücken. **Keine Pflicht zum Wechsel auf `cv24067z51`**, die bisherige `cv6zgvs85d` ist zulässig. Im nächsten Schritt zunächst 5-Minuten-Test, dann 120-Minuten-Lauf; Auth-/Konnektivitäts- und Transaktionsresultate in Backend/Neon überprüfen. Dieser Abschnitt **ersetzt frühere widersprüchliche Angaben in diesem Dokument**, nach denen die GUI nur `is_simulator=true` verwenden dürfte.



## NEU – Wiederverbindung und realistischer Soak-Test nach dem 30-Minuten-Abbruch (23.11.2026)

**Befund des ersten realen 120-Minuten-Tests:** Nur ca. 30 Minuten geschafft, weil die lokale WebSocket-Verbindung unerwartet und ohne Close-Frame abbrach. Render zeigte in der betroffenen Zeit keinen Deploy/Crash und wenig CPU/RAM; die echte Lumina sendete weiter Heartbeats. Die Ursache des Transportabbruchs ist NICHT nachgewiesen. Der erste Test verwendete versehentlich `Ladekette Tiefgarage Süd` (6 Connectoren, `is_simulator=false`, Test-Transaktionen als `simulated=false`), NICHT die vorhandene virtuelle `lumina KI test` (20 Connectoren, `is_simulator=true`). Die 7 Transaktionen #53–59 wurden in Neon mit korrektem Stop gespeichert; 674 MeterValues, 58 Heartbeats, 38 StatusNotifications, 9 Authorize. JSON-Matrix 21 PROTOCOL_OK/61 NOT_TESTED/0 FAIL, während der Gesamtlauf FAILED endete. 0 FAIL in der Matrix bedeutete NICHT, dass der Gesamtlauf erfolgreich war.

**Neuer Desktop-Entwicklungsstand (vor lokalem Einsatz Tests/CI kontrollieren):**

1. Die Windows-GUI verbindet nach unerwartetem WebSocket-Ende mit **begrenztem exponentiellem Backoff** automatisch neu (2/4/8/16/30 Sekunden, dann maximal 30 Sekunden). **Manuell Trennen und Fenster schließen** beenden diesen Versuch. Jede Unterbrechung und jeder Versuch werden in `%USERPROFILE%\ChargeVisor\ocpp-test-results\simulator-transport.log` dokumentiert (UTC-Zeit, Close-Code/Reason soweit verfügbar, fehlgeschlagene Wiederverbindungsversuche; kein RFID-/OCPP-Passwort). Das unterscheidet Diagnose von einem Beweis der Ursache.
2. Der laufende Soak-Test **wartet bei Transportausfall**, ohne den 120-Minuten-Zeitplan sofort abzubrechen. Nach neuem OCPP-Boot und Status-Synchronisierung geht es weiter. Der Test behält die zuvor verwendeten Zählerstände; **alle offenen, beim Abbruch bekannten Transaktionen werden zuerst mit StopTransaction gegenüber dem Backend abgeschlossen**, bevor neue Ladevorgänge starten. Schlägt diese Wiederherstellung fehl, darf der Soak nicht ungeprüft fortsetzen; es wird weiter eine Verbindung versucht bis zum Zeitende.
3. Jeder unerwartete Disconnect wird **als FAIL in `SCENARIO.Offline.Disconnect`** und im `soak-report.json` protokolliert. Ein späterer Reconnect erzeugt `SCENARIO.Offline.Reconnect=PROTOCOL_OK`, aber löscht das vorherige FAIL nicht. Ein durchgelaufener Test mit Abbruch heißt `COMPLETED_WITH_INTERRUPTION`, nicht `COMPLETED`; bleibt der Socket bis zum Zeitende offline, endet er `FAILED`. Zusätzliche Kennzahlen: `transport_interruptions`, `transport_recoveries`, `recovered_transactions`, `pending_recovery_at_finish`. Die vorhandenen Soll/Ist-, CSV- und JSON-Berichte bleiben erhalten.
4. **Normale OCPP-Kompatibilität wiederhergestellt (Korrektur):** Kein Sonder-Header mehr. Jede korrekt provisionierte Test-Ladekette kann mit ihrer regulären WebSocket-ID, dem zugehörigen OCPP-Passwort und der passenden Connector-Anzahl verbunden werden. Bei `is_simulator=false` werden die erzeugten Ladevorgänge als normale Historie gespeichert; bei `true` als simuliert. Es gibt **keine Pflicht**, für den Windows-Simulator die virtuelle 20er-Station zu verwenden.
5. Bei bewusster Auswahl einer neuen Station leert die GUI ihre **nur lokal** zwischengespeicherten Recovery-Zähler und alten Transaktions-IDs. Bestehendes ChargeVisor-Web-Frontend (`app.html`, `app-live.js`, `styles.css`, Logos/Bilder/LEDs), Render und Neon werden durch diesen Simulator-Branch **nicht** verändert.

**Vor dem nächsten echten 120-Minuten-Test:** erst nach grünen Simulator-Tests den neuen Stand **lokal** auf dem Windows-PC installieren (ein GitHub-Code-Commit aktualisiert eine bereits gestartete Desktop-GUI NICHT automatisch), Simulator starten, `wss://chargevisor-business-demo.onrender.com/ocpp` + `cv24067z51` + richtiges Test-OCPP-Passwort + **20 Connectoren** eintragen. Zuerst 5-Minuten-Rauchtest. Ohne für die Testpunkte zugewiesene, freigeschaltete RFID können keine Ladevorgänge starten. Für den großen Test das lokale GUI-Fenster und Windows aktiv lassen. Danach `soak-report.json`, `soak-events.csv`, `ocpp-soll-ist.json` und `simulator-transport.log` zusammen auswerten. `PROTOCOL_OK` ist allein KEIN automatischer DB-/GUI-Nachweis; die Live-Daten direkt gegen Neon und die bestehende Web-UI prüfen.

**Offen / wichtig:** (a) Erfolgreicher Windows-Realtest des neuen Reconnect-Codes steht noch aus. (b) Statuswerte und letzte Leistungswerte nach Stop (z. B. `Available` mit 11.040 W), veraltete Connector-7–10-Livezeilen beim vorherigen 6er-Test und die richtige Trennung von simulierten/realen Historien in Web-UI kontrollieren. (c) Automatisches verschlüsseltes **Neon→SharePoint-Backup inkl. echtem Restore** separat weiterhin WICHTIG – NOCH TESTEN.



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



## Aktuelle Updatequelle und bekannter Windows-Pfad (23.11.2026)

**Zuletzt geprüft:** Der im **öffentlichen** Repo `mawosned/ChargeVisor-Business-Dev`, Branch `main`, vorliegende `UPDATE-SIMULATOR.ps1` lädt Dateien aus **`ChargeVisor-Business-Dev/main`**. Der ähnlich benannte Updater im **alten privaten** Feature-Branch `mawosned/ChargeVisor-Business/feature/mobilityhouse-ocpp-chain-tests` lädt dagegen aus dem privaten Repo. **Beide ersetzen sich beim Ausführen nicht selbst**, da `UPDATE-SIMULATOR.ps1` nicht in der jeweiligen Dateiliste steht.

Der Nutzer hat bisher folgende PowerShell-Aufrufart verwendet:

```powershell
$root = 'C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests'
$updater = Get-ChildItem -LiteralPath $root -Recurse -File -Filter UPDATE-SIMULATOR.ps1 |
    Where-Object { $_.FullName -notmatch '\\backup-\d' } |
    Select-Object -First 1
if (!$updater) { throw 'Updater nicht gefunden' }
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater.FullName
```

**Wichtig:** Der lokale Updater wurde noch nicht direkt überprüft. Vor erneutem Start die `$repo = ...`-Zeile prüfen. Falls die alte private Quelle drinsteht, erst **diesen einen Updater** aus der aktuellen öffentlichen Dev-Version ersetzen (vorher sichern). Nur nach überprüfter Quelle ausführen; mehrere aktive Kandidaten nicht blind über `-First 1` auswählen. Das ist eine lokale Simulatoraktualisierung, **kein Render-Deployment**.

**Belegter Hardwarestand:** Die bestehende **Enelion Lumina** ist echte Hardware und hat laut Nutzer bereits erfolgreich geladen. Screenshot: `Lumina Garage`, `Stellplatz 1`, `Bereit`, OCPP-Master-Connector 1. Sie bleibt unverändert. Sämtliche simulierten Stationen benötigen **separate Test-OCPP-Identitäten**, nie die Lumina-ID. Da der erweiterte Kettensimulator derzeit künstliche Sessions wie normale physische Sessions eintragen kann, keine echten Kunden-/Abrechnungsstationen oder Kundennutzerdaten für seine Tests verwenden. Zuerst 5-Minuten-Rauchtest, danach Dauertest mit getrennten Testkonten/Stations-IDs.

**Repository-Strategie:** Öffentliches Dev-Repo für Entwicklung und Tests (nach privat blockierter GitHub-Actions-Abrechnung); privates Repo für spätere kontrollierte Übernahme und Render. Neon Free bleibt vorerst. Render-Konfiguration und reale Hardware-Anbindung ohne gesonderte Freigabe unverändert lassen.


Eigenständiger Python-OCPP-1.6J-Client auf Basis von The Mobility House.
Eine OCPP-WebSocket-Verbindung (Master) mit 1 bis 20 einzeln bedienbaren
Connectoren (Master=Connector 1, Slaves=Connector 2..N). Die lokale GUI ist
kostenlos; es wird keine zusätzliche Render-Instanz verwendet.

## WICHTIG: Was bedeutet Charge Point ID bei einer Enelion-Ladekette?

Nach dem offiziellen Enelion-White-Paper (11.03.2025) gilt:

- **Master:** eine OCPP Charge Point ID und eine WebSocket-Verbindung.
- **Slaves:** eigene **Connector ID** (z. B. 2, 3, 4), keine eigene OCPP-Identität.
- Jede physische Slave-Wallbox kann zusätzlich eine eigene Seriennummer oder
  CAN-/Mesh-Netzwerkadresse haben. Diese ist nicht die OCPP Charge Point ID.
- Der Simulator bildet eine gemeinsame OCPP-Identität mit individuell
  steuerbaren Connector-IDs 1 bis N nach. Er sendet **keine CAN-Bus-Frames**.

Quellen:
- https://service-support-enelion.happyfox.com/kb/article/29-white-paper-connecting-enelion-lumina-stations-to-the-ocpp-backend-system/
- https://service-support-enelion.happyfox.com/kb/article/30-white-paper-application-of-can-bus-for-wired-connection-of-enelion-lumina-chargers-and-enelion-energy-guard/

## Automatischer 2-Stunden-Dauertest (neu)

Mit der lokalen Windows-GUI:

1. Wie bisher **normale** Ladekette in ChargeVisor anlegen und OCPP-ID,
   Passwort und WebSocket-URL eintragen. Die Anwendung manuell verbinden.
   Die Station darf **keine reale Kundenstation** sein. Sie verwendet reguläre
   ChargeVisor-Ladehistorie und darf nicht abrechnungsrelevant sein.
2. 10 Connectoren einstellen, falls die ChargeVisor-Ladekette tatsächlich
   10 Ladepunkte besitzt. Bei jedem Test werden genau die konfigurierten
   Connectoren angesprochen.
3. Eine vorher in ChargeVisor einem aktiven Nutzer **für sämtliche
   gewünschten Ladepunkte** zugewiesene RFID-UID in das Feld
   „RFID/idTag“ eintragen. **Ohne akzeptierte RFID werden keine
   Ladevorgänge gestartet**; die restlichen Status-/Fehlertests laufen weiter.
4. Unter **Automatischer OCPP-Dauertest · Soll / Ist** die Dauer
   `120 Minuten` wählen (oder `5 Minuten` für den ersten Kurztest).
   **Automatischen Test starten** klicken und bestätigen.
5. Die GUI bleibt geöffnet; Windows wird während des Laufs
   am automatischen System-Standby gehindert. PC nicht herunterfahren,
   Browser/Netzwerkverbindung der ChargeVisor-Instanz nicht unterbrechen.
   Bei vorzeitigem Abbruch **Beenden + Bericht erstellen** klicken.
6. Nach dem regulären Ende öffnet sich automatisch die OCPP-Soll-/Ist-Konsole.
   Über **Letzten Bericht öffnen** gelangst du zu den CSV-/JSON-Dateien.

### Realistische Testgeschwindigkeit und Ladeleistung

- **Ein Testschritt, danach mindestens 60 Sekunden Pause**. Ein gemeldeter
  Fehler bleibt damit mindestens eine Minute sichtbar, bevor das nächste
  Testszenario beginnt. Die normalen Heartbeats und MeterValues laufen
  währenddessen als OCPP-Telemetrie weiter.
- **Keine gleichzeitigen Änderungen an allen Wallboxen**: Jeder Status oder
  Fehlercode betrifft in einem Schritt nur einen Connector. Für das bewusste
  parallele Lastmanagement-Szenario werden zehn Wallboxen **nacheinander**,
  etwa eine pro Minute, hochgefahren; am Ende einzeln gestoppt.
- Die Standard-Nennleistung ist jetzt **11 kW dreiphasig**:
  3 × 230 V × 16 A = **11,04 kW** je Wallbox. In der GUI kann alternativ
  **22 kW dreiphasig** (3 × 230 V × 32 A = **22,08 kW**) gewählt werden.
  Leistung und Stromangaben werden beim Verbinden übernommen.
- Die Lastmanagementprobe begrenzt die *gesamte* Ladekette lokal auf
  **30 kW**. Bei zehn aktiven Wallboxen können nicht alle mit 11 kW
  laden; der Simulator verteilt deshalb die Leistung bzw. setzt einzelne
  Ladepunkte auf SuspendedEVSE.
- **Zeitgrenze:** Bei 120 Minuten und mindestens 60 Sekunden je Schritt
  lassen sich nicht alle möglichen Kombinationen aus 10 Connectoren,
  9 Statuswerten, 16 Fehlercodes und allen CSMS-Kommandos überprüfen.
  Die automatische Matrix markiert nicht durchgeführte Kombinationen
  als **NOT_TESTED**, nicht als PASS. Ein 5-Minuten-Lauf ist ein
  erster Rauchtest, nicht die vollständige OCPP-Abdeckung.
- Die interaktive Schaltfläche **Dauertest (60 s pro Schritt)** in der
  Soll/Ist-Konsole startet denselben kontrolliert getakteten Ablauf.
  Die frühere Schnelltest-Funktion, die Statuswerte im Sekundenbruchteil
  wechselte, ist aus der Bedienoberfläche entfernt.

### Wiederkehrende Prüfschritte

Der Simulator hält **eine** OCPP-WebSocket-Verbindung (Master) und führt
diese Tests mit der beschriebenen Pause und nacheinander aus:

- Boot bereits beim Verbinden, dazu wiederholte Heartbeats, inklusive
  Kontrolle des OCPP-Response-Felds `currentTime`
- OCPP 1.6J StatusNotification: Available, Preparing, Charging,
  SuspendedEV, SuspendedEVSE, Finishing, Reserved, Unavailable, Faulted
- Alle 16 Standard-`errorCode`-Werte, vor allem OverCurrentFailure,
  HighTemperature, GroundFailure, PowerMeterFailure, UnderVoltage
- Ablehnung einer neu generierten, nicht registrierten RFID-Karte sowie
  Authorize eines freigeschalteten Test-Tags
- Für jeden freigegebenen Connector StartTransaction, laufende
  MeterValues und StopTransaction; eindeutige Transaktions-IDs,
  paralleles Laden, unterschiedliche Connector IDs
- Lokal simulierte gemeinsame Grenze von **30 kW**, Abschalten
  einzelner Connectoren auf 0 W / SuspendedEVSE, 6-A-Regel,
  Leistungs-/Zählerwerte pro Connector
- SuspendedEV und SuspendedEVSE *während einer noch aktiven*
  Transaktion, anschließend Wiederaufnahme der Ladung
- Monitoring, ob während des Tests echte OCPP-Smart-Charging-Profile
  **vom Backend** eingegangen sind
- Der Testzyklus wird bis zu der gewählten Dauer wiederholt.
  Nach jedem Check werden Ergebnisse lokal gesichert.

### Ergebnis und Einschränkungen

Die automatische Matrix wird **nicht** pauschal als bestanden markiert:

- `PROTOCOL_OK`: ChargeVisor hat die entsprechende OCPP-Nachricht
  beantwortet. Das ist ein Verbindungs-/Protokollnachweis, noch kein
  Nachweis für richtige Datenbank-/Frontend-Darstellung.
- `FAIL`: tatsächlich beobachtete OCPP-Fehler, abgelehnte
  autorisierte Tags, fehlerhafte Transaktionen, Timeouts, falsche
  Zuordnungen im simulierten Modell.
- `NOT_TESTED`: nicht automatisch auslösbare
  CSMS→Wallbox-Funktionen, fehlende RFID-Berechtigungen,
  Offline-/Reconnect- und externe DLM-Szenarien ohne Gegenstelle.
- `NOT_IMPLEMENTED`: nur bei tatsächlicher fehlender
  Protokollimplementierung, nicht schon wegen nicht erfolgter Prüfung.
- `PASS`: erst nach expliziter Prüfung des betreffenden
  ChargeVisor-Datenbank-/Frontend-Verhaltens mit Nachweis.

Das Programm hat nur WebSocket-Zugangsdaten der Wallbox,
**keine Administrator-API-Sitzung und keinen lesenden DB-Zugang**.
Daher kann es derzeit NICHT automatisch prüfen, ob der Status im
Frontend korrekt gerendert wurde, Benutzerzuordnungen/Abrechnung in
PostgreSQL stimmen oder ChargeVisor einen bestimmten Grenzwert
selbst berechnet hat. Diese Tests bleiben offen, bis ein autorisierter,
schreibgeschützter API-/Datenbankprüfer angebunden ist.
Backend-Funktionen wie Reset, ReserveNow, UpdateFirmware, GetDiagnostics,
SendLocalList usw. können außerdem nicht durch die Wallbox selbst
ausgelöst werden. Sie stehen in der Matrix, werden aber erst als
getestet markiert, wenn ChargeVisor sie tatsächlich sendet.

**Lastmanagement:** Das 30-kW-Limit prüft das im Simulator
implementierte **lokale** Master-Leistungsmanagement; die Rückmeldung
kommt über MeterValues/StatusNotification. Eingehende
SetChargingProfile/ClearChargingProfile-Kommandos vom CSMS werden
modelliert. Ein vollständiger **Backend-DLM-Algorithmus** (beispielsweise
10 Wallboxen dynamisch auf einen vom Netzanschluss vorgegebenen Wert
regeln) wird damit nicht nachgewiesen.

### Lokale Berichte

Die Dateien liegen in
`%USERPROFILE%\ChargeVisor\ocpp-test-results\soak-YYYYMMDD-HHMMSS-xxxx`:

- `ocpp-soll-ist.csv` — vollständiger OCPP-Testkatalog für Excel mit
  Soll, Ist, Codecheck und Testergebnis
- `ocpp-soll-ist.json` — dieselbe Matrix für automatische Auswertungen
- `soak-events.csv` — zeitlicher Ereignisverlauf jedes Zyklus
- `soak-report.json` — Laufdauer, Anzahl Connectoren, Zustand,
  Ergebnisübersicht, lokales Lastmanagement und Ereignisse

RFID-Karten-UID und OCPP-Passwort werden **nicht** in Berichten gespeichert.
Ein abgebrochener Test speichert soweit möglich ebenfalls den Bericht.
Die Reports sind Ergebnisse deines lokalen Laufs; es wird kein
2-Stunden-Test im Chat oder in der Cloud gestartet.

## OCPP 1.6J Soll/Ist-Testkonsole (neu)

Der Button **OCPP SOLL / IST · Testkonsole** öffnet die komplette
OCPP-1.6J-Abdeckungsmatrix. Sie umfasst alle Nachrichten/Actions der
verwendeten Mobility-House-v16-Action-Enum (inkl. optionalen Security
Extensions), alle Standard-Connector-Status, alle StatusNotification-ErrorCodes
und End-to-End-Szenarien (RFID, 10er-Ladekette, Lastmanagement,
Offline-/Reconnect, Historie, Export).

Für jede Zeile stehen zur Verfügung:

- **SOLL**: OCPP-Verhalten plus erwartete Wirkung im ChargeVisor-Backend
- **Codecheck**: Aus dem geprüften GitHub-Backend-Code vorhanden / teilweise
  vorhanden / nicht gefunden (kein Nachweis für eine live deployte Instanz)
- **IST**: protokollierte OCPP-Antwort, Connector, Zeit, Teststatus
- **Prüfnachweis**: explizite Bestätigung von Nutzer/Tester, etwa „Status Faulted
  im Dashboard auf Stellplatz 3 gesehen“ oder eine Datenbank-/API-Referenz

Verfügbare Ergebnisse:

| Status | Bedeutung |
| --- | --- |
| NOT_TESTED | Noch nicht tatsächlich geprüft |
| PROTOCOL_OK | Auf echtem OCPP-Socket gesendet/empfangen; Backend/Frontend noch offen |
| PASS | Manuell mit Backend-/Frontend-Nachweis bestätigt |
| FAIL | Reale Prüfung fehlgeschlagen / falsche Antwort |
| NOT_IMPLEMENTED | Nicht unterstützt / im Live-Test als nicht implementiert erkannt oder dokumentiert |

**Niemals automatisch PASS:** Ein ACK auf StatusNotification belegt nur,
dass die Nachricht beantwortet wurde. Es belegt weder die korrekte Anzeige
noch Speicherung, Preisberechnung, Fehlerbehandlung oder Lastregelung.

**Einzelprobe**: gewünschte Zeile markieren, Connector wählen und
„OCPP-Test ausführen“. Nur Aktionen in Richtung Wallbox → ChargeVisor,
die ohne gefährliche Konfiguration auslösbar sind, besitzen automatische
Probes. Für Backend → Wallbox ist die echte Steuerung über ChargeVisor
auszulösen. Die unterstützten Simulator-Handler melden eingehende Befehle
automatisch in die Matrix, aber PASS erfordert den Nachweis der Wirkung.

**Automatisierter Lauf**: „Dauertest (60 s pro Schritt)“ nutzt den
getakteten Dauertest im Simulator-Hauptfenster. Das ändert Zustände in
der normalen ChargeVisor-Teststation und kann Transaktionen erzeugen.
Es darf nur mit einer eigens eingerichteten, **nicht abrechnungsrelevanten**
normal provisionierten Station durchgeführt werden.

**Nachweis eintragen**: erst nach tatsächlicher Prüfung „Backend/Frontend
PASS bestätigen“ wählen. Dokumentiere, *was* und *wo* du gesehen hast;
andernfalls ist PASS nicht möglich.

**Export und Verlauf**: CSV (Excel-kompatibel, Semikolon/UTF-8-BOM)
oder JSON. Ergebnisse werden fortlaufend lokal unter
`%USERPROFILE%\ChargeVisor\ocpp-test-results` gespeichert, getrennt
nach OCPP-Geräte-ID (Hash). RFID-Kartennummern und OCPP-Passwörter
werden nicht persistiert. Für echte Regressionsaussagen Testberichte
pro Version und Datum exportieren.

**Grenze:** Diese Anwendung konzentriert sich auf OCPP **1.6J**.
OCPP 2.0.1/2.1 ist eine weitere, gesonderte Testsuite.
Nicht jede OCPP-Action ist bereits voll emuliert, insbesondere
Firmware-/Diagnose-Uploads, Security Extensions und Hard Reset. Solche
Zeilen bleiben explizit NOT_TESTED / NOT_IMPLEMENTED.
Es gibt noch keinen automatischen Login auf die ChargeVisor-Weboberfläche
und keinen verifizierten Backend-DB-Lesezugriff; das IST aus Backend/Frontend
muss deshalb manuell nachgewiesen werden.

### Ohne neue ZIP-Datei aktualisieren

Im Simulator-Ordner liegt nun `UPDATE-SIMULATOR.ps1`. Dieser lädt die
aktuellsten Simulator-Dateien aus dem privaten GitHub-Branch, sichert die
alten Dateien, prüft die Python-Syntax, führt die lokalen Tests aus und
öffnet den Simulator. Nach der ersten Installation gibt es dafür zusätzlich
die Schaltfläche **Simulator aktualisieren**.

PowerShell im Simulator-Ordner:

`powershell -NoProfile -ExecutionPolicy Bypass -File .\UPDATE-SIMULATOR.ps1`

Voraussetzung: GitHub CLI (`gh`) mit Berechtigung zum privaten
ChargeVisor-Repository, Python 3.10+. GitHub Actions können
unabhängig davon an Runner-/Kontingentproblemen scheitern.

## Erweiterte Tests in der Windows-Oberfläche

**RFID ohne bekannte vorhandene Kartennummer:**

1. Mit der OCPP-ID und dem Passwort der eigens für Tests angelegten,
   normal provisionierten Ladekette verbinden.
2. **Neue RFID-ID erzeugen** klicken. Diese achtstellige HEX-ID ist dein
   neuer virtueller Schlüssel; sie ist noch **nicht** autorisiert.
3. **RFID prüfen/anlernen** klicken. Der Simulator sendet eine echte
   `Authorize`-Nachricht; eine Antwort `Invalid` ist zunächst normal.
4. Im ChargeVisor-Menü **RFID-Karten verwalten** eine kürzlich erkannte
   Karte dem gewünschten Nutzer und den Ladepunkten zuweisen.
5. Die Taste erneut verwenden: Jetzt sollte `Accepted` erscheinen.
   Erst danach Start/Stop testen.

Die zwei bestehenden physischen RFID-UIDs sind nicht auslesbar:
`cv_rfid_cards.tag_hash` enthält HMAC-SHA-256 statt Klartext.
Die unbekannte Karten-Erkennung setzt eine konfigurierte
`CV_RFID_HMAC_KEY`-Umgebung voraus. Keine HMAC-Schlüssel in den
Simulator oder Protokolle kopieren.

**Zustands- und Fehlersimulation:**

- Einzelnen Connector auswählen und `Available`, `Preparing`, `Charging`,
  `SuspendedEV`, `SuspendedEVSE`, `Finishing`, `Reserved`,
  `Unavailable` oder `Faulted` senden.
- Bei `Faulted` einen OCPP-Fehlercode auswählen
  (`OverCurrentFailure`, `HighTemperature`, `GroundFailure` usw.).
- Für das Transaktionsende `Local`, `EVDisconnected`, `PowerLoss`,
  `EmergencyStop` oder `Remote` auswählen.
- Ein Ladevorgang kann bei `SuspendedEV`/`SuspendedEVSE` aktiv bleiben;
  der Stop-Button funktioniert weiterhin.
- **Alle starten** / **Alle stoppen** erzeugt mehrere voneinander
  getrennte Transaktionen über eine einzige Master-OCPP-Verbindung.

**Lastmanagement und OCPP-Kommandos:**

- Bei **Anschlusslimit (kW)** z. B. `30` eingeben: simuliert eine
  **lokale** Master-Leistungsbegrenzung der gesamten Ladekette.
- Bei zehn aktiven Connectoren verteilt das Modell das Budget. Wenn
  die Leistung nicht für 6 A je Connector ausreicht (Annahme:
  230 V, drei Phasen), setzt es einige auf `SuspendedEVSE`.
  Eine einfache 30-Sekunden-Rotation vermeidet permanente Bevorzugung.
- `MeterValues` enthält Energie in Wh, Leistung in W und Strom in A.
- OCPP-1.6-Befehle **vom Backend** werden beantwortet:
  `SetChargingProfile`, `ClearChargingProfile`, `GetCompositeSchedule`,
  `ChangeConfiguration`, `GetConfiguration`, `ChangeAvailability`,
  `TriggerMessage`, `UnlockConnector`, `RemoteStartTransaction` und
  `RemoteStopTransaction`.
- Profile: `ChargePointMaxProfile` als gemeinsames Leistungslimit,
  `TxDefaultProfile` und `TxProfile`. Relative und Absolute Schedules
  mit Zeitabschnitten werden ausgewertet. `Recurring` antwortet
  ausdrücklich `NotSupported`.
- `Reset` wird zunächst `Rejected` beantwortet, weil ein vollständiger
  Hard-/Soft-Reboot noch nicht simuliert ist.

**WICHTIG:** Ein per GUI gesetztes Anschlusslimit ist **nicht** dasselbe
wie ChargeVisor-gesteuertes Smart Charging. Beim geprüften Backend-Code
ist bisher kein `SetChargingProfile`-Sendeweg ersichtlich.
Der Simulator kann eingehende Ladeprofile darstellen und prüfen,
aber der Lastmanagement-Algorithmus im ChargeVisor-Backend lässt sich
erst testen, wenn dieses Feature dort implementiert wird.
CAN-Bus-Frames, IEC-61851-Pilot-Signale und echte Hardware-Regelkreise
werden nicht emuliert. Nicht sämtliche OCPP-1.6-Funktionsprofile
sind schon implementiert; für die beschriebenen Tests ist diese
Ausbaustufe vorgesehen und noch nicht live verifiziert.

## Betrieb als echte OCPP-Wallbox (Standard)

ChargeVisor braucht **keine spezielle Simulations-Kennzeichnung**.
Der Simulator meldet sich mit der regulären OCPP-ID und dem normalen
Basic-Auth-Passwort einer Station an. Er nutzt denselben OCPP-1.6J-Endpunkt
und dieselben Autorisierungs-, Connector- und Ladehistoriepfade wie ein Gerät.
Der frühere Sonder-Header `X-Chargevisor-Test-Wallbox` wurde entfernt.

Für Tests eine **eigens dafür vorgesehene, aber als normale Hardware
angelegte** Ladestation verwenden: Topologie „Eine OCPP-Verbindung“,
z. B. 10 Ladepunkte mit Connectoren 1..10. Die Checkbox „Virtuelle
Test-Wallbox“ im ChargeVisor-Einrichtungsdialog **nicht** aktivieren.

Ein RFID-Tag muss einem aktiven Nutzer und dem zu ladenden Connector
zugeordnet sein. Der alte Platzhalter `CV-SIM-TEST` funktioniert nur bei
Sonder-Simulationsstationen und ist **kein** gültiger Ersatz für RFID im
Normalbetrieb. Bei ausdrücklich eingerichtetem Freecharge ist
`CV-FREECHARGE` möglich. ChargeVisor darf die Ladeversuche normal
ablehnen, wenn die Berechtigung fehlt.

**Achtung:** ChargeVisor unterscheidet solche Ladevorgänge nicht von realen
Ladevorgängen. Test-IDs deshalb nie für tatsächlich installierte
Kundenstationen verwenden; Testdaten können Auswertungen beeinflussen.

## Externer WSS-Server

Für eine entfernte `wss://`-Adresse ist in der GUI die Freigabe
„Externen WSS-Server erlauben“ erforderlich. Die App kann danach
einen Bestätigungsdialog anzeigen. Sie verlangt **keine** als virtuell
gekennzeichnete ChargeVisor-Station.

Das vorhandene lokale ZIP aktualisiert sich nicht automatisch.
Die überarbeitete `desktop_simulator.py` und
`chain_simulator.py` können aus dem Branch übernommen werden.

## Starten unter Windows (Oberfläche)

1. **Python 3.10 oder neuer** von python.org installieren (Python Launcher
   `py` muss verfügbar sein).
2. Im GitHub-PR #8 oben `Code` → `Download ZIP` für den Branch
   `feature/mobilityhouse-ocpp-chain-tests` wählen, ZIP entpacken.
3. Ordner `tools/ocpp-chain-simulator` öffnen.
4. **`START-SIMULATOR.cmd` doppelklicken**. Beim ersten Mal wird kostenlos
   eine lokale `.venv` eingerichtet und `ocpp` + `websockets` installiert.
5. In der Oberfläche eine **eigene, normal provisionierte Test-Ladestation** eingeben:
   - OCPP Server-URL: Die **vollständige WSS-Adresse** aus ChargeVisor
     (z. B. `wss://TESTHOST/ocpp/CV-MASTER-TEST`), oder die Basis
     `wss://TESTHOST/ocpp/`. Die App hängt die eingetragene ID ggf. an.
   - Charge-Point-ID: Exakt die OCPP-ID, die ChargeVisor für den Master erzeugt.
   - Passwort: Das **einmal angezeigte** OCPP-Basic-Auth-Passwort.
   - Anzahl Wallboxen: z. B. `6` = 1 Master + 5 Slaves.
   - RFID: In ChargeVisor einem Nutzer und den gewünschten Ladepunkten
     zugeordnete Karten-UID. Alternativ `CV-FREECHARGE`, wenn aktiviert.
   - Bei WSS zu entfernter Staging-Instanz das Kästchen
     „Externen WSS-Server erlauben“ aktivieren.
6. **Verbinden** klicken. Danach pro Connector **Laden starten** oder
   **Stoppen**; der Simulator hält die WebSocket-Verbindung offen und sendet
   regelmäßig Heartbeats und 7,2-kW-Messwerte (10 Wh/5 Sekunden).

Die App akzeptiert `RemoteStartTransaction` und `RemoteStopTransaction`
vom Backend. Die Buskommunikation über CAN wird nicht elektrisch simuliert.

**ACHTUNG:** Keine echte Produktions-/Kundenstation verwenden. Der Simulator
erzeugt künstliche Ladevorgänge und Messwerte. Passwort wird nur im Arbeitsspeicher
gehalten und nicht in Dateien gespeichert. Niemals in GitHub hochladen.

## Zugangsdaten in ChargeVisor beschaffen

Als Walectra-Superadmin anmelden → Kunden und Standort wählen → Ladestation
anlegen → Anzahl Ladepunkte z. B. 10 → "Eine OCPP-Verbindung (Master mit
Connectoren)" → **„Virtuelle Test-Wallbox“ deaktiviert lassen**.
Im direkt nach dem Speichern erscheinenden Dialog die WSS-Adresse,
OCPP-ID und **das nur einmal sichtbare Passwort** kopieren. Bei bestehenden
Stationen kann "OCPP-Zugangsdaten" angezeigt und nötigenfalls ein neues
Passwort erzeugt werden (das alte wird dabei ungültig).

Wenn die WSS-Adresse in ChargeVisor noch nicht eingerichtet ist, muss die
ChargeVisor-Konfiguration zuerst `CV_OCPP_WSS_BASE_URL` bereitstellen;
keine Produktions-URL raten.

## Headless-Protokolltest (für Entwickler)

Im selben Verzeichnis mit lokaler Python-Umgebung:
```powershell
.\.venv\Scripts\python.exe -m unittest discover -s . -p "test_*.py" -v
```

Der OCPP-Selbsttest nutzt einen lokalen Fake-CSMS und benötigt **kein Render**.
Er prüft allerdings nicht die ChargeVisor-Datenbank; der separate
`scripts/physical-ocpp-ci.mjs` testet mit PostgreSQL das 6-Connector-Mapping.
Der GitHub-Actions-Runner hat bisher keine erfolgreichen Ausführungen gemeldet.
Eine Verbindung mit ChargeVisor-Staging ist deshalb noch nicht erfolgreich verifiziert.
