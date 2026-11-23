# ChargeVisor Business V1 – Firmen, Dienstwagen und WEG (Bestandsaufnahme)

**Referenz:** Öffentliches Entwicklungshauptrepo, Commit
\`4f122a6d41338c017848b8270e3b769817366766\` vor dieser Ergänzung.
Privates Render-Produktionsrepo/Deploy **wird nicht verändert**.

## Prinzip: Bestand vor Neuentwicklung

Alles, was schon funktioniert, bleibt unverändert; insbesondere:
\`app-live.js\`, \`app.js\`, \`app.html\`, \`styles.css\`, \`login.*\`,
\`portal-language.js\`, \`exports.js\`, alle Logos und Lumina-Grafiken.

\`scripts/verify-frontend-unchanged.mjs\` sperrt jeden stillen Pixel-/Codewechsel
in diesen 14 UI-Dateien/Assets anhand ihrer ursprünglichen Git-Blob-Fingerprints.
Der bestehende Browser-Regressionstest \`scripts/ui-regression.spec.mjs\` bleibt
ebenfalls aktiv. Diese UI-Sperre ist absichtlich streng. UI-Änderungen
dürfen nur später in einem eigenen, bewusst freigegebenen UI-PR erfolgen.

## Was laut Code bereits da ist

| Firmen-/WEG-Funktion | Codebeleg | Bewertung |
|---|---|---|
| Kunden/Mandanten und Status | \`backend/auth.mjs\` \`/api/tenants\` | Implementiert, bestehende Auth/Struktur-Tests |
| Standorte → Stationen → Ladepunkte, Master/Slave | \`backend/structure.mjs\` und \`backend/structure.test.mjs\` | Implementiert; Provisionierung derzeit nur Walectra-Superadmin |
| Nutzer, Rechte, Punktzuweisung | \`backend/auth.mjs\`, \`backend/auth.test.mjs\` | Implementiert, Grundtests vorhanden |
| RFID, unbekannte Karte, Zuordnung | \`backend/physical-ocpp.mjs\`, \`backend/test-rfid.mjs\`, bestehende OCPP/Hardware-CI | Implementiert; echte Firmware/Offline-Entscheidung offen |
| Boot/Heartbeat/Online, OCPP-Status, Fehlercodes | \`backend/ocpp.mjs\` | Implementiert; unabhängige WebSocket-Tests |
| Laden Start/Stop, RemoteStart/Stop, Soft Reset, Pause/Resume | \`backend/ocpp.mjs\` \`control\` + \`backend/physical-ocpp.mjs\` | Vorhanden, hardwareabhängige End-to-End-Prüfung noch offen |
| Leistung (W), Energie (Wh), einzelne Connector-Zustände | \`backend/ocpp.mjs\` \`MeterValues\`, \`connectorState\` | Implementiert; Leistung ist berichtete Messung, kein Backend-Regelungsnachweis |
| Historie, Nutzer-/Standortfilter, Tarif und Betrag | \`backend/physical-ocpp.mjs\` \`history\` | Implementiert; Tarif wird bei Transaktionsbeginn vom Mandanten gespeichert |
| PDF-Ladebericht | \`backend/charging-report.mjs\` und zugehörige Tests | Implementiert; simulierte Sessions werden herausgefiltert |
| Dauerhafter, lesender Simulator-Backend-Prüfer | \`backend/ocpp-test-verifier.mjs\` und \`backend_verifier.py\` | Implementiert, opt-in, nur isolierte Teststation |
| Lokales Lastmanagement im Windows-Simulator | \`tools/ocpp-chain-simulator/smart_charging.py\` | Simulator-Modell, **kein** Backend-DLM |

## Fehlende oder nicht nachgewiesene V1-Eigenschaften

1. **Produktionshardware / Offline-Verhalten:** In der realen Enelion-/anderen
   Firmware testen, dass unbefugte Karten offline nicht starten, dass nach
   Verbindungsverlust/Zähler-Reboot keine falschen oder doppelten Ladevorgänge
   entstehen, dass Reset und RemoteStart/Stop richtig umgesetzt werden.
2. **WEG-Lastmanagement:** Der gewünschte Anschlusswert und die reale
   Master/Slave-Regelung müssen in einem Hardwarepilot nachgewiesen werden.
   ChargeVisor sendet aktuell **keinen allgemeinen dynamischen
   Standort-Leistungsregler**. Wenn die Wallboxen lokal regeln, ist keine
   konkurrierende Backend-DLM-Regelung zu implementieren.
3. **Abrechnung / Eichrecht:** Aktuelle kWh und Beträge sind aus übertragenen
   Zählerwerten berechnet. Ein MID-Zähler bzw. ein gesetztes
   \`signed_meter\`-Flag alleine ist **kein** geprüfter eichrechtlicher
   Abrechnungsnachweis. Preisregelung liegt aktuell auf **Mandanten-Ebene**,
   nicht je individuellem Ladepunkt.
4. **Betriebssicherheit:** 24-Stunden-Hardware-Pilot, Restart, Backup/Restore,
   längerfristige Verfügbarkeit und Alarmierung für unerwartet offline.
5. **Neue WEG-Abnahme (in diesem PR):** Zehn Connectoren mit einer gemeinsamen
   OCPP-ID, parallele aber individuell zugeordnete Transaktionen, 11,04-kW-
   Gerätenennleistung, 30-kW-Lokalsimulation, Statuswechsel und Störung/Recovery.
   Ein separater PostgreSQL-Datensatz wird nach jedem erfolgreichen Ablauf
   durch einen unabhängigen HTTP-Backend-Prüfer und SQL geprüft.

## Was wir für V1 NICHT bauen

Kein OCPP-Roaming, OCPI, öffentliche Kreditkartenbezahlung, öffentliche
Preis-/Ad-hoc-Zugangssysteme, Reservierungs-UX, standardisierte Firmware-OTA-
Verwaltung oder allgemeine Hersteller-DataTransfer-Workflows.
Die generische **Test**-Befehlsfunktion bleibt standardmäßig ausgeschaltet
und nur für markierte Teststationen nutzbar; daraus werden keine
Kunden- oder Admin-Menüpunkte.

## Abnahmereihenfolge – kein falsches PASS

- **Backend-CI:** komplette bestehende \`npm test\`-Suite auf Node 20, 22
  und Render-kompatiblem Node 26.
- **Frontend-Freeze:** unveränderte 14 UI-Dateien/Assets plus vorhandener
  Browser-Lumina-/LED-/Kundenwechsel-Test.
- **WEG/CSMS-CI:** unabhängige The Mobility House OCPP-1.6J-Bibliothek,
  echte WebSocket-Verbindung, isolierte PostgreSQL und unabhängiger API-Abgleich
  für zehn Connectoren. Die schnelle PR-CI kürzt lediglich die Wartezeiten,
  nicht die OCPP-Nachrichten oder Backend-Assertions.
- **Langsamer Dauerlauf:** derselbe Test kann manuell mit **60 Sekunden
  Szenario-Abstand** ausgeführt werden.
- **Produktiver Pilot:** erst wenn Offline-RFID, Lastmanagement, Gerätefirmware,
  Abrechnungskette, Wiederanlauf und Backup praktisch geprüft wurden.

**Diese CI-Tests beweisen nicht**, dass die reale WEG 30 kW einhält:
Der Simulator verteilt lokal 6 × 5.000 W, während vier weitere
Transaktionen verbunden, aber \`SuspendedEVSE\` sind. 11,04 kW ist
die Nennleistung jeder Wallbox, **nicht** die momentan zugeteilte
Leistung. Für 3-phasige AC-Geräte ist insbesondere die Mindestladeleistung
je aktivem Ladepunkt zu beachten.

## Entwicklungs- und Rollback-Schutz

- Private Produktion: \`mawosned/ChargeVisor-Business\`, \`main\`
  \`b541e5c34006dd3697037bf2ebcdd254a4cd0398\`, unabhängiger
  privater Backup-Branch.
- Öffentliche Entwicklung: \`mawosned/ChargeVisor-Business-Dev\`,
  separater V1-Branch und weiterhin eigene Git-Historie.
- Keine automatische Synchronisierung zur Produktion; keine neuen
  kostenlosen Datenbanken auf Render notwendig, da CI mit Wegwerf-PostgreSQL.
- Keine UI-Änderungen oder produktive Migration in diesem PR.
