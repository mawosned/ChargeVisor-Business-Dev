# ChargeVisor Business V1 – Funktions- und Abnahmeliste

**Geltungsbereich:** Firmen, Dienstwagen, WEG, nichtöffentliches Laden.
**Frontend:** unveränderter freigegebener Stand mit automatischem Blob-Hash-
Schutz aller 14 Frontend-/Asset-Dateien.

**Statusbegriffe:**
- **IM CODE:** Implementiert, aber ohne Ende-zu-Ende-Beweis ggf. nicht freigabefähig
- **CI BESTANDEN:** Ausführung mit isolierter DB/WebSockets/Unit- oder Browsertest nachgewiesen
- **PILOT OFFEN:** Erfordert physische Wallbox und echte Betriebsbedingungen
- **FEHLT:** Noch nicht oder nicht vollständig implementiert
- **NICHT ERFORDERLICH:** Für diese Produktversion bewusst ausgeklammert

## 1. Bestehende Funktionen – nicht neu bauen

| Bereich | Implementierung | Abnahme |
|---|---|---|
| Superadmin, Kunden, Standorte | IM CODE | CI BESTANDEN – Auth-/Mandanten- und Strukturtests |
| Ladestationen, Master + bis zu 10 Connectoren | IM CODE | CI BESTANDEN – eigenständiger WEG-10-Connector-Test |
| Nutzer, Punktberechtigungen | IM CODE | CI BESTANDEN – Auth-, Struktur- und RFID-Tests |
| RFID-Freigabe, unbekannte/gesperrte Karte | IM CODE | CI BESTANDEN – physischer OCPP-Testpfad; Offline-Hardware PILOT OFFEN |
| Boot/Heartbeat, Online/Offline, Reconnect | IM CODE | CI BESTANDEN – OCPP-WebSockets; hardwareabhängiger Wiederanlauf PILOT OFFEN |
| StartTransaction, StopTransaction, RemoteStart/Stop | IM CODE | CI BESTANDEN – unabhängige und physische Testpfade |
| MeterValues: Leistung, Energie, Ladehistorie | IM CODE | CI BESTANDEN – isolierte Datenbank und WEG-Test |
| Status/Fault/Recovery | IM CODE | CI BESTANDEN – OCPP 1.6J mit zehn Connectoren |
| Fehleranzeigen, LEDs, Kundenauswahl und bestehendes UI | IM CODE | CI BESTANDEN – UI-Regression plus Hash-Freeze; Frontend **nicht geändert** |
| Tarife je Kunde, Betrag aus Zählerdifferenz | IM CODE | Backend-CI; Eichrechtsfreigabe PILOT OFFEN |
| PDF Ladebericht | IM CODE | CI BESTANDEN – Auth, Mietmandantentrennung und Filter |
| CSV/XLS-Export, gewünschte Filter | TEILWEISE | Bestehendes Exportmodul; betrieblicher Vollständigkeitsnachweis offen |
| Freecharge / Enelion-spezifische Konfiguration | IM CODE | Tests vorhanden; konkrete Hardware PILOT OFFEN |
| Windows-OCPP-Dauersimulator, 11 kW Nennwert, 60 s Pausen | IM CODE | Python-CI BESTANDEN; Langzeittest/Praxis PILOT OFFEN |
| Dauerhafter lesender Backend-Testzugang | IM CODE | CI BESTANDEN – getrennte PostgreSQL und HTTP-Evidence API |

## 2. Stromausfall – V1 Pflicht

| Teilfunktion | Implementierung | Abnahme |
|---|---|---|
| Offline-Zustand nach unterbrochenem WebSocket | IM CODE | CI BESTANDEN |
| Offene Transaktion ohne fingiertes Stop/MeterStop erhalten | IM CODE | Reale OCPP-/DB-CI ergänzt; Freigabe nur nach grünem Lauf |
| Neue lesende Recovery-API für unbestätigte offene Vorgänge | IM CODE | Node-API- und physischer OCPP-CI-Test |
| Wiederanlauf und StopTransaction(reason=PowerLoss) | IM CODE | Reale OCPP-/DB-CI ergänzt; Freigabe nur nach grünem Lauf |
| Automatische Übertragung nach Hardware-Neustart bei Offline-RFID | PILOT OFFEN | Firmware- und geräteabhängig |
| Wiederanlauf nach **wirklichem Netzstromausfall** während einer Ladung | PILOT OFFEN | Stromabschalt-Test mit echter Wallbox |
| Offline-RFID darf keine unberechtigten Ladevorgänge zulassen | PILOT OFFEN | Gerätefirmware und lokale Auth-Listen testen |
| Offene Transaktion ohne Stop nach dauerhaft defektem Gerät abschließen | FEHLT | Kein Schätzverfahren / keine fiktive Abrechnung. Manueller Klärungsworkflow später |
| Backend-Ausfall- und Restart-Szenarien über 24 Stunden | PILOT OFFEN | Betriebs-/Wiederherstellungstest erforderlich |

## 3. Firmware-Update – V1 Pflicht

| Teilfunktion | Implementierung | Abnahme |
|---|---|---|
| OCPP 1.6 UpdateFirmware senden | IM CODE | CI: generischer Sendepfad + Backend-Prozess |
| FirmwareStatusNotification verarbeiten | IM CODE | CI BESTANDEN |
| **NEU:** Freigegebener Firmware-Katalog und Geräte-Allowlist | IM CODE | Node-Unit/CI |
| **NEU:** Nur HTTPS-Host, richtiger Vendor/Model, Version | IM CODE | Node-Unit/CI |
| **NEU:** Keine Updates während aktiver Ladevorgänge | IM CODE | Node-Unit/CI |
| **NEU:** Persistente Update-Jobs und Statushistorie | IM CODE | Node-Unit/CI; echte Installation PILOT OFFEN |
| **NEU:** Erfolg erst nach Installed + Boot mit Zielversion | IM CODE | Node-Unit/CI; echte Installation PILOT OFFEN |
| Firmware-Update-Knopf im bestehenden Frontend | FEHLT (bewusst) | Frontend-Freeze: keine Änderung ohne gesonderte Freigabe |
| Herstellerfreigabe, echte Firmware, Signaturkontrolle am Gerät | PILOT OFFEN | Ohne verifizierte Herstellerpakete keine Freigabe |
| Wiederanlauf/Rollback bei Stromausfall während Flash | PILOT OFFEN | Risikoreicher Hardwaretest, nicht in CI beweisbar |
| Automatischer Massen-Rollout/OTA für alle Kunden | NICHT ERFORDERLICH | V1 nur gezielte Einzelgeräteupdates |

## 4. Wesentliche V1-Lücken

| Bereich | Stand | Warum es noch wichtig ist |
|---|---|---|
| Dynamisches Lastmanagement auf echter Master/Slave-Hardware | PILOT OFFEN | 30-kW-Simulation beweist keine Grenzwerte am Netzanschluss |
| Rechtssichere kWh-/€-Abrechnung | PILOT OFFEN | MID allein ersetzt keine Prüfung von Mess-/Eichrechtsanforderungen |
| Geräte-Firmware aktualisiert und danach wieder ladefähig | PILOT OFFEN | Herstellerabhängig, kein ausreichender echter End-to-End-Test |
| Monitoring und Alarmierung bei länger offline | FEHLT/TEILWEISE | Ohne Alarm kann ein System unbemerkt ausfallen |
| Sicherer DB-Backup/Restore, Wiederherstellungszeit | PILOT OFFEN | CI-Datenbanken sind keine Produktiv-Backup-Tests |
| Lastverhalten bei zehn physischen Wallboxen inkl. Phasenkonzept | PILOT OFFEN | Echte elektrischen Grenzwerte / Kommunikationsstörungen |
| OCPP-1.6 Security Extensions und ISO 15118 Plug & Charge | NICHT ERFORDERLICH V1 | Kein Plug & Charge in den ersten WEG-/Firmeninstallationen |
| Reservierungen, Roaming, öffentliches Bezahlen, OCPI | NICHT ERFORDERLICH V1 | Kein öffentliches Ladeangebot |

## 5. Deployment- und Sicherheitsregeln

- **Privat / Render live:** \`mawosned/ChargeVisor-Business\`, unveränderter
  Produktions-Commit \`b541e5c34006dd3697037bf2ebcdd254a4cd0398\`.
- **Öffentlich / Entwicklung:** \`mawosned/ChargeVisor-Business-Dev\`.
  Nur hier erfolgen die V1-Ergänzungen; keine automatische
  Übertragung in die private Render-Instanz.
- Backend-/Browser-/OCPP-/Simulator-/WEG-CI und UI-Hash müssen vor Merge grün sein.
- Funktionen mit \`PILOT OFFEN\` dürfen nicht als produktiv freigegeben markiert werden.
- Eine **vollständig erledigte** Checkliste setzt den notwendigen
  Hardware- und Abrechnungspilot voraus. CI-GRÜN allein reicht nicht.

**Wichtig:** Diese Liste ist die fortzuschreibende Abnahmeliste.
Erst bei tatsächlichem Nachweis Status ändern; niemals aus
Code-Vorhandensein oder OCPP-ACK automatisch „fertig“ ableiten.
