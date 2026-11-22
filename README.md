# ChargeVisor Business – isolierte Demo

Web-Frontend-Prototyp für das Firmenkunden- und WEG-Lademanagement von Walectra.

Die aktuelle Anwendung ist unter `/login` und `/app` erreichbar. Sie enthält
die Mandantenverwaltung, die OCPP-1.6J-Anbindung und die RFID- und
Ladehistorie für den Hardwarepilot. Der [Hardwarepilot-Leitfaden](docs/hardware-pilot.md)
beschreibt Inbetriebnahme, Tests und offene Voraussetzungen für den Kundenbetrieb.

## Ursprüngliche Demo

## Stand
- Drei **simulierte** Rollen: Walectra-Superadmin, Mandanten-Admin, Nutzer
- Mehrere Beispielmandanten und Ladepunkte
- Monatliche Ladevorgänge, Verbrauch in kWh, CSV-Export
- Nutzer einladen und Ladepunkte anlegen (**nur Simulation**; Änderungen im Browser-LocalStorage)
- Master-/Slave-Anzeige (**Simulation**, keine Hardware-Steuerung)

**Es gibt hier noch KEINE echte Authentifizierung, Mandanten-Trennung auf Serverseite, E-Mail-Einladung, Datenbank oder OCPP-Verbindung.** Die Rollenansicht ist eine Frontend-Demo, keine Zugriffskontrolle. Keine echten Kundendaten eingeben.

## Lokal starten
Node.js 20 oder neuer installieren, dann:
```bash
npm start
```
Danach http://localhost:10000 öffnen.

## Render: isolierter Testservice
- Neuer separater Web Service, nur dieses Repository: `mawosned/ChargeVisor-Business`
- Runtime: **Node**
- Region: **Frankfurt**
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Für Vorschau ist Free möglich, aber Free-Dienste können inaktiv werden. **Nicht** für produktives OCPP verwenden.
- Keine bestehenden BLITZ-Services, Datenbanken oder OCPP-Adressen ändern.

## Weiterentwicklung
- Separate API und PostgreSQL-Datenbank
- Serverseitige Mandanten- und Benutzerberechtigungen
- E-Mail-Einladungen mit einmaligen Tokens
- OCPP 1.6J und Hardwarevalidierung (sechs OCPP-IDs oder ein Master mit mehreren Connectoren)
- Tests, Lasttests, Sicherung/Wiederherstellung, Security Hardening
- Originales ChargeVisor-Logo noch nicht eingebunden

**Technische und organisatorische Trennung von BLITZ ist zwingend.**

## Neu: Echte Anmeldung als separater Pilot

Unter `/login` gibt es nun eine echte PostgreSQL-basierte Backend-/Login-Implementierung mit Nutzer-Einladungen, Tenant-Rechten und Walectra-Lizenzfreigabe. Die vorhandene Frontend-Demo bleibt bewusst unabhängig.

**Wichtig:** Die Anmeldung ist derzeit nicht aktiviert, weil eine dedizierte ChargeVisor-Datenbank fehlt; wir verwenden nicht heimlich die BLITZ-Staging-Datenbank. Siehe [Auth Setup und Grenzen](docs/auth-foundation.md).

