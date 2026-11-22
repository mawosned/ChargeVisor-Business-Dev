# ChargeVisor Business – echte Anmeldung (Implementierungsstand)

Stand: 18.11.2026. Die bisherige Demo unter `/` bleibt absichtlich unabhängig und unverändert.
Ein separater authentifizierter Pilot-Bereich ist unter `/login` erreichbar.

## Implementiert
- Server-Sessions mit zufälligem Token; ausschließlich SHA-256 des Tokens in PostgreSQL; Secure/HttpOnly/SameSite-Cookie.
- Scrypt-Passworthashes mit individuellem Salt.
- Drei Rollen: `superadmin`, `admin`, `user`; Backend prüft Rollen und Tenant-ID.
- Superadmin: Kunde anlegen, `pending/active/suspended`, lizenzierte Ladepunkte.
- Kunden-Admin: Nutzer per 72-Stunden-Einmal-Link einladen, Nutzerübersicht, Ladepunktverwaltung innerhalb des lizenzierten Kontingents.
- Nutzer: nur explizit zugewiesene Ladepunkte über API sehen.
- Serverseitige Auditeinträge, Herkunftsprüfung bei Änderungen, Begrenzung der Passwortversuche.
- Mandantenübergreifende Ladepunkt-Zuweisungen zusätzlich durch PostgreSQL-Fremdschlüssel blockiert.
- Einladungen werden als Einmal-Link geliefert; bei konfiguriertem IONOS-SMTP werden sie automatisch verschickt. Ohne SMTP sind manuelle Links möglich.
- Nur datenschutz- und kostenneutral vorbereitete Authentifizierungsstruktur; **noch nicht produktionsfertig**.

## Noch nicht aktiviert
Der Render-Workspace enthält bereits eine kostenlose Staging-Datenbank und lässt keine zweite kostenlose Render-Datenbank zu.
Die vorhandene Datenbank gehört zur OCPP-/BLITZ-Testumgebung und darf nicht ohne ausdrückliche Entscheidung vermischt werden.
Darum ist `CV_DATABASE_URL` aktuell bewusst nicht gesetzt; `GET /api/auth/status` meldet `ready:false`.
**Der sichtbare Pilot-Login kann ohne dedizierte Datenbank noch keine Konten anlegen.**

## Installation – ausschließlich auf neuer ChargeVisor-Datenbank
1. Eigene persistente PostgreSQL-Datenbank bereitstellen, regelmäßige Backups planen.
2. Auf dem **ChargeVisor**-Render-Dienst `CV_DATABASE_URL` auf diese Datenbank setzen; nicht die BLITZ-Datenbank verwenden.
3. Einmalig setzen:
   - `CV_PUBLIC_URL=https://chargevisor-business-demo.onrender.com`
   - `CV_INIT_DB=1`
   - `CV_BOOTSTRAP_EMAIL` (gewünschter Walectra-Superadmin)
   - `CV_BOOTSTRAP_PASSWORD` (mindestens 16 zufällige Zeichen)
4. Render-Deployment abwarten, `/api/auth/status` prüfen, anschließend **CV_INIT_DB und CV_BOOTSTRAP_PASSWORD entfernen**.
5. Unter `/login` als Superadmin anmelden, ersten Kunden erstellen, aktivieren und Ladepunktkontingent festlegen.
6. Kunden-Admin einladen. Dieser nimmt den einmaligen Link an und lädt danach Nutzer ein.
7. Vor echten Kunden: Integrationstests, Passwort-Zurücksetzen, SMTP-Einladungen, Backup/Restore, Monitoring und Datenschutz prüfen.

## Lokal testen
`npm install && npm test`

## Grenzen
- Der bisherige ChargeVisor-Demo-Browserzustand wird **nicht** als Datenbank übernommen.
- OCPP ist noch nicht mit diesen neuen ChargeVisor-Tabellen verbunden. Der getestete BLITZ-/Walectra-OCPP-Core wird separat integriert.
- Die Server-API enthält die Lizenz- und Nutzerrechte, aber noch kein vollständiges Ladepunktmanagement im produktiven Dashboard.
- Automatische E-Mail-Einladungen erfordern ein vorhandenes SMTP-Postfach. Noch keine IONOS-Zugangsdaten eingerichtet.
- Der öffentliche Demo-Rollenwähler ist keine echte Authentifizierung. Nicht zum Verwalten von Kundendaten einsetzen.
- Kein Anspruch auf eichrechtskonforme Stromabrechnung.
- Keine kostenpflichtigen Render-Pläne oder zusätzlichen Dienste wurden bestellt.

## Optionaler Einladungsversand über vorhandenes IONOS-Postfach

Ohne zusätzliche Mailplattform: Auf Render nur für ChargeVisor `CV_SMTP_HOST`, `CV_SMTP_PORT` (587 STARTTLS oder 465 TLS), `CV_SMTP_USER`, `CV_SMTP_PASS` und `CV_SMTP_FROM` setzen. Die Werte stammen aus dem bestehenden IONOS-Postfach. Fehlversand zeigt dem berechtigten Admin stattdessen einen manuellen Einladungslink an. Zugangsdaten nie ins GitHub-Repository schreiben.
