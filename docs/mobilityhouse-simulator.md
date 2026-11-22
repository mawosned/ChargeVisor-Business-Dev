# Externer OCPP-1.6J-Simulator – The Mobility House

## Eine virtuelle Wallbox von Hand bedienen

Das Bedienfeld läuft als eigener Python-Prozess auf deinem Rechner. Verwende
Python 3.11 oder neuer und installiere die Abhängigkeiten, wie im Abschnitt
„Installation“ beschrieben. Starte das Bedienfeld im Projektverzeichnis:

```bash
python scripts/ocpp-test-wallbox.py --port 8765
```

1. Öffne `http://127.0.0.1:8765` im Browser.
2. Melde dich in der ChargeVisor-Testumgebung als Walectra-Superadmin an. Lege
   unter „Standorte & Ladepunkte“ eine Anlage an und wähle „Virtuelle
   Test-Wallbox“. Für einen Master mit zwei Ladepunkten wähle eine gemeinsame
   OCPP-Verbindung und zwei Connectoren.
3. Übernimm die vollständige WSS-Adresse, Charge Point Identity und das
   einmalig angezeigte Passwort in das Bedienfeld. ChargeVisor zeigt später
   nur Adresse und Identität an. Bei einem verlorenen Passwort kannst du
   unter „OCPP-Zugangsdaten“ ein neues erzeugen.
4. Verbinde den Simulator. Wähle einen Connector und starte einen Testvorgang,
   sende einen Zählerstand und beende den Vorgang. Simuliere anschließend eine
   Störung und setze den Connector wieder auf „Bereit“. Prüfe den Live-Status
   unter „Standorte & Ladepunkte“ und den gespeicherten Testvorgang unter
   „Ladevorgänge“ → „Testvorgänge anzeigen“.
5. Weise für den RFID-Test einen aktiven Testnutzer einem Ladepunkt zu.
   Öffne „RFID“ → „Testkarte anlernen“, wähle den Nutzer und starte
   das Einlesen. Halte im Simulator z. B. `SIM-001` vor und bestätige die
   empfangene Kennung in ChargeVisor. Teste die Freigabe mit derselben Karte
   am zugewiesenen Connector und die Ablehnung an einem unzugewiesenen.

Die Anmeldung, OCPP-Nachrichten und Datenbankeinträge laufen über den
ChargeVisor-Testserver. Testvorgänge sind als simuliert markiert und werden
nicht abgerechnet. Das lokale Bedienfeld gibt keine Zugangsdaten im
Anwendungsstatus aus und speichert keine Passwörter auf der Festplatte.
Für weitere unabhängige Wallboxen starte je OCPP-ID einen Prozess mit einem
eigenen Port, etwa `--port 8766`. Eine Master/Slave-Anlage mit gemeinsamer
OCPP-ID benötigt einen Prozess und je Ladepunkt einen Connector.
Für einen Verbindungsausfall-Test klicke während des Ladens auf „Trennen“
und verbinde dieselbe Station erneut, während der Python-Prozess weiterläuft.
Der Simulator beendet dann den offenen Testvorgang. Beende aktive Ladevorgänge,
bevor du den Python-Prozess schließt. Die Transaktions-ID bleibt nur so lange
im Speicher, wie der Prozess läuft.

## Zweck

`scripts/mobilityhouse-fleet.py` ist ein **separat laufender Python-OCPP-Client**,
implementiert mit der Open-Source-Bibliothek [The Mobility House / ocpp](https://github.com/mobilityhouse/ocpp),
Version 2.1.0. Es handelt sich nicht um eine fertige, vom Hersteller betriebene
Simulationsplattform. Der Testclient ist unabhängig vom ChargeVisor-Node-Prozess
und verwendet nur die öffentliche WebSocket-Adresse (WSS).

Der vorhandene interne Testprozess in `backend/virtual-fleet.mjs` ist für
24/7-Zuverlässigkeitsaussagen ungeeignet. `CV_VIRTUAL_AUTO=0` auf dem
Business-Backend lassen, wenn der externe Simulator verwendet wird.

## Sicherheitsregeln

- Als **Walectra-Superadmin** eine *eigene* virtuelle Teststation anlegen,
  im Ladegeräteformular ausdrücklich **„Virtuelle Test-Wallbox“** markieren.
  Keine Kunden-Hardware und keine echte RFID-Karte verwenden.
- Für jede Simulationsstation die echten **Test**-OCPP-Anmeldedaten aus
  „OCPP-Zugangsdaten“ verwenden; nicht das ChargeVisor-Web-Login.
- Keine OCPP-Passwörter in GitHub-Commits, Logs, Tickets oder Chats kopieren.
  Credentials nur direkt im Umgebungsvariablen-/Secret-Manager des Workers eingeben.
- Extern nur `wss://`. `ws://` wird ausschließlich auf localhost unterstützt.
- Alle simulierten Transaktionen müssen `simulated=true` tragen.
  Keine Simulation in Abrechnung oder produktive Nutzerstatistiken übernehmen.

## Aufbau

```
Separater Python-Prozess (The Mobility House ocpp 2.1.0)
  | verschlüsselte WebSocket-Verbindung (wss://, OCPP 1.6J, Basic Auth)
  v
ChargeVisor Business OCPP auf Render
  |
  v
Neon PostgreSQL: cv_ocpp_events, cv_ocpp_transactions,
                 cv_ocpp_live, cv_ocpp_connector_live
```

Für einen **unabhängigen** Test muss der Python-Prozess auf einem **anderen
Server/Worker** laufen, nicht auf demselben Render-Service.

## Installation

Python 3.11:

```bash
pip install -r requirements-ocpp-simulator.txt
```

Folgende Variablen im *Simulator-Worker* setzen (nur Platzhalter):

```dotenv
CV_SIM_WSS_BASE=wss://chargevisor-business-demo.onrender.com/ocpp
CV_SIM_STATIONS_JSON=[{"id":"DEINE_TEST_ID","password":"DEIN_TEST_OCPP_PASSWORT","connectors":1}]
CV_SIM_DURATION_SECONDS=0
CV_SIM_IDLE_SECONDS=25
CV_SIM_CHARGE_SECONDS=90
CV_SIM_METER_SECONDS=15
CV_SIM_HEARTBEAT_SECONDS=30
CV_SIM_RECONNECT_SECONDS=5
CV_SIM_FAULT_EVERY=4
```

Start:

```bash
python scripts/mobilityhouse-fleet.py
```

Oder auf einem separaten Docker-/Render-Worker:

```bash
docker build -f Dockerfile.ocpp-simulator -t chargevisor-ocpp-test .
docker run --rm --env-file /pfad/zu/geheimer-test.env chargevisor-ocpp-test
```

`CV_SIM_DURATION_SECONDS=0` läuft dauerhaft, solange die externe Plattform
eingeschaltet ist. Für einen abgegrenzten Test z. B. `3600` für eine Stunde.
Die Ausgabe enthält strukturierte JSON-Zeilen:
`fleet_start`, `connected`, `heartbeat`, `status`,
`charging_complete`, `error`, `reconnecting`, `station_finished`.
In einem begrenzten Test gilt mindestens ein abgeschlossener Ladezyklus
sowie Heartbeat und null Fehler als Erfolg; sonst ist Exit-Code ungleich 0.

## Nachweis und Zuverlässigkeitskriterien

1. WebSocket-Anmeldung mit der angelegten Test-OCPP-ID und dem richtigen Passwort.
2. Erfolgreiche `BootNotification` (Accepted) und regelmäßige `Heartbeat`-Antworten.
3. Status: `Available → Preparing → Charging → Finishing → Available`.
4. `Authorize`, `StartTransaction` mit gültiger Transaktions-ID,
   `MeterValues` mit zunehmendem Wh-Zähler, `StopTransaction`.
5. Jede Testtransaktion ist mit `simulated=true` markiert.
6. Getrennte `connectorId` für Master/Slave-Anlagen; keine Überschreibung.
7. Simulierter Fehler `Faulted`, anschließend `Available`.
8. Restart des ChargeVisor-Servers: Simulator muss Abbruch erkennen, reconnecten
   und neue BootNotification ausführen.
9. Zwei oder mehr virtuelle Ladegeräte parallel; keine Vermischung von Mandanten.
10. 24-Stunden-Test: Verbindungsdauer, Reconnects, erfolgreiche/fehlgeschlagene
    Zyklen, Heartbeat-Ausfälle und DB-Zustandsübereinstimmung dokumentieren.

Der **kurze** GitHub-Test mit `scripts/external-ocpp-ci.py` verwendet ebenfalls
die Originalbibliothek und eine **temporäre** PostgreSQL-Datenbank. Er beweist
Protokollkompatibilität für einzelne Szenarien, nicht 24/7-Zuverlässigkeit.
Erfolgreiche GitHub-Actions-Läufe müssen separat überprüft werden.

## Offene Infrastrukturentscheidung

Ein Docker-Worker auf einem eigenständigen, dauerhaft laufenden Hetzner-Server
oder ein bezahlter Render Background Worker ist geeignet. **Render Free
schläft** und ist damit als garantierter 24/7-Testserver ungeeignet.
Vor Einrichtung eines kostenpflichtigen Dienstes ist die Freigabe nötig.
