# ChargeVisor – unabhängiger Ladeketten-Simulator

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
