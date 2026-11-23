# ChargeVisor Business V1 – Stromausfall & Firmware-Verwaltung

Diese Arbeit ist bewusst **backend-only**. Kein bestehendes Frontend,
keine Lumina-LEDs, Menüs, Dashboards, Login-Seiten, Logos oder Exporte wurden
verändert. Das private Render-Produktionsrepo wird durch diesen PR nicht
geändert oder deployed.

## 1. Stromausfall / Internetausfall: korrekte Semantik

Die CSMS-Seite kann anhand eines verlorenen WebSockets **NICHT**
unterscheiden zwischen:
- tatsächlichem Stromausfall der Wallbox,
- Internet- oder Mobilfunkstörung,
- Neustart des OCPP-Clients,
- Router-/Backend-Ausfall oder
- Firmware-Neustart.

Darum gilt strikt:

1. Eine offene OCPP-Transaktion bleibt nach Verbindungsverlust gespeichert.
2. **Kein** automatisches \`StopTransaction\`, kein geschätzter finaler Zählerstand
   und **keine** fingierte Abrechnung.
3. Der schreibgeschützte, authentifizierte Endpunkt
   \`GET /api/ocpp/power-recovery\` zeigt offene, noch nicht bestätigte
   Transaktionen. Er ist nach Tenant und für Nutzer zusätzlich nach
   eigener \`user_id\` eingegrenzt.
4. Nach Wiederverbindung muss die Wallbox den endgültigen Zählerstand
   und den tatsächlichen Abschluss mit \`StopTransaction\` mitteilen.
   Ein \`reason: PowerLoss\` kann der vom Gerät gemeldete Grund sein,
   ist aber nicht aus dem Disconnect ermittelbar.
5. Ist die Wallbox/Firmware nach Power Cycle nicht mehr in der Lage, die
   bisherige Transaktion abzuschließen, bleibt sie **offen zur Klärung**.
   Kein automatischer Abschluss und keine Rechnung mit Schätzwerten.
6. Bestehende idempotente Wiederholungen von Start/Stop bleiben unverändert.

**Neuer Test:** \`scripts/physical-ocpp-ci.mjs\` reißt die WebSocket-
Verbindung einer physischen Testidentität hart ab, kontrolliert
\`billingState=unconfirmed\`/offenen DB-Datensatz und Nutzerisolation,
verbindet erneut und lässt exakt dieselbe Transaktion mit einem
\`StopTransaction(reason=PowerLoss)\` abschließen. Dieser Test wird in
der GitHub-CI ausschließlich mit Wegwerf-PostgreSQL ausgeführt.

**Hardware noch offen:** Was die tatsächliche Firmware bei Netzausfall,
Stromausfall, Meter-Rollover und Wiederanlauf tut, sowie ob unberechtigte
RFID-Karten offline blockiert bleiben. Dafür ist zwingend ein
Hardware-Pilot mit echtem Stromabschalten nötig.

## 2. Firmware-Update: implementierter Backend-Ablauf

**Standardmäßig AUS**, nur opt-in bei getrennter Test-/Pilot-Installation.
Der Benutzer liefert keine beliebigen Download-URLs.

Operator-seitig erforderliche Umgebungsvariablen (nur auf isolierter
Test-/Pilot-Instanz, NICHT in GitHub):
- \`CV_FIRMWARE_UPDATES_ENABLED=1\`
- \`CV_FIRMWARE_ALLOWED_IDENTITIES=CV-PILOT-001,CV-PILOT-002\`
- \`CV_FIRMWARE_ALLOWED_HOSTS=updates.example.com\` (tatsächlich
  kontrollierter, zugelassener Hersteller-/Firmwareserver)
- \`CV_FIRMWARE_CATALOG_JSON\` als JSON-Liste, pro Freigabe:
  \`{"id":"lumina-pilot-2","vendor":"Enelion","model":"Lumina","version":"2.0.0","location":"https://updates.example.com/fw.bin","sha256":"<64-hex>"}\`.

**Beispielwerte sind NICHT echte oder geprüfte Enelion-Firmware.**
Nur vom Hersteller freigegebene Dateien, Hardware-/Modellversionen
und Herstelleranleitungen verwenden. Der SHA-256 Wert ist eine
Operator-Freigabeangabe; OCPP 1.6 \`UpdateFirmware\` übermittelt selbst
keinen Prüfsummen- oder Signaturbeleg an die Wallbox. Die
**geräteeigene Validierung** ist separat nachzuweisen.

**Neuer Backend-Endpunkt**, ohne Frontend-Veränderung:
- \`GET /api/ocpp/firmware?tenantId=<UUID>&identity=<ID>\`: nur
  Walectra-Superadmin; zeigt Auftragsstatus und freigegebene Katalogmetadaten.
- \`POST /api/ocpp/firmware\` mit JSON:
  \`{"tenantId":"<UUID>","identity":"<ID>","releaseId":"lumina-pilot-2","confirm":"INSTALL_FIRMWARE"}\`.
  Nur Walectra-Superadmin, gültiger Login, Origin-/Content-Type-Prüfung.

**Vor OCPP-Versand prüft das Backend:**
- Firmware-Funktion wurde ausdrücklich aktiviert.
- Station ist eine freigegebene **physische** Wallbox und stammt aus
  demselben aktiven Tenant, die OCPP-Socketverbindung ist online.
- Station steht in der unabhängigen expliziten Geräte-Allowlist.
- Der gemeldete \`BootNotification\`-Hersteller und Modell passen exakt.
- Die Zielversion ist nicht bereits als Firmware angezeigt.
- Es gibt **keine** offene reale Transaktion dieses OCPP-Geräts.
- **Alle** Connectoren sind Available oder Unavailable (nicht Charging,
  Preparing, Finishing, SuspendedEV/EVSE).
- Ein anderer Fernsteuerungs- oder Firmwareauftrag läuft nicht bereits.
- Firmware-URL ist HTTPS auf einem explizit erlaubten Host.
- Es ist nicht bereits ein aktiver Firmwareauftrag für diese Station gespeichert.

Nach erfolgreicher \`UpdateFirmware\`-Antwort gilt ein Auftrag als
**accepted**, **nicht als installiert**. Das Backend protokolliert
\`Downloading\`, \`Downloaded\`, \`Installing\`,
\`Installed\`, \`DownloadFailed\`, \`InstallationFailed\`.
Erst wenn \`Installed\` gemeldet und später bei \`BootNotification\`
die **exakt beauftragte Firmwareversion** gemeldet wurde, gilt
\`verified\`. Fehlgeschlagene oder unterbrochene Aufträge bleiben im
Job-Register und werden nicht automatisch neu gesendet.

**Betriebsgrenzen:** In V1 keine Firmware-Verteilung durch ChargeVisor
selbst, kein Hochladen von Binärdateien, kein Massen-Rollout und keine
automatischen Updates an Kundenstationen. Die Wallbox lädt Firmware
vom genehmigten Hersteller-/Firmwarehost. Ein echter Hardwareversuch
mit freigegebenem Paket sowie nachweisbarem Rollback und Recovery bei
Stromausfall während des Flashens ist noch erforderlich.

## 3. Nachweis / offene Punkte

| Test | Automatisierbar | Status |
|---|---|---|
| Unauthentifizierter Nutzer darf Recovery nicht lesen | Node API-Test | Implementiert – CI muss grün sein |
| Offene Transaktion bleibt nach harter Trennung unbilled | Reale WSS+DB-CI | Implementiert – CI muss grün sein |
| Reconnect + PowerLoss-Stop und echter Endzähler | Reale WSS+DB-CI | Implementiert – CI muss grün sein |
| Firmware URL- und Geräte-Allowlist | Node Tests | Implementiert – CI muss grün sein |
| Firmwareauftrag bei laufender Transaktion blockieren | Node Tests | Implementiert – CI muss grün sein |
| Firmwarestatus, Boot-Zielversion und Persistenz | Node Tests | Implementiert – CI muss grün sein |
| Hersteller-Firmware aktualisiert echte Wallbox | Hardwarepilot | OFFEN |
| Stromausfall während des Flashens / Wiederanlauf | Hardwarepilot | OFFEN |
| Sichere RFID-Regel nach tatsächlichem Strom-/Netzausfall | Hardwarepilot | OFFEN |

**Keine Funktion gilt als produktionsfertig, wenn sie nur im
Simulator existiert.** Der Firmware-Pilot benötigt Herstellerfreigabe
und eine separat provisionierte Teststation, bevor irgendein
Update-Befehl an eine echte Kundenwallbox geht.
