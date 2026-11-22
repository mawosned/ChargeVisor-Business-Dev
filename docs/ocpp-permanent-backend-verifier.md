# Dauerhafter OCPP-Backend-Prüfer (nur Teststationen)

Stand: 22.11.2026. Dieses Feature ist vollständig **opt-in** und verändert ohne neue Umgebungsvariablen keine bestehende Backend-Funktion.

## Ziel

Der externe OCPP-Simulator prüft nach einem quittierten OCPP-Szenario, ob der tatsächlich gespeicherte Connector-Status, Fehlercode, die Leistung oder Transaktion im Backend dem Soll entspricht.

- `PROTOCOL_OK`: Nur die OCPP-Antwort ist nachgewiesen.
- `PASS`: Zusätzlicher automatischer Backend-Nachweis über eine unabhängige, authentifizierte, **read-only** API vorhanden. Die Browser-Darstellung ist damit **nicht** automatisch bewiesen.
- `FAIL`: Protokoll oder konfigurierte Backend-Prüfung widerspricht dem erwarteten Ergebnis.
- **Kein grüner Gesamtstatus**, wenn Schritte nicht ausgeführt wurden.

Der Prüfzugang hat **kein Ablaufdatum**, bleibt aktiv, bis man den Token-Hash entfernt oder ändert, und benötigt keine wiederholte Benutzeranmeldung. Es wird keine bestehende Benutzer-Session und kein kundenseitiges OCPP-Passwort genutzt.

## Sicherheit

Die API `GET /api/ocpp/test-verification?identity=<TEST-ID>` existiert nur, wenn **beide** Variablen gesetzt sind:

```text
CV_OCPP_VERIFIER_TENANT_ID=<UUID-des-ausschliesslichen-Testkunden>
CV_OCPP_VERIFIER_SHA256=<SHA256-HEX-eines-zufaelligen-48-Byte-Tokens>
```

Der gesamte HTTP-Zugriff benötigt `Authorization: Bearer <TOKEN>`. Token und unverschlüsselter Wert gehören **niemals in GitHub, Query-Parameter, Logs oder JSON/CSV-Berichte**. Die API gibt standardmäßig 404 aus, solange sie nicht eingerichtet ist. Sie lässt ausschließlich `GET` zu, prüft die Authentizität mit einem zeitkonstanten Hashvergleich und liefert ausschließlich Daten, die zu einer Station mit `s.is_simulator=true`, genau dem konfigurieren Testkunden und `simulated=true` gehören.

Begrenzung: Der Modus eignet sich für ausdrücklich simulierte Teststationen. Für den vollständig physischen OCPP-Pfad benötigen wir eine spätere eigene, isolierte Testtenant-/Hardwarekonfiguration und zusätzliche Tests; **nicht** die bestehende physische Kundenstation freigeben.

## Einrichtung einmalig auf einem getrennten Testbackend

1. Eigens angelegten **Testmandanten** und als Simulator markierte Wallbox verwenden. Niemals eine echte Kundendatenbank oder Kunden-Wallbox für die Verifikation auswählen.
2. Ein 48-Byte-Token kryptografisch zufällig erzeugen und sicher auf dem Test-PC speichern.
3. Die SHA256-Hex-Darstellung des Tokens und die Testtenant-UUID einmalig als *private* Render-Umgebungsvariablen des **Testdienstes** setzen. Die eigentliche Zeichenfolge des Tokens bleibt ausschließlich lokal gespeichert.
4. Testsimulation und Python-Prüfer verwenden einmalig konfigurierte lokale Variablen `CV_VERIFIER_URL=https://...-test...render.com` und `CV_VERIFIER_TOKEN_FILE=C:\...\verifier-token.txt`. Alternativ `CV_VERIFIER_TOKEN` als lokale Umgebungsvariable, nicht als Kommandozeilenargument.
5. Bei einem Notfall die Variable `CV_OCPP_VERIFIER_SHA256` löschen oder austauschen. Der alte Token wird sofort ungültig.

## Was der Simulator automatisch prüft

Bei optional aktivem Prüfer vergleicht `ocpp_soak.py` nach folgenden Schritten Soll mit tatsächlichem Backendzustand:

- START: Charging und aktiver Transaktionsdatensatz mit passender Transaktions-ID.
- STOP: Available und dieselbe Transaktion als beendet.
- STATUS / ERROR / RESTORE: Zustandswechsel plus passender Fehlercode.
- SUSPEND_EV / SUSPEND_EVSE: Tatsächlich gespeicherter Suspension-Status.
- METER: Tatsächlich gespeicherte gemeldete Leistung (W).

Die bestehenden 60-Sekunden-Wartezeiten zwischen Szenarien bleiben erhalten. Jeder Status wird erst nach erfolgreicher OCPP-Antwort und vollständigem Backend-Abgleich auf `PASS` gesetzt. Lokales Lastmanagement allein beweist weiterhin **nicht** CSMS-gesteuertes Dynamic Load Balancing. Frontend- und Hardwaretests werden gesondert bewertet.

## CI-End-to-End-Nachweis

`.github/workflows/mobilityhouse-independent.yml` startet eine **wegwerfbare PostgreSQL 16 Datenbank**, setzt nach einmaliger zufälliger Generierung einen auf diesen CI-Lauf begrenzten Token und Tenant, startet das echte ChargeVisor-Backend, lässt eine unabhängige Mobility-House-OCPP-1.6J-Testwallbox verbinden und prüft danach echte Transaktionsdaten über den neuen HTTP-Prüfendpunkt.

Kein Testtoken und kein Datenbank-Passwort wird persistiert. Die bestehenden 62 Backend-Tests, Browser-Tests und Simulator-Python-Tests bleiben separate Regressionstests.

## Betriebsregeln

- Nie beim privaten produktiven Render-Service aktivieren, bevor ein dedizierter Testmandant und eine klar isolierte Teststation existieren.
- Nicht die öffentliche GitHub-Entwicklungskopie mit der privaten Render-Produktionsdatenbank verbinden.
- `PASS` gilt nur für den jeweiligen geprüften Nachweis, nicht für alle 29 OCPP-Befehle oder hardwareseitige Effekte.
- Im lokalen Simulator gilt weiterhin: GUI/PC müssen für den Dauerlauf eingeschaltet bleiben.
