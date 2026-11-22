# RFID-Anmeldung

Superadmins und Kunden-Admins können aktive Nutzer ihrer Kundenkonten mit einer
RFID-Karte verknüpfen. Normale Nutzer haben keinen Zugriff auf die Verwaltung.
Der Superadmin findet die Funktion unter „RFID“. Der Kunden-Admin öffnet sie
in der Nutzerverwaltung.

Über „Nutzer hinzufügen“ kann der Kunden-Admin ein RFID-Profil anlegen und ihm
einzelne, mehrere oder alle aktuell aktiven Ladepunkte des Kunden zuweisen.
Der Portalzugang wird erst durch eine angenommene Einladung aktiviert. Der
Superadmin kann für jeden Kunden-Admin „Nutzer zum Portal einladen“ und
„PDF-Ladeberichte herunterladen“ separat unter „Freigaben“ einstellen.

- **Zuletzt erkannt:** Halte die Karte an eine verbundene physische Wallbox.
  Meldet sie einen unbekannten idTag, erscheint eine Erkennung für den
  Kunden mit Zeitstempel und, soweit verfügbar, dem Ladepunkt. Wähle einen
  aktiven Nutzer und bestätige die Zuordnung. Du kannst dabei ausgewählte
  oder alle aktuell aktiven Ladepunkte des Kunden freigeben. Bereits
  zugewiesene Ladepunkte bleiben freigegeben.
- **Kennung eingeben:** Verwende den idTag, den die Wallbox tatsächlich sendet.
- **An Wallbox einlesen:** Wähle die physische OCPP-Verbindung und starte das
  90-Sekunden-Fenster. Die nächste unbekannte Kennung dieser Verbindung wird
  angezeigt. Prüfe die Kennung und bestätige anschließend Nutzer und Karte.

„Zuletzt erkannt“ zeigt pro Kunde bis zu 50 unbekannte Karten aus den letzten
24 Stunden. Der Server speichert dafür nur einen HMAC der Kartenkennung.
Im 90-Sekunden-Fenster ist die Kennung kurz im Arbeitsspeicher verfügbar.
Die erfasste Kennung erlaubt erst nach der
Zuordnung einen Start. Beim Start prüft ChargeVisor den aktiven Nutzer, die
Karte, den Kunden und den konkret freigegebenen Connector. Testkarten für
virtuelle Stationen haben einen eigenen Ablauf.

Beim OCPP-1.6-Aufruf Authorize ist keine Connector-ID verfügbar. Die Zuordnung
zum einzelnen Ladepunkt wird beim Start geprüft. Ob eine Wallbox unbekannte
Karten online meldet und wie sie sich offline verhält, hängt von Modell,
Firmware und Konfiguration ab. Siehe [Hardwarepilot](hardware-pilot.md).
