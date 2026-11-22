# Hardwarepilot für ChargeVisor Business

## Inbetriebnahme

1. Richte als Walectra-Superadmin einen aktiven Kunden, Standort und eine physische Ladestation ein. Bei einer gemeinsamen Master/Slave-Verbindung müssen die Connector-Nummern mit der Hardware übereinstimmen.
2. Aktiviere an der Wallbox OCPP 1.6 JSON mit HTTP Basic über TLS. Bei Geräten wie der Enelion Lumina mit separatem Feld „Charge Point ID“ kommt die WSS-Basisadresse bis einschließlich `/ocpp/` in „OCPP URL“. Das Gerät hängt die ID an. Für Clients, die eine vollständige URL verlangen, kopiere stattdessen die WSS-Adresse mit ID. Der Basic-Auth-Benutzername entspricht der OCPP-ID. Speichere das einmalig angezeigte Passwort im Gerätekonfigurator.
3. Wähle einen aktiven Nutzer und weise ihm den tatsächlichen Ladepunkt zu. Erfasse unter „RFID-Karten verwalten“ die Kennung, die die Wallbox als OCPP-idTag sendet. Alternativ öffne das 90-Sekunden-Fenster für diese Verbindung, halte die Karte vor und bestätige die Zuordnung.
4. Prüfe am Gerät einen vollständigen Vorgang von Boot und Autorisierung bis Stop. Vergleiche anschließend Connector, Nutzer, Anfangs- und Endzeit und Energie mit dem Zähler der Wallbox. Prüfe auch eine unbekannte Karte, einen fremden Connector, eine gesperrte Karte und einen Ausfall mit Wiederverbindung.
5. Prüfe die lokale oder Offline-Autorisierung der konkreten Firmware. Ein lokal erlaubter Ladevorgang kann physisch anlaufen, bevor das Backend ihn sieht. Für den ersten Pilot muss die Wallbox die Online-Entscheidung zuverlässig umsetzen.

## RFID oder Freecharge

Unter „Standorte & Ladepunkte“ kann der Superadmin in den Details eines physischen Ladepunkts den Lademodus einstellen. Bei RFID ist ein freigegebener Nutzer mit Karte und Ladepunktzuweisung erforderlich. Im Freecharge-Modus autorisiert ChargeVisor zusätzlich den idTag `CV-FREECHARGE` für den jeweiligen Connector. Solche Vorgänge erscheinen als Freecharge in der Ladehistorie und im PDF-Ladebericht.

Die Wallbox muss den Tag beim Einstecken senden. Bei einer verbundenen Enelion Lumina kann die Einstellung über die dokumentierten OCPP-Konfigurationsschlüssel übertragen werden. Alle Connectoren mit derselben OCPP-ID müssen dazu denselben Lademodus haben. Prüfe die Rückmeldung der Wallbox und teste Einstecken sowie Kartenpflicht am Gerät. Die Online-Freigabe ändert die Offline-Autorisierung der Wallbox nicht. [Enelion-Konfigurationsschlüssel](https://service-support-enelion.happyfox.com/kb/article/20-faq-custom-ocpp-configuration-keys/)

## Betrieb

`CV_RFID_HMAC_KEY` enthält 32 zufällige Bytes in Base64 und gehört in den Secret-Speicher des Dienstes. Für Wiederherstellungen muss derselbe Schlüssel verfügbar bleiben. Eine Rotation ohne Migration macht bisherige Kartenkennungen für neue Freigaben unbrauchbar.

Die Ladehistorie zeigt die zuletzt erfassten 100 Vorgänge sowie die Differenz der gemeldeten Energiezähler. Eine fehlende oder rückläufige Endmessung ergibt keine Verbrauchsangabe. Messwerte können nicht für eichrechtsgebundene Abrechnungen verwendet werden, bis Hardware, signierte Messwerte, Aufbewahrung, Auswertung und Export dafür geprüft und implementiert sind.

Vor unbeaufsichtigtem Kundenbetrieb sind ein unabhängiger 24-Stunden-Test mit der vorgesehenen Firmware, Überwachung der Verfügbarkeit und Wiederverbindungen sowie ein Datenbank- und Schlüssel-Restore zu prüfen. Der WebSocket-Zustand liegt derzeit im laufenden Serverprozess. Render Free bietet keine garantierte Dauerverfügbarkeit.

Die automatisierte Prüfung verbindet einen separaten WebSocket-Client mit einem ChargeVisor-Prozess und einer temporären PostgreSQL-Datenbank. `scripts/physical-ocpp-ci.mjs` benötigt einen Loopback-Server mit `CV_RFID_HMAC_KEY`, ein Test-Superadmin-Konto und eine Datenbank namens `chargevisor_ci` oder `chargevisor_ci_…`. Die Ablaufprüfung ersetzt die Abnahme an der physischen Wallbox nicht.

## Umschalten auf chargevisor.de

Füge `chargevisor.de` dem bestehenden ChargeVisor-Business-Webdienst in Render hinzu. Richte die von Render angegebenen DNS-Einträge bei IONOS ein und prüfe zuerst die Domain und das TLS-Zertifikat in Render. Die Mail-Einträge gehören zur Mailzustellung und werden für die Website-Zuordnung nicht geändert.

Setze `CV_PUBLIC_URL=https://chargevisor.de` erst bei erfolgreicher TLS-Prüfung. Die Startseite führt dann zur Anmeldung. Die bisherige Installationsadresse für Wallboxen kann während der Umstellung bestehen bleiben. Registriere die neue Microsoft-OAuth-Callback-Adresse in Entra, bevor du die bestehende Mailverbindung über die neue Domain erneut autorisierst. Prüfe nach dem Umschalten Login, Passwort-Reset, Einladung und WSS von außen.
