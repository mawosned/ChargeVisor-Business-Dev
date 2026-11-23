# ChargeVisor Business – verbindliche Entwicklungsregeln

## OCPP-Ladezustandsanzeige und Diagnose (23.11.2026, vor Deployment)

- **Nur eine konsistente Frontend-Zustandslogik** für jeden einzelnen Connector: OCPP-Connectorstatus, aktive nicht simulierte Transaktion, `remote_paused`, Rollenrecht und Verbindung gemeinsam prüfen. Keine Ableitung des Zustands eines Slave-Connectors vom Master. Bestehende Lumina-Bilder, LEDs, Kundenwechsel, Nutzer-/RFID-/Historienansichten unverändert erhalten.
- **Buttons:** Lädt → ausschließlich Pause. Erfolgreich remote pausiert und nicht mehr `Charging` → Play/Fortsetzen + Stop. Kein aktiver Ladevorgang und physischer `Preparing`/`SuspendedEV(SE)`/`Finishing` → Play; `Finishing` darf eine RemoteStart-Anfrage nur bei explizitem Nutzerklick auslösen, die Wallbox kann sie ablehnen. Bei `Available`/offline kein falsches Startversprechen. Datenbank `remote_paused=true` darf einen gemeldeten Status `Charging` nicht als erfolgreich pausiert ausgeben; Pause bei Widerspruch erneut möglich.
- **Diagnose ist ausschließlich lesend:** `GetCompositeSchedule` wird erst nach aktiver Superadmin-Aktion auf einem konkret gewählten **physischen** Ladepunkt gesendet. Keine automatische Statusabfrage, kein Löschen/Ändern von Ladeprofilen, keine mutmaßliche Profilursache behaupten. `Rejected`, `NotSupported`, fehlender Plan, Stromangaben in `A` oder `W` klar unterscheiden.
- **Keine Produktivänderung während des laufenden 120-Minuten-Simulatortests.** Änderungen zunächst nur auf separatem DEV-Feature-Branch/Draft-PR entwickeln und CI prüfen. Erst nach ausgewerteten Testberichten und ausdrücklicher Freigabe nach Render/privates Repo übernehmen.


Diese Datei gilt für Coding-Agenten und alle zukünftigen Codeänderungen.

## Bestehende Funktionen NICHT entfernen
- Die ursprüngliche ChargeVisor-Demo in `index.html` und `app.js` dient als **visuelle Referenz**. Sie darf nicht durch die Business-Anbindung überschrieben werden.
- Die echte Anwendung ist `app.html` + `app-live.js`. Die bereits entwickelte Oberfläche wird erweitert, **nicht durch eine vereinfachte Neufassung ersetzt**.
- Erhalten bleiben müssen: Lumina-Wallboxen als kleines Gerätebild, LED-Leuchten mit tatsächlichem OCPP-Status, Standort- und Master/Slave-Gruppen, aufgeklappte technische Details, Kunden- und Nutzerverwaltung, RFID-Bereich, Ladevorgänge und der ChargeVisor-/BLITZ-Farbstil.
- **LED-Farben:** Laden blau pulsierend, bereit grün pulsierend, Warnung orange konstant, Fehler/offline rot konstant; noch nie verbunden neutral/aus. Keine erfundenen Statusdaten. Master/Slave-Connectoren besitzen getrennte Zustände.
- Der aktuelle Kunde muss **auf jeder Seite oben sichtbar sein**. Nur der Superadmin darf zwischen Kunden wechseln. Kunden-Admins und Nutzer dürfen nur ihr eigenes Kundenkonto sehen.
- Vorhandene Funktionen nicht „aufräumen“, verstecken oder löschen, wenn das nicht ausdrücklich angefordert ist.
- BLITZ-Backend, BLITZ-Datenbank und `Final-ChargeVisor` nicht ohne separate ausdrückliche Anweisung verändern.

## Geschäftslogik
- Walectra/Superadmin richtet Kunden, Standorte, Wallboxen und OCPP-Identitäten ein.
- Kunden-Admin verwaltet nur Nutzer und deren Ladepunkt-Zuordnungen im eigenen Kundenkonto.
- Nutzer sieht nur zugewiesene Ladepunkte. Bestehende E-Mail-Adressen dürfen für zusätzliche Ladepunkte wiederverwendet werden.
- OCPP 1.6J-WSS-Zugangsdaten werden nur geschützt bereitgestellt, Passwörter niemals im Klartext gespeichert.
- Der **externe OCPP-Desktop-Simulator MUSS wie eine echte OCPP-1.6J-Wallbox funktionieren**: reguläre `wss://.../ocpp/{ChargePointID}`-URL, Standard-OCPP-`ocpp1.6`-Subprotokoll und dieselben vom Kundenbackend ausgegebenen Basic-Auth-Zugangsdaten. **Keine zusätzlichen simulator-only HTTP-Header, gesonderten OCPP-IDs oder `is_simulator=true`-Pflicht für seine Verbindung erzwingen.** Jede normal provisionierte Station soll emulierbar sein, sofern die OCPP-ID nicht bereits verbunden ist.
- Das Backend-Attribut `is_simulator=true` steuert ausschließlich die **Kennzeichnung/Abgrenzung der so gespeicherten Testdaten**; es darf bei der regulären Desktop-Handshake-Implementierung keine Pflicht sein. Bei normalen Stationen entstehen auch durch den Simulator derzeit `simulated=false`-Transaktionen; diese Testergebnisse dürfen nicht versehentlich mit realer Kundenabrechnung vermischt werden.

## Vor einer Änderung
1. Relevante Original-Dateien sowie aktuelle Version **vollständig vergleichen**. Nicht blind neu schreiben.
2. Möglichst kleine Änderung nur in den betroffenen Komponenten vornehmen.
3. Vorherige Funktionalitäten per Tests absichern; keine unaufgeforderten Seiten-/Designänderungen.
4. Bei wesentlichen UI-Änderungen zunächst auf separatem Branch entwickeln und Screenshot sowie Rollentest mit dem Nutzer prüfen.
5. Erst nach erfolgreichen Tests zusammenführen. Nie behaupten, Browser- oder Drittanbieter-Tests seien erfolgreich, wenn ihre Ergebnisse nicht geprüft wurden.

## Pflichtprüfungen
- `npm test`: Sicherheit, Rollen, Tenant-Isolation, OCPP-WebSocket, Dauer-Simulation und permanente UI-Verträge.
- `scripts/ui-regression.spec.mjs`: Chromium-Browsertest für jede Rolle, Kundenwechsel, Lumina-Bild und LED-Animation.
- `scripts/external-ocpp-ci.py`: Unabhängige Python-OCPP-Implementierung gegen echten Node-Server und temporäre PostgreSQL-Datenbank.
- Render-Deployment darf nur als erfolgreich bezeichnet werden, wenn Status `live` ist.
- Vor Produktivbetrieb müssen OCPP-Server und externer Testsimulator **separat dauerhaft verfügbar** sein. Render Free garantiert keinen 24/7-Betrieb.

## Änderungen nachvollziehbar machen
- Im Commit benennen, welches Verhalten geändert und was ausdrücklich beibehalten wurde.
- Änderungen an bestehenden Darstellungen im PR mit Vorher-/Nachher-Screenshots dokumentieren.
- Bei einer Regression zuerst auf letzten funktionierenden Stand zurückgehen, nicht neue Funktionen entfernen.
