# ChargeVisor Business – Entwicklungsstand und Sicherheitsregeln

**Aktueller Live-Stand 25.11.2026, 21:59:04 CET:** `2061feaa3da0f9eab90d3d9de6f644eef9eac6ce` (PR #24, optionale Kundenanschrift). Ältere Live-Angaben sind Historie. PR #21 weiterhin separat und nicht produktiv. Rollback-Branch `backup/pre-customer-address-20261125`; additive Adressspalten bei Code-Rollback nicht löschen.

## Optionale Kundenanschrift – 25.11.2026 (LIVE)

- Nutzerfreigabe: Kundenanschrift separat von Standortanschrift, fünf optionale Felder Straße, Hausnummer, Postleitzahl, Ort, Land. Im bestehenden Anlege- und Bearbeitungsdialog mit vorhandenen CSS-Klassen; Deutschland beim Neuanlegen vorausgefüllt, änder-/löschbar. Bestehende Adressen werden nicht erfunden. Anzeige in Kundenverwaltung und Superadmin-Kundenkonto; vorhandene Kontakt-/Einladungslogik und Rollen unverändert.
- `backend/schema.sql` und idempotente Migration in `backend/auth.mjs` ergänzen fünf Textspalten in cv_tenants mit leerem Standard. Bestehende Superadmin-API GET/POST/PATCH speichert und liest diese Felder; fehlendes PATCH-Feld bleibt erhalten, explizit leerer String leert Feld. PLZ bleibt Text einschließlich führender Null. Keine Änderung an cv_sites, OCPP, Ladehistorie, RFID, Premium, Erweiterungsdialog oder BLITZ. Keine Produktions-DB-Mutation im Entwicklungsbranch; additive Migration beim freigegebenen Deploy erfolgreich.
- PR [#24](https://github.com/mawosned/ChargeVisor-Business-Dev/pull/24), Prüfcommit `f731bd31ca57bdb1ad5466c3309d6de36e0e3da3`. Geänderte Dateien: app-live.js, backend/auth.mjs, backend/schema.sql, scripts/physical-ocpp-ci.mjs, scripts/ui-regression.spec.mjs, scripts/verify-frontend-unchanged.mjs. Regressionstests für optionale Anlage, Teiländerung, Löschen, Validierung, Rollen und Browser. CI vollständig verifiziert: 6/6 Workflows erfolgreich, 96/96 Node, 16/16 Chromium inklusive optionaler Kundenanschrift, isolierter PostgreSQL/API-Test für Anlage, Teiländerung, Löschen, Validierung und Rollen erfolgreich. PR #24 auf main gemergt: `2061feaa3da0f9eab90d3d9de6f644eef9eac6ce`; Render-Auto-Deploy `dep-dc3knud9el5s73adklhg` seit 25.11.2026 21:59:04 CET live verifiziert; Build 96/96, Auth/RFID aktiv. Alle fünf neuen Textspalten produktiv verifiziert; bestehende Kunden-, Standort- und historische Transaktionsdaten vor/nach identisch (read-only Fingerprints). Praktische Live-Sichtprüfung offen. Rollback `backup/pre-customer-address-20261125`. Kein Merge/Deploy ohne Freigabe; PR #21 (Datumsfilter/Rollenlabel) weiterhin separat.


**Aktueller Statusabgleich 25.11.2026:** GitHub main und Render auf `33dca8ae387ade35b8f47591a76ffce38620dbbb` verifiziert live. Erweiterungsdialog PR #23 freigegeben; PR #21 offen und bei letzter Abfrage nicht mergefähig. Vor Integration Konflikte auf aktuellem main prüfen und Tests neu ausführen. Neuer Kopier-Prompt in `docs/START-NEW-CHAT.md` auf diesem Docs-Branch. Ältere Angaben sind Historie.

## Erweiterungsdialog bestehender Ladestationen – 25.11.2026 (LIVE)

- Nutzer hat den Entwurf ausdrücklich bestätigt: vorhandene Ladestation/Standort und bestehende Ladepunkte schreibgeschützt anzeigen; zusätzliche Anzahl wählen, neue Ladepunkte separat benennen, Gesamtzahl anzeigen. Bestehende Setup-CSS-Klassen wiederverwendet. Namen bleiben beim Reduzieren/Erhöhen der Anzahl erhalten. Backend-Grenze 32 (inklusive deaktivierter Punkte und vorhandener Connector-Nummern) berücksichtigt. Bei gemeinsamer OCPP-Verbindung werden erwartete fortlaufende Connectoren vorab und tatsächlich zugewiesene IDs nach erfolgreicher API-Antwort gezeigt; Hardware-/Master-Konfiguration und Herstellergrenzen separat beachten. Bei individuellen Wallboxen bleibt der vorhandene einmalige OCPP-Zugangsdaten-Dialog erhalten.
- Ausschließlich `extendStation()` in `app-live.js` geändert, zwei Chromium-Regressionstests und zugehöriger UI-Fingerprint. Backend-API, CSS, Datenbank, Rollen, OCPP, bestehende Ladepunkte und Anlege-Dialog unverändert. Keine echte Hardware-/DB-Aktion. [PR #23](https://github.com/mawosned/ChargeVisor-Business-Dev/pull/23), Prüfcommit `6ac740d95f8f14c31755493f183593b992e260c8`. CI verifiziert: 6/6 Workflows, 96/96 Node, 15/15 Chromium einschließlich beider neuer Dialogtests, unabhängige OCPP- und physische RFID-Integration erfolgreich. PR #23 auf main gemergt: `33dca8ae387ade35b8f47591a76ffce38620dbbb`; Render-Auto-Deploy `dep-dc3j4la9lscs73d4425g` seit 25.11.2026 20:09:46 CET live verifiziert; Build 96/96 erfolgreich, Auth und RFID aktiviert. Historische Ladedaten vor/nach anhand read-only Fingerprint identisch. Reale UI-Abnahme offen. Rückfallbranch `backup/pre-extension-dialog-20261125` auf dem letzten produktiven Anwendungsstand. Nicht mit dem separaten Session-Fix PR #21 vermischen; keine Live-Übernahme ohne Freigabe und erfolgreiche Tests.


**Quellenwechsel verifiziert – 25.11.2026:** Benutzer hat im bestehenden Render-Service die GitHub-Quelle auf dieses Repository umgestellt. Render bestätigt `mawosned/ChargeVisor-Business-Dev/main`, Auto-Deploy aktiv, Deployment `dep-dc3iq0p5efls73c073p0` live seit 25.11.2026 19:47:06 CET, Commit `b0f9ba9ff080c84e960459e3e36fe954bb5c9d9c` identisch mit GitHub main. Render-Build 96/96, 0 Fehler, Auth/RFID aktiv. Read-only Datenbankvergleich vor/nach identisch. Service, Tarif, Region und Build-/Startbefehle unverändert. Keine Datenbank-Schreibaktion. Reale Browser-/Wallbox-Abnahme bleibt offen. Das alte private Repo ist nicht mehr Render-Quelle und bleibt ausschließlich Rückfallsicherung. PR #21 bleibt separat offen; sechs CI-Workflows zuletzt erfolgreich, Mergefähigkeit erneut prüfen. Dieser reine Dokumentationsnachtrag bleibt bis zur nächsten freigegebenen Übernahme auf dem Docs-Branch, um kein zusätzliches Render-Deployment auszulösen.

## Konsolidierung auf ein aktives Repository – 25.11.2026

**Neue verbindliche Nutzerentscheidung:** Dieses öffentliche Repository `mawosned/ChargeVisor-Business-Dev` ist das einzige Ziel für weitere Entwicklung, Tests, Dokumentation und – nach Umstellung der Render-Quelle – Releases. Später soll es privat gestellt werden. Das bisherige private Repository bleibt als unveränderter Rückfall-/Historienstand erhalten, nicht als zweite aktive Entwicklungsquelle.

**Historischer Status vor Render-Umstellung:** Der bestehende Dienst ist noch mit dem früheren privaten Repository verbunden. Sein aktuell bestätigter Live-Stand entspricht hinsichtlich sämtlicher Web-App-, Backend-, Schema-, Asset- und Paketdateien dem öffentlichen main-Stand `18ad2b0daae0dccf94a1c22863d7fdeed5d15b00`. Vollständiger Vergleich der Git-Dateibäume: 132 identische Dateien; übrige Unterschiede sind Dokumentation, CI, alte Backup-Hilfsdateien und die bereits weiterentwickelte Windows-Simulator-Version im öffentlichen Repo. Diese Simulator-Version bleibt erhalten. Rückfallbranch `backup/pre-single-repo-20261125` sichert den öffentlichen Ausgangsstand. Keine Änderung an Laufzeitcode, DB, Domain, Hardware, Render-Konfiguration oder BLITZ durch diese Dokumentationsänderung.

**Historischer Ablauf der inzwischen abgeschlossenen Umstellung:** Im bestehenden Render-Service nur Build > Source auf dieses GitHub-Repo, Branch main, Node, npm install / npm start ändern. GitHub-Integration verwenden; keine neue Instanz und keine Änderung von Umgebungsvariablen, Region, Tarif, Domain oder Datenbank. Erst nach verifiziertem Live-Deploy, Datenvergleich und Funktionsprüfung ist der Wechsel abgeschlossen. Alte private Quelle bis dahin nicht löschen/archivieren. Danach alle Codeänderungen ausschließlich hier über Feature-Branches/PR, CI und freigegebenen Merge nach main. Keine manuelle Kopie zwischen Repositories mehr. Reine Doku möglichst ohne unnötiges Produktivdeployment.

**Letzte freigegebene Funktionen:** 24.11. Admin-Nutzeranlage und RFID direkt in der Nutzerliste (keine Premium-Pflicht), Portal-Einladung separat Premium, Rollenvorschau schreibgeschützt; Premium-Aktionen mit einheitlichem türkis-grünem Verlauf und weißem Stern; Favicon/Apple Touch Icon/PWA-Icons, vorhandenes Schriftlogo unverändert. Icon-Release DEV PR #20: 96/96 Node, 13/13 Chromium, 6/6 CI; vorher auf bisherigem Render-Dienst live bestätigt.

**Noch nicht produktiv:** DEV PR #21 (Datumsfilter / Fernstart-Rollenlabel) hat beim zuletzt abgefragten Stand alle sechs CI-Workflows bestanden, wurde aber nicht gemergt/deployed. Nicht mit dem reinen Repository-Wechsel vermischen.

**Backups:** Der alte unverschlüsselte produktive Backup-Workflow wird bewusst nicht in das öffentliche Repo übernommen oder aktiviert. Die bereits vorhandene sichere verschlüsselte Archiv-Implementierung und Runbooks bleiben erhalten; echter Backup-Upload und Restore sind noch nicht nachgewiesen. Keine Produktionssecrets, personenbezogenen Daten, internen Logs oder vertraulichen privaten Übergabedetails in öffentliche Git-Dateien übernehmen. Die spätere Sichtbarkeitsänderung macht frühere Kopien nicht rückgängig.

Aktuelle Übergabe: [docs/START-NEW-CHAT.md](docs/START-NEW-CHAT.md) und [docs/project-handover.md](docs/project-handover.md). Ältere Aussagen zum Zwei-Repo-Prozess sind historische Einträge, keine neue Arbeitsanweisung.


## UI-Fix: Blitzen im 12-Sekunden-Live-Poll (23.11.2026)

**Fehler/Ursache:** Unter `Standorte & Ladepunkte` und auf der `Übersicht` rief `pollLive()` nach jeder OCPP-Datenabfrage (Timer: exakt 12.000 ms) das globale `render()` auf. `render()` setzt `#content.innerHTML` komplett neu, ebenso Navigation/Kundenwahl; das Übersicht-Dashboard lud zudem `analyticsChart.innerHTML` und `analyticsSessions.innerHTML` wiederholt. Folge: deutliches Blitzen, Zurücksetzen der LED-/CSS-Animationen und Neuladen der Lumina-Bildelemente, obwohl der Render-Server stabil weiterlief.

**Gezielte, bewusst eng begrenzte Reparatur:** Nur `app-live.js` im Frontend geändert, ohne Layout/Styling/Lumina-SVG/HTML-Routen oder Intervalle zu ändern. `pollLive` behält seine bestehende 12-Sekunden-OCPP-Abfrage und aktualisiert den angezeigten Bereich über `renderLiveOnly()`. Ein kleiner keyed-DOM-Abgleich erhält die Identität bestehender Kundenwahl, Standorte, Stationen, Punkte, Lumina-Grafiken, LEDs, Buttons, SVG-Diagramm und Messwerte, verändert aber sichtbar Status/Text/Leistungswerte/fehlende oder neue Elemente. Async-Charts/-Historie werden nicht durch `Messwerte werden geladen` ersetzt. Auch `loadOverview()` aktualisiert Chart und Historie mit demselben Abgleich. Während offener Dialoge, verstecktem Tab oder aktiver Suche kein Poll-Umbau; überholte Poll-Antworten werden nach Seitenwechsel verworfen. Alle bisherigen vollständigen `render()`-Aufrufe bei echten Benutzeraktionen und Laden bleiben erhalten.

**Tests und Schutz:** Eigener Chromium-Regressionstest simuliert einen echten 12s-Poll, wechselt OCPP-Status `Charging` → `Available` und verlangt zugleich dasselbe `#content`-Element, dieselbe Kundenwahl, dasselbe Diagramm, denselben Standort, dieselbe Ladestation, den Ladepunkt und dasselbe Lumina-Bild/LED-Element. Bestehende Feature-/Berechtigungs-/OCPP-/Simulator-/Kunden-/History-Tests zusätzlich ausführen. UI-Freeze-Fingerprint im bewusst UI-spezifischen Branch nur für `app-live.js` aktualisiert; 13 weitere geschützte Dateien/Assets bleiben exakt unverändert.

**Freigabegrenze:** Zunächst Entwicklungs-Branch `fix/live-poll-flicker-20261123`; erst nach grünen Tests, Übernahme in privates Repository, dokumentiertem Rücksprungpunkt und Render-Check deployen. **Keine Änderung der Backend-OCPP-Protokollverarbeitung und keinerlei Neon-Datenkorrektur.** Die separat bestehenden ungeklärten OCPP-Verbindungsabbrüche bleiben unabhängig offen.



## RELEASEKANDIDAT 23.11.2026 – Lumina-Ladebuttons + lesende OCPP-Diagnose

**Freigabe:** Nach beendetem 120-Minuten-Test hat der Nutzer am 23.11. ausdrücklich die Implementierung, sofortige Render-Bereitstellung und README-Dokumentation beauftragt. Dieser Release-Branch integriert die zuvor einzeln getesteten Entwicklungs-PRs [#14 Backend](https://github.com/mawosned/ChargeVisor-Business-Dev/pull/14) und [#15 UI](https://github.com/mawosned/ChargeVisor-Business-Dev/pull/15). Kein ersatzweises Redesign, keine Löschung vorhandener Funktionen.

- **Frontend `app-live.js`:** Play beim tatsächlich angeschlossenen Auto ohne aktive Transaktion (`Preparing`/`SuspendedEV`/`SuspendedEVSE`/`Finishing`); während `Charging` mit aktiver TX **nur Pause**; nach remote `SetChargingProfile` pausierter aktiver TX **Play+Stop**; bei falschem altem DB-Flag `remote_paused=true`, während OCPP wieder `Charging` meldet, **Pause statt falschem Stop**. Bei Offline/`Available` kein nutzloses Play, Transaktions- und Connector-Grenzen respektiert. `Finishing`-Start ist ein Versuch: die echte Wallbox kann ablehnen.
- **Nur Superadmin, nur physische Station:** Neuer Button **„OCPP-Ladeprofil prüfen“** im bestehenden aufgeklappten Ladepunkt-Detail. Er sendet bei Klick eine enge, autorisierte `POST /api/ocpp/composite-schedule`, intern nur OCPP-1.6J `GetCompositeSchedule` für genau den Connector (300 Sekunden, A). **Keine Stromregelung und keine Löschung bestehender Profile**. Status `Rejected`/fehlender Schedule/ungültige Antwort/unsupported klar als nicht auswertbar statt fälschlich 16 A. Gemeldeter 12-A-Plan beweist nicht, welches Gerät den Grenzwert gesetzt hat.
- **Backend:** Re-Pause bei aktiv ladendem Fahrzeug auch mit veraltetem `remote_paused`-Flag erlaubt; `RemoteStartTransaction` bei `Finishing` auf explizite Benutzeraktion. Alle anderen OCPP-Routen bleiben funktional unverändert.
- **Design-Freeze:** Unverändert: `app.html`, `styles.css`, `app.js`, `index.html`, `login.*`, `portal-language.js`, `exports.js` und sämtliche Lumina-/Walectra-/BLITZ-Bilddateien. `app-live.js` bewusst als einziger geänderter Frontend-Blob `f14cbeb4cc734aa72fd18183f1cbb2286436154e`; der UI-Regressionsschutz lässt sonst keine Änderungen zu. Zusätzlich Chromium-Tests für Pause → Resume/Stop → Ladezustand, für getrennte Slave-Connectoren und Kunden-/Rollenisolation. Backend, Python- und externe OCPP-Tests müssen gemeinsam grün sein.
- **Dauertest-Befund:** Sechser-Testkette ca. 120 Minuten; Neon 20 von 20 beendete Transaktionen, je richtigem Connector, ~18,022 kWh simuliert, 242 Heartbeats und 1.404 MeterValues. **Verbindungsabbrüche Code 1006 bleiben ungelöst**, Reconnect bestätigt. Vor Pilotkunden Freigabe Verbindung, 39 nicht geprüfte Matrixfälle, Kennzeichnung künstlicher Testtransaktionen und verlässliche echte Backup-/Restore-Probe gesondert behandeln.
- **Auslieferung:** Beide Feature-PRs zunächst auf separatem Integrations-Branch kombiniert und **komplett über CI vor jedem Produktiv-Merge** geprüft. Anschließend nur gezielte, nach Hash verifizierte Quell-Dateien in `ChargeVisor-Business` übertragen und README im privaten Repo aktualisiert. `main` dort führt automatisch zum Render-Deployment. Render muss **live** und auf genau dem erwarteten Commit stehen; Browser-Liveansicht/physische OCPP-Antwort müssen getrennt verifiziert werden.


## FIX BESTÄTIGT / AUSGELIEFERT IM DEV – HTTP 403 bei normalem OCPP-Simulator behoben (23.11.2026)

- **Öffentliches `ChargeVisor-Business-Dev/main`**, Merge-Commit `d6e3bf32778a59d1fca78d734cb95a0456dab7f6`, <https://github.com/mawosned/ChargeVisor-Business-Dev/pull/12>. **Alle sechs PR-CI-Workflows erfolgreich** (einschließlich OCPP-Desktop-Simulator-Tests und ChargeVisor-Browserregression). Der neue Regressionstest stellt sicher, dass `desktop_simulator.py` **keinen `X-ChargeVisor-Test-Wallbox`-Header** mehr an eine reguläre OCPP-Verbindung anhängt.
- **Verbindliche technische Vorgabe:** Der Windows-Simulator emuliert eine echte OCPP-1.6J-Wallbox und verbindet sich mit den normalen ChargeVisor-Daten: WSS-Endpunkt `.../ocpp/`, Charge-Point-ID und zugehöriges OCPP-Basic-Auth-Passwort. **Normale, als `is_simulator=false` registrierte Ladeketten sind zugelassen**, auch `Ladekette Tiefgarage Süd` (`cv6zgvs85d`, 6 Ladepunkte). Keine Pflicht, auf `lumina KI test`/`cv24067z51` (20 Ladepunkte) zu wechseln. Die Standardprüfungen auf korrektes Passwort, autorisierte Station und eindeutige aktive Verbindung gelten weiterhin. `is_simulator` entscheidet lediglich über Kennzeichnung der gespeicherten Test-Ladevorgänge: bei `false` als normale `simulated=false`-Transaktion, bei `true` als simuliert. Keine zusätzlichen Kundenabrechnungen während dieser Tests ausführen.
- **Andere Funktionen bleiben erhalten:** automatischer WebSocket-Reconnect und der ehrliche 120-Minuten-Soak-Bericht mit Unterbrechungs-/Reconcile-Ereignissen, keine Änderung am Web-Frontend, kein neues Render-Deployment. Nachkontrolle: Der auf Render laufende private Commit ist weiter `52116c1a4538061b2fcbb61f100bc7fad967d3b2`, Status `live`. Alle GUI-, Auth-, RFID-, Benutzer-, Customer-, LED- und Design-Dateien unberührt.
- **Was jetzt auf Windows zu tun ist:** In der bereits geöffneten Windows-GUI auf **„Simulator aktualisieren“** klicken. Der installierte, vorher geprüfte `UPDATE-SIMULATOR.ps1` lädt aus dem öffentlichen Dev-`main`, führt **alle Offline-Tests inklusive `test_reconnect.py` vor Austausch** aus, legt ein Backup an und startet die GUI neu. Alternativ den im Simulator-README beschriebenen funktionierenden PowerShell-Startweg verwenden. Danach bisherige WSS-Adresse, `cv6zgvs85d`, **6 Connectoren**, zugehöriges OCPP-Passwort und berechtigte Test-RFID einsetzen und `Verbinden` testen. **GitHub-CI ist kein Beleg für Windows-/Render-Echtverbindung**, die live noch überprüft werden muss.
- **Separate offene Aufgabe bleibt:** **WICHTIG** – verschlüsseltes Neon→SharePoint-Backup samt echtem Upload/Download/Restore testen, keine Abnahme erfolgt.



## VERBINDLICHE KORREKTUR – Windows-OCPP-Simulator nutzt normale Wallbox-Zugangsdaten (23.11.2026)

**Entscheidung des Nutzers:** Der Simulator muss sich **wie eine echte Wallbox** verhalten: OCPP-Server-WSS-URL, Charge-Point-ID und das zugehörige OCPP-Basic-Auth-Passwort direkt aus ChargeVisor eingeben und damit OCPP 1.6J über die regulären Backend-Endpunkte sprechen. **Keine Verpflichtung**, eine speziell als `is_simulator=true` markierte Wallbox zu wählen. Das ist eine Sicherheits-/Datenkennzeichnung im Backend, **kein gesondertes OCPP-Verbindungsprotokoll**. Auch die normale Test-Ladekette `Ladekette Tiefgarage Süd` (`cv6zgvs85d`, 6 Connectoren) muss wieder funktionieren.

**Ursache der HTTP-403-Regression** vom 23.11.: Eine voreilig eingeführte Client-Änderung sendete den Sonder-Header `X-ChargeVisor-Test-Wallbox: 1`. Der bestehende Server lehnt solche Header bei regulären `is_simulator=false`-Stationen absichtlich ab. Deshalb war die korrekte Standard-OCPP-Verbindung trotz gültiger ID/Passwort blockiert. **Fix im öffentlichen Entwicklungs-PR:** Sonder-Header im Desktop-Client entfernt, OCPP 1.6J + Standard-HTTP-Basic-Auth beibehalten, Reconnect-/Soak-Dauerprüfungen unverändert. Kein Backend-/Render-/Frontend-Update erforderlich. Regressionstest prüft, dass die Desktop-GUI nie wieder einen solchen Sonder-Header in ihren normalen Handshake einfügt.

**Klarstellung Daten:** Mit normalen Stationsdaten speichert Neon künstliche Test-Ladevorgänge derzeit `simulated=false`, genau wie bei echten Geräten. Bei einer ausdrücklich virtuellen `is_simulator=true`-Station sind sie als Simulation markiert. Die Wahl liegt beim Nutzer; für spätere reale Kundenabrechnung solche Tests abgrenzen. Die aktuelle eigene Enelion Lumina unter ihrer realen ID **nicht zugleich vom Simulator verbinden**.

**Geplanter Ablauf:** Änderungs-PR mit automatischer CI prüfen → in öffentliches Dev-`main` übernehmen → **lokal auf Windows** mit geprüftem Updater aktualisieren → mit der **bisherigen** `cv6zgvs85d` und sechs Connectoren sowie zugehörigem Passwort verbinden → fünf Minuten testen → anschließend 120-Minuten-Dauertest. Das Update einer GitHub-Datei installiert sich NICHT von selbst auf dem PC. Bisheriger Render-Commit, UI und Datenbank unverändert. **WICHTIG OFFEN:** echtes verschlüsseltes Neon→SharePoint-Backup, Download und isolierter Restore noch zu testen.



## BESTÄTIGT: OCPP-Simulator-Reconnect in DEV – sechs CI-Workflows grün (23.11.2026)

**Stand:** <https://github.com/mawosned/ChargeVisor-Business-Dev/pull/11> ist nach sechs erfolgreich abgeschlossenen GitHub-CI-Workflows in `mawosned/ChargeVisor-Business-Dev/main` gemergt. Merge-Commit: `ee9788eda991e1e9fe3f3171ceb5f20b5774a5c5`. Automatisierte Tests für den Simulator-Reconnect, den Soak-Bericht, den ChargeVisor-Backend-Regressionsschutz, das Browser-Frontend und Mobility House sind erfolgreich. **Kein Code der ChargeVisor-Web-UI wurde verändert, kein Deployment auf Render**, das weiterhin den bisherigen privaten Commit nutzt. Änderungen betreffen ausschließlich `tools/ocpp-chain-simulator/` und READMEs.

**Implementiert:** (1) automatischer WebSocket-Reconnect mit Backoff 2/4/8/16/30 Sekunden, (2) redigiertes lokales `simulator-transport.log` mit Ereignissen, Fehlern und Rückverbindungen, (3) Zählerstand und frühere offene StopTransaction-Antworten vor neuen Ladevorgängen wiederherstellen, (4) 120-Minuten-Soak-Test bei Unterbrechung pausieren und nach erfolgreichem Reconnect fortsetzen, (5) Verbindungsunterbrechung **als FAIL** in der OCPP-Matrix behalten und Gesamtergebnis `COMPLETED_WITH_INTERRUPTION` oder `FAILED` statt irreführend „0 Fehler“ berichten, (6) ausschließlich Teststationen zulassen: die GUI setzt `X-ChargeVisor-Test-Wallbox: 1`, das bestehende Backend lehnt `is_simulator=false` ab.

**Korrekte Station für den Folgetest:** `lumina KI test` mit **20** Connectoren, OCPP-ID `cv24067z51`, `is_simulator=true`, eigenes Test-OCPP-Passwort und berechtigte RFID. Nicht mehr die für den gescheiterten Lauf verwendete normale Sechser-Station `Ladekette Tiefgarage Süd` / `cv6zgvs85d` verwenden. Der letzte Fehllauf war ca. 30 Minuten aktiv, sieben Testladungen #53–59 wurden mit insgesamt 8,591 kWh simulierten Werten beendet und in Neon gespeichert. Die zugrunde liegende Ursache des unerwarteten Abbruchs bleibt unbewiesen; Render zeigte während des Fehlers keine Betriebsunterbrechung und die private echte Enelion Lumina sendete Heartbeats.

**NOCH OFFEN UND NICHT ALS ERFOLGREICH BEHAUPTEN:** Lokale Windows-GUI wurde noch **nicht** aus diesem Merge aktualisiert; der 120-Minuten-Echt-Dauertest gegen Render, reale Reconnect-/StopTransaction-Recovery, korrekte Simulations-Markierung, 20er-Connector-DB/UI-Tests, stale Leistungs-/Statuswerte und Ergebnisreports stehen aus. Den **lokalen Updater zuerst auf die öffentliche Quelle prüfen**; zuvor war der Updater auf Windows veraltet. Der aktualisierte öffentliche Updater testet `test_reconnect.py` offline, sichert die bisherige Installation und tauscht Dateien nur nach grünem Test aus. Kein automatisches lokales Update durch GitHub.

**SEPARAT WICHTIG – BACKUP:** Der **echte** verschlüsselte PostgreSQL-18-Dump nach Microsoft SharePoint mit anschließendem Download und Restore wurde noch NICHT durchgeführt. GitHub-CI hatte nur isolierte Test-Backupdaten. Das ist weiterhin eine priorisierte offene Aufgabe, aber kein Blocker für diesen Testbetrieb.



## OCPP-Simulator: historische Vorbereitung vor bestandenem CI (23.11.2026)

**Auftrag/Stand:** Der gescheiterte 120-Minuten-Test (Abbruch nach ~30 Minuten, ohne WebSocket-Close-Frame) wurde mit Upload-Log, 82-Fälle-Testmatrix, read-only Neon-Abfragen und Render-Ereignis-/Leistungsdaten analysiert. Sieben Testtransaktionen #53–59 und 674 MeterValues waren in Neon vorhanden und korrekt beendet. Render war nicht ausgefallen, die private echte Lumina kommunizierte weiter. **Ursache des Transportabbruchs nicht sicher identifiziert.** Das bisherige Ergebnis (21 PROTOCOL_OK, 61 NOT_TESTED, 0 FAIL in Matrix trotz gescheitertem Gesamtlauf) war für die Zuverlässigkeit irreführend.

**Jetzt auf getrenntem öffentlichen Dev-Branch vorbereitet:** `fix/ocpp-simulator-reconnect-soak-20261123`, <https://github.com/mawosned/ChargeVisor-Business-Dev/pull/11>. Änderungen nur `tools/ocpp-chain-simulator/desktop_simulator.py`, `ocpp_soak.py`, Dokumentation und Simulator-Unit-Tests; **keine ChargeVisor-Web-Frontend-Änderung**, **kein privater Render-Deploy**. Änderungen: Wiederverbindung mit verzögerter Backoff-Schleife; der laufende zeitgebundene 120-Minuten-Test pausiert und setzt nach Reconnect den Ablauf fort; bereits offene OCPP-Transaktionen werden mit StopTransaction abgeglichen, bevor neue starten; Energiezähler bleiben erhalten. Transport-Diagnoseprotokoll ohne Kennwörter; Verbindungsabbrüche werden als Fehler (`SCENARIO.Offline.Disconnect=FAIL`) dokumentiert und bei erfolgreichem Wiederaufbau `SCENARIO.Offline.Reconnect=PROTOCOL_OK`; Ergebnis `COMPLETED_WITH_INTERRUPTION` bei Test bis zum Ende nach einer Unterbrechung, `FAILED` falls keine Recovery gelingt. Transportzähler im JSON-Bericht. **Ergebnisse erst nach CI und Windows-Echtprobe als getestet bezeichnen.**

**WICHTIG – korrekte Simulatorstation:** Der vorige Test verwendete `Ladekette Tiefgarage Süd`, ID `cv6zgvs85d`, `is_simulator=false` und nur sechs Ladepunkte – dadurch wurden künstliche Ladevorgänge als normale Transaktionen gespeichert. Der aktualisierte Simulator sendet `X-ChargeVisor-Test-Wallbox: 1`, sodass das bestehende Backend den Login für jede **nicht** explizit virtuelle Station verweigert. Für den nächsten 20er-Test ist stattdessen **`lumina KI test`**, OCPP-ID `cv24067z51`, `is_simulator=true`, **20 Connectoren** zu nutzen. Nur eigenes Test-OCPP-Passwort und RFID-Freigaben verwenden. Nach GitHub-Merge ist die lokale Windows-GUI **nicht** automatisch aktuell, sondern muss gezielt mit verifizierter öffentlicher GitHub-Quelle aktualisiert und in fünf Minuten vorgetestet werden.

**Offene Kontrolle:** (1) Alle GitHub-CI inklusive Desktop-Simulator-Tests grün, (2) reales Windows-Reconnect-Verhalten, gerade bei laufenden Transaktionen, (3) 20 Ladepunkte / 5 Minuten / 120 Minuten mit Bericht, (4) Neon-Simulationskennzeichnung und UI-/Historien-Trennung sowie veraltete Status-/Leistungswerte. (5) **WICHTIG: verschlüsseltes Neon→SharePoint-Vollbackup inkl. Download/Restore real noch testen.** Dieses Backup ist kein Gate für reine Test-Weiterentwicklung.



## WICHTIG – OCPP-120-Minuten-Simulatortest: nach ca. 30 Minuten abgebrochen, Daten aussagekräftig (23.11.2026)

**Grundlage:** Nutzerdatei `Eingefügter Text(10).txt` (GUI-/Soak-Log) und `ChargeVisor-OCPP-16J-Testmatrix.json`, mit **read-only** Neon-Datenbankabfragen und Render-Events/-Metriken abgeglichen. Die Dateien selbst wurden **nicht** ins öffentliche Repository hochgeladen. Kein Code-/Deploy-/Konfigurationswechsel aus diesem Untersuchungsschritt.

- **Ablauf:** 120 Minuten geplant, Beginn ca. **16:08 UTC / 17:08 MEZ**, Abbruch nach rund **30 Minuten** (JSON generiert 16:38:35 UTC). Letzter Simulator-Status ca. 16:36:21 UTC. Fehler: `OCPP connection lost: no close frame received or sent`, dann `ConnectionError: OCPP socket closed during endurance run`. Es gab keinen sauberen WebSocket-Close-Handshake. GUI-/Soak-Runner beendet den Test bei geschlossenem Socket, **kein automatisches Resume/Reconnect**. Ursache des TCP/WebSocket-Abbruchs **nicht bewiesen**.
- **Render-Check:** Keine Deploys oder Render-Betriebsereignisse (Restart/Crash) im Fehlerzeitfenster; eine Instanz durchgehend; Speicher ca. 98–132 MB bei 512 MB Limit, niedrige CPU. Die reale Enelion `Lumina Garage` sendete zwischen 16:33 und 16:41 UTC durchgehend Heartbeats, **auch während des Simulatorabbruchs**. Ein kompletter Render-Ausfall, OOM und ein neuer Deploy als Auslöser sind daher unwahrscheinlich. Backend `backend/ocpp.mjs` sendet WebSocket-Ping alle 30 Sekunden und terminiert die Verbindung bei ausbleibendem Pong; ohne zusätzliche beidseitige Close-/Ping-/Netzwerklogs lässt sich nicht unterscheiden, ob Ping-Timeout, Windows-/Internet-/Proxy-Abbruch oder anderes transportseitiges Problem.
- **Test lief auf ANDERER Station als geplant:** OCPP-ID `cv6zgvs85d` = **`Ladekette Tiefgarage Süd`**, sechs zugeordnete Ladepunkte, **`cv_stations.is_simulator=false`**. Die zuvor besprochene echte **virtuelle** Teststation `lumina KI test` mit **20** Ladepunkten und eigener OCPP-ID wurde **nicht** verwendet. Alle sieben neuen Transaktionen #53–#59 sind in `cv_ocpp_transactions` als `simulated=false` markiert und werden daher im normalen Ladevorgangs-/Reporting-Pfad geführt, obwohl die Quelle tatsächlich der lokale Simulator war. Kein Nachweis über 20 simultane Connectoren. Im Testbetrieb kein akuter Schaden, aber die Trennung Test/Abrechnung muss vor späteren Kundentests stimmen.
- **Neon-DB bestätigt:** OCPP-Events für Station im Testfenster: **674 MeterValues**, **58 Heartbeats**, **38 StatusNotifications**, **9 Authorize**, **7 StartTransaction** und **7 StopTransaction**. Transaktionen **#53–#59** alle vorhanden und abgeschlossen (`stopped_at` gesetzt), sieben getrennte Transaktionen über Connectoren 1–6, davon sechs parallel; Zählerdifferenzen ergeben **8,591 kWh** künstliche Testenergie (0,165 + 2,306 + 1,938 + 1,578 + 1,218 + 0,873 + 0,513 kWh). 6er-Parallellauf, RFID Accepted/Invalid, SuspendedEV, SuspendedEVSE, verfügbare und fehlernahe Status sowie lokale 30-kW-Simulation liefern reale OCPP-Protokollnachweise. Das 30-kW-Limit ist **lokale Simulatorlogik**, kein Nachweis über Backend-DLM.
- **Matrix ist nicht gleich Gesamt-Teststatus:** 82 Fälle: **21 `PROTOCOL_OK`**, **61 `NOT_TESTED`**, **0 `PASS`**, **0 `FAIL`**. Run ist **FAILED**, obwohl die Matrix 0 FAIL meldet: Der übergeordnete Verbindungsabbruch wird nicht als Testfall im Matrix-Summary gezählt. `PROTOCOL_OK` bedeutet OCPP-Nachricht beantwortet, **nicht** verifizierte UI, Nutzerzuordnung, Abrechnung oder DB-Persistenz. Die DB-Persistenz wurde für Transaktionen/Events nachträglich separat bestätigt.
- **Zusätzliche Konsistenzhinweise:** `cv_ocpp_connector_live` hat für obige OCPP-ID noch alte Connector-Zustände 7–10 vom Vortag, obwohl nur 6 Ladepunkte aktuell zugeordnet sind. Auch `power_w=11040` steht teils noch als letzte gespeicherte Leistung bei Zustand `Available` nach Stop; vor UI-/Abrechnungsbewertung prüfen, ob veraltete Messwerte als aktuelle Ladeleistung fehlinterpretiert werden. Nicht blind löschen/überschreiben.

**Nächste konkreten Arbeiten (priorisiert):**
1. **Beidseitig WebSocket-Diagnostik** ergänzen (Close-Code/Reason, TCP/WS-Fehler, fehlende Pong-Antworten, Zeitpunkte, Connection-ID, letzter Heartbeat) – ohne Credentials und ohne Frontend-Änderungen. Nicht voreilig Render als Ursache behaupten.
2. **Windows-Soak-Runner reconnect/resume-fähig** machen: neuen OCPP-Handschlag, BootNotification, Connector-Zustände neu synchronisieren, aktive Transaktionen/Fehler genau prüfen, Zählerstände erhalten, Unterbrechung separat als Fehler mitzählen, 120-Minuten-Plan nicht wegen eines kurzen Transportabbruchs verlieren. Ob Fehler als `FAIL` und/oder `RECOVERED` zählt, eindeutig definieren.
3. **Nächster Dauertest auf `lumina KI test`**, 20 korrekt angelegte virtuelle Connectoren (OCPP-ID/Passwort dieser Station, **nicht** die ID der realen Lumina und nicht `cv6zgvs85d`), mit separater Test-RFID-Freigabe. Alternativ 6er-Test nur explizit als solcher bezeichnen.
4. Bei folgenden Tests **End-to-End-Belege** für DB, 20er-Connector-Zuordnung, UI-Status-LEDs, abgeschlossene Ladevorgänge und Reports ergänzen; Matrix `PASS` nur bei kontrolliertem Nachweis. `soak-report.json` und `soak-events.csv` vom Windows-Pfad sind für tiefere Client-Diagnose wertvoll, wurden **noch nicht hochgeladen**.
5. **WICHTIG** separater offener Punkt: verschlüsseltes Neon→SharePoint-Vollbackup plus Restore noch real testen. Für Testbetrieb kein Blocker.



## DEPLOYMENT BESTÄTIGT – neues OCPP-Backend auf Render Starter (23.11.2026, 16:52 MEZ)

**Aktueller verbindlicher Stand, ersetzt ältere Hinweise „Release noch nicht deployed“:**

- **Erfolgreich deployed und von Render bestätigt**: `chargevisor-business-demo`, Frankfurt, Render Starter (0,5 CPU / 512 MB). Privates Render-Repository `mawosned/ChargeVisor-Business/main`, neuer Merge-Commit `52116c1a4538061b2fcbb61f100bc7fad967d3b2`, Pull Request **#15**: https://github.com/mawosned/ChargeVisor-Business/pull/15. Render-Deployment `dep-dc261tnavr4c73a72do0` beendete den Start erfolgreich mit `status=live`, 23.11.2026, 15:52:00 UTC. Render-Startlogs: `ChargeVisor RFID: enabled`, `ChargeVisor running on port 10000 (auth enabled)`; **83 Node-Tests im Render-Build bestanden, 0 fehlgeschlagen**.
- **Quellstand**: Öffentliches `mawosned/ChargeVisor-Business-Dev/main`, geprüfter Commit `77d472ce25453cfede88c447d17e7fd0db5d0a09`. Dort sechs erfolgreiche Kern-CI-Workflows genau auf diesem Commit (Backend-Regressionsschutz, allgemeine Checks, Mobility-House-OCPP, Desktop-Simulator, WEG-Zehn-Connectoren, verschlüsselter **Test**-Backup-/Restore). Auf den privaten Render-Branch wurden die **76 gegenüber dem bisherigen privaten Stand abweichenden Backend-/Test-/Simulator-/Dokumentationsdateien** übernommen. Beim anschließenden erneuten Hash-Abgleich stimmen **alle 112 ausgewählten Backend-/Script-/Dokumentationsdateien** im tatsächlich gemergten privaten Stand exakt mit dem öffentlichen Dev-Quellstand überein.
- **FRONTEND ABSOLUT GESCHÜTZT:** Alle **14 bestehenden HTML-, JavaScript-, CSS- und Bilddateien** sind vor und nach dem Merge **byteidentisch** zum ursprünglichen privaten Stand und zur geprüften öffentlichen Quelle: `app-live.js`, `app.html`, `app.js`, `index.html`, `login.html`, `login.js`, `styles.css`, `portal-language.js`, `exports.js`, `assets/blitz-bolt.svg`, `assets/chargevisor-logo.svg`, `assets/login-wallbox.webp`, `assets/lumina-thumb.svg`, `assets/walectra-logo.webp`. Die bestehende Lumina-Abbildung, LED-/Status-UI, Navigation, Kundenkontext und sonstige Optik wurden nicht überschrieben. **Achtung:** Identische UI-Quellen garantieren nicht automatisch eine korrekte Anzeige der neu gelieferten Backend-Daten; noch im Browser prüfen.
- **Rückfallstand angelegt**: Der bisherige private `main`-Commit `0711389a00ccebc359ac53158602376b82f4255c` bleibt als GitHub-Branch `backup/pre-dev-ocpp-20261123-v1` bestehen. Für einen Code-Rollback diesen Stand kontrolliert neu ausrollen, **Neon-Datenbank nicht blind zurücksetzen**. Der ältere private README-, AGENTS- und Backup-Workflow-Stand sowie private-only-Dateien blieben erhalten.
- **OCPP-Hardware nach Deploy nachweislich wieder verbunden:** Neon-Read-only-Prüfung meldete nach dem Neustart `Lumina Garage`, Hersteller `Enelion`, Modell `Lumina`, `simulated=false`, `connected=true`, Status `Available`. Bei derselben Prüfung waren **7 Stationen, 7 OCPP-Credentials, 52 Ladevorgänge, 19.827 OCPP-Ereignisse und 12 Live-Connector-Datensätze** vorhanden. Das ist der Stand **zum Prüfzeitpunkt**, kein 24/7-Test und keine Aussage über eine reale Ladung nach dem Deploy.
- **NOCH MANUELL TESTEN – nächste unmittelbare Aufgabe:** Nutzer startet auf eigenem Windows-Rechner den zuletzt bestätigten rekursiven `START-SIMULATOR.cmd`-Aufruf (siehe oben); von hier aus kann keine Anwendung auf dem Nutzer-PC gestartet werden. Separate, nicht abrechnungsrelevante OCPP-Teststation statt der echten Lumina-ID verwenden. Testmatrix: WSS-Verbindung/Boot/Heartbeat, mehrere Connectoren, Status LED im echten Browser, RFID/Authorize, StartTransaction, MeterValues, StopTransaction, Reconnect, Remote-Start/-Stop, Ladehistorie, CSV/PDF-Export, Kunden-/Rollen-Sicht. Echte Lumina parallel kontrolliert testen. Screenshot-/Log-Nachweise sichern; keine Behauptung über erfolgreich durchgeführte manuelle Tests, bevor sie stattgefunden haben.
- **WICHTIG: verschlüsseltes NEON → SHAREPOINT BACKUP NOCH REAL TESTEN** (separater offener Punkt, derzeit kein reiner Testdeploy-Blocker). `ChargeVisorBackups/Database-Backups` war zuletzt leer. Alte private GitHub-Actions-Sicherung ist wegen GitHub-Billing blockiert und technisch unverschlüsselt; nicht unbedacht starten. Dev hat verschlüsselte Backup-/Restore-Bausteine und isolierte grüne Tests, aber kein nachgewiesenes echtes SharePoint-Backup/Restore unserer Neon-Testdaten. GitHub-Billing ist unabhängig vom Render-Starter-Upgrade. Neon bleibt Free.
- **Freigabestatus:** Eigentümer-Lumina und sämtliche Daten sind nach Nutzerangabe **ausschließlich Testbetrieb**. Neuer Entwicklungsstand ist für diesen Zweck bereits live. Noch keine Freigabe für zahlende externe Kunden. Kein weiteres Deployment und keine Kostenänderungen ohne neue Anweisung.



## WICHTIG – SharePoint-Backup MUSS NOCH REAL GETESTET WERDEN (offener Punkt, 23.11.2026)

**Nicht vergessen oder als erledigt markieren:** Die automatisierte, verschlüsselte **Neon-PostgreSQL-18 → Microsoft 365 SharePoint**-Sicherung ist **noch nicht erfolgreich mit der echten ChargeVisor-Testdatenbank getestet**. Der Ordner `ChargeVisorBackups/Database-Backups` war bei letzter Prüfung leer. In `ChargeVisor-Business-Dev` existieren und bestehen bereits **Offline-/CI-Tests** für AES-256-GCM-Datenbankbackup, Restore in separater Testdatenbank und den (simulierten) SharePoint-Uploader. **Ein echter Microsoft-Graph-App-Upload, Download und Restore fehlen weiterhin.** Der ältere private GitHub-Actions-Workflow wurde durch **GitHub-Billing**, nicht Render Free, blockiert und würde derzeit noch einen **unverschlüsselten** Dump hochladen: **Nicht einfach starten, sondern vorher den sicheren Dev-Workflow integrieren.**

**Später verbindlich nachholen:** (1) sicheren Verschlüsselungsschlüssel getrennt verwahren, (2) echten verschlüsselten PG18-Dump in SharePoint erzeugen, (3) Datei und Größe kontrollieren, (4) sie herunterladen und in eine **leere, isolierte** PostgreSQL-Testdatenbank wiederherstellen, (5) täglichen Scheduler mit Fehleralarm aktivieren, (6) zweimal wöchentlich verschlüsselten Session-CSV-Export verifizieren. Kein unverschlüsselter Datenbank-Dump in öffentliche Repositories, GitHub-Artifacts oder SharePoint.

**JETZIGE PRIORITÄT:** OCPP-Backend-Funktionen weiterentwickeln, den geprüften Dev-Stand kontrolliert auf den bereits laufenden **Render Starter** für unsere **Testumgebung** bringen, anschließend **eigene echte Enelion Lumina und getrennte OCPP-Simulatoren** verbinden und testen. **Der offene Backup-Test ist derzeit kein Blocker für reine Entwicklungs- und Test-Deployments**; alle bisherigen ChargeVisor-Daten sind laut Nutzer Testdaten. Vor dem späteren Betrieb mit zahlenden Kunden muss die vollständige Sicherungs- und Restore-Kette jedoch funktionieren.


## Klarstellung des Testbetriebs – 23.11.2026 (Vorrang vor früheren Produktiv-Warnungen)

**Ausdrückliche Nutzerkorrektur:** Wir befinden uns mit ChargeVisor **weiterhin ausschließlich in Entwicklung und Tests**. Die reale, bereits erfolgreich ladende **Enelion Lumina ist die persönliche Testwallbox des Nutzers**; **alle bisher angelegten Kunden, Standorte, Ladevorgänge, Nutzer und Daten sind Testdaten**, keine aktiv zahlenden WEG-Kunden. Das physisch echte Gerät bleibt natürlich ein echtes OCPP-Gerät, kein Simulator.

**Daraus folgt für die nächsten Schritte:** Das frühere „erst produktives Backup-/Restore-SLA, dann überhaupt neuer Render-Deploy“ war für diese **Testphase zu restriktiv**. **Aktuelle Dev-Version nach CI, kurzem Kompatibilitätscheck und festgehaltenem Rückfallstand kontrolliert auf Render Starter testen**, dabei bewusst mit temporärem Verbindungsabbruch der privaten Lumina rechnen. Ein voll abgenommener externer Produktiv-Backup-/Restore-Prozess ist **kein zwingendes Gate für den Testdeploy**, aber eine funktionierende Sicherung soll **parallel so bald wie möglich** eingeführt und getestet werden. Insbesondere ein einfacher Test-Snapshot vor dem Update ist sinnvoll; keine echten Zugangsdaten oder unverschlüsselten Archive ins öffentliche GitHub stellen.

**Reihenfolge mit wenig Bürokratie:** (1) Existierenden Render-Stand und neue Dev-V1 vergleichen; sechs grüne Kern-CIs bestätigen. (2) Falls praktikabel **einen aktuellen verschlüsselten Testdaten-Snapshot** anlegen und Rückfall-Commit notieren, ohne tagelange Abnahmeprozesse. (3) Neuer Stand über privaten kontrollierten Release/Render deployen; bestehenden funktionierenden Code und UI bewahren. (4) Windows-/Mobility-House-Simulatoren und echte private Lumina mit getrennten OCPP-IDs parallel testen, Start/Stop, Status, Reconnect, Transaktionen und Reports überprüfen. (5) Automatisches Neon→Microsoft 365 SharePoint-Backup funktionstüchtig machen und realen Restore üben; **separate nächste Funktion, kein Blocker für das reine Testen**.

**Wichtige technische Tatsachen bleiben:** GitHub Actions im privaten Repository war wegen **GitHub Billing** blockiert, **nicht** wegen Render Free. Der 7-USD-Render-Starter löst diese Sperre nicht. Der bisherige private Backup-Workflow lädt den Dump **unverschlüsselt** hoch; im Dev-Repo liegt bereits ein separater verschlüsselter AES-256-GCM-Upload-Prototyp mit simulierten/automatisierten Tests. Vor produktivem Kundenbetrieb später eine echte Sicherheits- und Betriebsabnahme durchführen; im heutigen Testbetrieb Fortschritt nicht unnötig aufhalten.

**GitHub-Repositories:** `ChargeVisor-Business-Dev` öffentlich = neueste Entwicklung/CI; `ChargeVisor-Business` privat = bestehender Render-Service, Auto-Deploy auf `main`. Der Nutzer sagt ausdrücklich, dass ihm für den **Teststatus** die formale Einteilung öffentlich/privat nicht wichtig ist. Dennoch dürfen **keine Secrets, echte personenbezogene Daten oder Dumps** in ein öffentliches Repo gelangen; das private Render-Repo bleibt zum kontrollierten Deployment relevant. Neon bleibt Free. Render Starter ist bereits bezahlt/aktiviert. **Keine zusätzlichen Kosten ohne Freigabe.**



## Release- und Backup-Prüfung vor dem nächsten Render-Deployment (23.11.2026, nach Starter-Upgrade)

**Benutzerwunsch:** Den aktuellen öffentlichen Dev-V1-Stand möglichst bald auf den bereits bezahlten Render-Starter-Service übernehmen, danach systematisch reale Enelion-Lumina und zusätzliche lokale OCPP-Simulatoren testen. **Bestätigtes Ziel, aber kein stillschweigender Direkt-Merge ohne Sicherung/Abnahme.**

**Direkt geprüfter Stand:**
- Render `chargevisor-business-demo` (Frankfurt) ist **Starter 0,5 CPU/512 MB**, `live`; Quelle weiterhin **privates** `mawosned/ChargeVisor-Business/main`, Commit `0711389a00ccebc359ac53158602376b82f4255c`, Auto-Deploy bei Änderungen auf privatem `main`.
- Die neueste öffentliche Dev-Version `mawosned/ChargeVisor-Business-Dev/main`, zuletzt geprüfter Commit `4e7550b9bc70c2687a90be9da2fc3aa7f242ed75`, hatte **sechs erfolgreiche CI-Workflows** auf genau diesem Commit. Dazu gehören Simulator-/OCPP-/WEG-/Backend- und **isolierte** Testdaten-Backup-/Restore-Tests. Nicht mit produktivem Backup oder Live-Hardwareabnahme verwechseln.
- Die zentrale Datei `backend/schema.sql` ist nach Blob-SHA identisch in Dev und privat. Geprüfte Frontend-Dateien `app-live.js`, `app.html`, `app.js`, `index.html`, `login.html`, `login.js`, `styles.css`, `portal-language.js`, `exports.js` stimmen ebenfalls überein. Die übrigen fünf Assets muss die existierende Release-Automatik weiterhin vollständig auf identische Git-Hashes prüfen.
- Neon `chargevisor-business` (PG18, Free) enthält bereits reale/angelegte Stationen, OCPP-Protokolle und Ladevorgänge. Kein leerer Demo-Datensatz. Datenbank nicht löschen/zurücksetzen; bei Render-Neustart können WebSocket-Verbindungen kurz abreißen.
- Die bestehende Microsoft-365-SharePoint-Site `ChargeVisorBackups` und der Ordner `Database-Backups` sind abrufbar; **Ordner weiterhin leer**. Ein erfolgreiches Produktiv-Backup ist **nicht** nachgewiesen. Die bisherigen privaten GitHub-Actions-Tests sind weiter vor Ausführung blockiert (`Usage blocked` / Billing), **nicht** durch Render Free. Das Upgrade auf Render Starter repariert GitHub-Actions-Abrechnung **nicht**.
- **Besonders wichtig:** `mawosned/ChargeVisor-Business/.github/workflows/neon-sharepoint-backup.yml` verwendet derzeit `pg_dump` und `scripts/neon_sharepoint_backup.py` ohne Verschlüsselung **vor** dem SharePoint-Upload. Diesen Workflow **nicht** mit Kundendaten aktivieren, bevor ein verschlüsseltes Verfahren freigegeben/integriert ist. Die sichere AES-256-GCM-Lösung inklusive SharePoint-Uploader liegt bereits im Dev-Repo unter `scripts/ops/`; ihre Offline-CI ist erfolgreich, ein realer App-only-Upload und Restore stehen noch aus.
- Der echte Enelion-Lumina-Ladepunkt `Lumina Garage / Stellplatz 1` wurde nach Nutzerangabe bereits erfolgreich real betrieben. Keine Änderung an dessen OCPP-ID, Passwort, Zuordnung, RFID oder Live-Umgebung durch einen Simulator.
- **Simulatorstart auf Windows bestätigt:** Das rekursive Suchen und Starten einer einzigen `START-SIMULATOR.cmd` hat die funktionierende GUI wieder geöffnet. Der zuvor versuchte Updater-Austausch ist fehlgeschlagen; keine aktualisierte lokale Version behaupten. Nur eigene, nicht abrechnende Teststation mit OCPP-ID verwenden. Zuerst 5-Minuten-Test und lokale Berichte, dann längere Laufzeit und Geräte-Reconnect.

**Sichere, priorisierte Fortsetzung:**
1. Unabhängiges echtes **verschlüsseltes Neon-18-Vollbackup nach SharePoint** etablieren, verschlüsselte Datei wieder herunterladen und in isolierter Testdatenbank tatsächlich restaurieren. Backup-Key sicher und getrennt verwahren; kein Kundendump im öffentlichen Repository. GitHub-Actions-Billing im privaten Repo oder alternativ genehmigten zuverlässigen Scheduler lösen. Bestehenden **unverschlüsselten** Workflow nicht starten.
2. Parallel auf dem **bestehenden privaten Render-Starter-Code** die bereits funktionierende lokale Simulator-GUI mit **getrennter Teststation** verbinden und OCPP Boot/Heartbeat/RFID/Start/Meter/Stop/Reconnect + 5-Minuten-Bericht prüfen. Echte Lumina beobachten, nicht als Teststation benutzen.
3. Sobald Backup/Restore funktioniert: `scripts/ops/prepare-private-release.ps1` aus dem Dev-Repo als **Draft-Release-PR** verwenden. Er prüft alle sechs CI-Läufe, 14 Frontend-Dateien und legt einen privaten Backup-Branch an. Nicht automatisch in privaten `main` mergen. Insbesondere den alten Backup-Workflow im privaten Repo vor dem Release separat auf sichere Verschlüsselung überprüfen/ersetzen.
4. Neues Backend erst nach konkreter Freigabe in einem vereinbarten Zeitfenster auf den privaten Render-Service deployen; währenddessen darf keine reale Ladung unbeaufsichtigt laufen. Danach Reconnect der Lumina, sämtliche Standorte, Transaktionen, Rollen, RFID und CSV/PDF-Auswertungen prüfen. Bei Problemen über vorbereiteten Application-Rollback zurückgehen, **ohne** die Kundendatenbank zurückzusetzen.

**Was bisher NICHT getan wurde:** kein aktueller Dev-Code nach Render deployed, kein produktives Backup, kein Restore mit realem Neon-18-Dump, kein 5-Minuten-Livetest des lokalen Simulators von hier aus, keine kostenpflichtigen Änderungen. Alle Aussagen zu erfolgreichen Tests beziehen sich auf tatsächlich grüne CI mit isolierten Testdaten.



## Render Starter – tatsächlich aktiviert und geprüft (23.11.2026, ca. 16:00 Uhr MEZ)

**VERIFIZIERTER IST-STAND (Render-Service-API und Deploy-Historie, nicht nur Nutzerangabe):**

- **Web-Service:** `chargevisor-business-demo`, Service-ID `srv-dbtk66942hec738takjg`, Region **Frankfurt**, Node.js, URL `https://chargevisor-business-demo.onrender.com`.
- **Tatsächlich gebuchter Instanztyp:** `0.5c-512mb` = **Render Starter**, 0,5 CPU / 512 MB RAM. Der Nutzer hat den **7-USD/Monat-Tarif selbst aktiviert**. Der Anbieter bestätigt den Instanztyp; eine Prüfung der Kreditkarten- oder Rechnungsdaten war und ist nicht erforderlich. **Es ist NICHT mehr Render Free**. Der gesamte Workspace-Tarif wurde bei dieser Prüfung nicht erneut ausgelesen; frühere Angabe war Hobby.
- **Letzter Deploy:** `dep-dc259pg8v5cc73eitupg`, ausgelöst durch `service_updated` beim Upgrade, **Status `live`**, beendet `2026-11-23T15:00:44Z` (16:00:44 MEZ). **Laufender Code-Commit:** `0711389a00ccebc359ac53158602376b82f4255c` im privaten GitHub-Repository `mawosned/ChargeVisor-Business`. Das Upgrade hat den bisherigen privaten Stand neu ausgerollt, **nicht** den neuesten Code aus dem öffentlichen Dev-Repo.
- **Render-GitHub-Konfiguration unverändert:** Privates Repo, Branch `main`, `autoDeploy=yes`; Nutzer möchte seine bisherige Release-Freigabepraxis unverändert. **Keine ungefragten Commits auf privatem `main`** oder Render-Plan-/Billing-/Einstellungsänderungen. Dokumentationsänderungen des privaten Repos ausschließlich im bestehenden Draft-PR #14 bis zur Freigabe.
- **Nächster Entwicklungsweg unverändert:** Öffentliches `mawosned/ChargeVisor-Business-Dev` für alle Entwicklung, Simulationen und automatisierten Tests; geprüfte Dev-Version erst nach fachlicher Abnahme und ausdrücklicher Freigabe kontrolliert in den privaten Render-Stand übernehmen.
- **Neon bleibt bewusst kostenlos (Free)**, eigenes ChargeVisor-PG18-Projekt. Falls dessen Grenzen später erreicht werden, erst dann Optionen Neon Upgrade / vollständiger Wechsel zu Render PostgreSQL prüfen; **keine aktuelle Migration, kein Datenbank-Tarifwechsel**.
- **Produktionsfreigabe steht noch aus:** Starter bietet einen kontinuierlich laufenden Web-Service ohne das Free-Inaktivitätsschlafen, aber keine automatische Hochverfügbarkeit. Reale Enelion Lumina und Windows-/Mobility-House-Simulator mit getrennten Identitäten für WebSocket-Reconnect, Last/Heartbeat, laufende Transaktionen, Ausfälle und Recovery testen. Backup-/SharePoint-Upload, separater Restore, Monitoring/Alarme und kontrollierte Releases bleiben erforderlich. Der Status `live` belegt noch keinen erfolgreichen OCPP-24/7-Test mit Hardware.
- **Kosten:** Es wurde **hier** keine Zahlung, Tarifänderung oder andere kostenpflichtige Aktion durch den Assistenten durchgeführt. Der Nutzer hat den Starter-Service selbst umgestellt. Keine weiteren kostenpflichtigen Änderungen ohne gesonderte Freigabe.

**Bisherige Passagen zur *geplanten* Starter-Umstellung sind historisch und durch diesen jetzt bestätigten Status überholt. Die oben genannten Echtzeit-Service-Daten haben Vorrang.**



## Render Starter – Hostingentscheidung für ChargeVisor (23.11.2026)

**Entscheidung nach Vergleich Render/Hetzner:** Wir bleiben für die aktuelle Pilot- und Aufbauphase bei **Render**. Render ist eine echte, langfristig nutzbare Hostingplattform und nicht nur für Entwicklung gedacht. **Ein Umzug zu Hetzner ist NICHT erforderlich oder beschlossen.** Hetzner kann später erneut geprüft werden, falls reale Betriebskosten, Skalierung, Verwaltungsaufwand oder spezifische Anforderungen das sinnvoll machen. Kein vorsorglicher Plattformwechsel.

- **Geplanter Einstieg:** Bestehenden Web-Service `chargevisor-business-demo` in der Region **Frankfurt** später von **Render Free** auf den kleinsten für den Pilot geeigneten **kostenpflichtigen Render Starter Web Service** umstellen. Zum Gesprächszeitpunkt genannter Richtpreis ca. **7 USD/Monat** für Starter (0,5 CPU / 512 MB RAM; Anbieterpreis und erforderliche Leistung vor Buchung neu prüfen). Das ist **keine bestätigte Buchung** und keine Zusage, dass 512 MB für jede Last ausreichen. Der Nutzer möchte den kostenpflichtigen Tarif selbst auswählen; **keine Zahlung, Tarifumstellung oder Abrechnungsaktion durch den Assistenten ohne neue konkrete Freigabe**.
- **Workspace-Kosten klein halten:** Zunächst vorhandenen kostenfreien **Hobby-Workspace** verwenden; kein Upgrade auf Render Pro/Team nur für den Pilot voraussetzen, soweit der konkrete Dienst im bestehenden Workspace betrieben werden kann.
- **Was Starter leistet:** Dauerhaft gestarteter Web-Service ohne das Free-Inaktivitätsschlafen; HTTPS/TLS, GitHub-Integration und OCPP-1.6J-`wss://`-Verbindungen sind grundsätzlich möglich. Render ist grundsätzlich auch für mehrjährigen Kundenbetrieb geeignet. **Nicht** behaupten, dass ein einzelner Starter-Service automatisch hochverfügbar ist oder eine vereinbarte Verfügbarkeitsgarantie bietet. Ein einzelner Service ist ein Single Point of Failure.
- **OCPP-Betriebsrisiken:** Deployments, Service-Neustarts oder Störungen können bestehende WebSocket-Verbindungen trennen. Jede echte Wallbox muss selbsttätig reconnecten, ohne laufende Transaktionen oder Messdaten falsch abzuschließen. Tests: reale Enelion Lumina, getrennte Windows-/Mobility-House-Simulatoren, Serverneustart, länger offline, Start/Stop, MeterValues, RFID, Datenintegrität und Alarmschwellen; Monitoring und externe Backup-/Restore-Nachweise bleiben Pflicht.
- **Neon bleibt ausdrücklich FREE:** Das separate Projekt `chargevisor-business` (PostgreSQL 18) zunächst kostenlos weiterverwenden und Limits, Verfügbarkeit und Last messen. Nicht gleichzeitig kostenpflichtig umstellen. Bei Problemen später entweder Neon-Upgrade oder **vollständige Migration der Datenbank zu Render PostgreSQL** prüfen; keine Entscheidung vorwegnehmen. Die kurze PITR-Historie bei Neon Free und bislang nicht aktivierte echte SharePoint-Backups bleiben ein offenes **Produktionsrisiko**, das vor zahlenden WEG-Kunden gelöst werden muss.
- **Bestehenden privaten Render-Stand schützen:** Öffentliches `ChargeVisor-Business-Dev` ist die aktuelle Entwicklungs-/Testumgebung; privates `ChargeVisor-Business` ist mit dem bestehenden Render-Service verbunden. **Nicht automatisch Dev-Code deployen.** Erst vollständige Tests und Benutzerfreigabe, dann kontrollierter Release auf privaten `main`. Die vom Nutzer ausdrücklich akzeptierte bisherige Render-Deploy-/Freigabepraxis nicht eigenmächtig umkonfigurieren. Technisch ist `autoDeploy=yes` am privaten `main` aktiv; deshalb auch **keine reinen Dokumentationscommits auf privaten `main` ohne Freigabe**.
- **Nächste fachliche Schritte:** Simulator und echte Lumina parallel mit getrennten OCPP-IDs betreiben, Verhalten bei Reconnect und aktiver Ladung prüfen, CPU/RAM-Verbrauch und WSS-Stabilität messen, extern verschlüsselte Datenbank-Backups/Restore und unabhängige Alarme abnehmen. Erst dann produktiven Betrieb mit zahlenden Kunden freigeben. Ein kostenpflichtiger Starter allein erfüllt diese Kriterien **nicht**.

**Status bei Dokumentation:** Hostingentscheidung dokumentiert, **kein** Tarif gebucht, **kein** Service verändert, **kein** Deployment ausgelöst. Preis/Leistungsangaben sind Momentaufnahme und vor Kauf erneut zu prüfen.



## Bestätigter Windows-Simulator-Start – 23.11.2026 (aktuell)

**Ergebnis nach fehlgeschlagenem Updater-Versuch: DER BESTEHENDE SIMULATOR STARTET WIEDER.** Der Nutzer hat bestätigt, dass nach Ausführung des folgenden PowerShell-Blocks die vorhandene Windows-Simulator-Oberfläche wieder funktioniert. Das belegt den **lokalen GUI-Start**, aber noch keinen neuen Download, keine aktuelle Versionsnummer, keine aktive OCPP-Verbindung und keinen erfolgreichen Lade-/End-to-End-Test.

**Ab sofort zuerst diesen funktionierenden Startweg nutzen – ohne automatisches Update:**

~~~powershell
$root = 'C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests'

$starts = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'START-SIMULATOR.cmd' |
    Where-Object { $_.FullName -notmatch '\\backup-\d' })

if ($starts.Count -eq 1) {
    Start-Process -FilePath $starts[0].FullName -WorkingDirectory $starts[0].DirectoryName
}
else {
    $starts | Select-Object -ExpandProperty FullName
    Write-Host "Gefundene Simulator-Starts: $($starts.Count)"
}
~~~

**Warum das funktioniert:** Der Block sucht die reale Startdatei rekursiv, statt eine vermutete Ordnerstruktur vorauszusetzen. Nur bei **genau einem** Treffer wird die GUI gestartet; andernfalls erscheinen die gefundenen Pfade/Anzahl. Er lädt nichts herunter, ersetzt keine Dateien, ändert kein GitHub/Render/Neon und unterbricht nicht die echte Lumina. Für eine neue Unterhaltung diesen Block als **letzten bestätigten funktionierenden Start** bevorzugen.

**Gescheiterter Einmalversuch davor (keine Reparatur behaupten):** Ein vorheriger PowerShell-Block ging irrtümlich von einem festen Ort für `UPDATE-SIMULATOR.ps1` unter `tools\ocpp-chain-simulator` aus. Die Benutzerkonsole zeigte `Copy-Item: Pfad nicht vorhanden` und `WriteAllBytes: Ein Teil des Pfades konnte nicht gefunden werden`. Die abschließende Ausgabe `Neuer DEV-Updater installiert` war nur eine irreführende `Write-Host`-Zeile; tatsächlich wurde **kein erfolgreicher Austausch des Updaters** bestätigt. Der genaue Installationspfad/Updater-Stand auf Windows wurde nicht aus der Ferne verifiziert. Einen neuen Update-Versuch **nicht zur Voraussetzung des Simulator-Starts machen**. Falls später nötig: erst vorhandene Datei(en) lokalisieren, exakte `$repo`-Quelle prüfen, funktionierende Installation sichern und danach gezielt aktualisieren – nicht blind überschreiben.

**Nächste Tests, sobald die GUI läuft:** Eine separate, nicht abrechnungsrelevante Teststation/OCPP-ID und eigenes Passwort einsetzen (niemals Zugangsdaten/Identität der echten Lumina). Verbinden → Boot/Heartbeat/Status → RFID/Authorize → StartTransaction/MeterValues/StopTransaction → Störung/Reconnect. Dann 5-Minuten-Rauchtest, später Dauertest mit lokalem Ergebnisbericht. Der neue Kettensimulator kann künstliche Sessions wie reale Transaktionen speichern; deshalb Testmandant/Teststation klar abgrenzen und die Trennung in Historie/Reports prüfen.

**Reale Enelion Lumina erhalten:** `Lumina Garage / Stellplatz 1` ist laut Nutzer echte bereits erfolgreich ladende Hardware; nicht als Simulator einsetzen, nicht neu provisionieren, nicht unterbrechen. Öffentliche Entwicklung `ChargeVisor-Business-Dev` und privater Render-Stand `ChargeVisor-Business` bleiben getrennt; Neon Free und bestehende Render-Freigabe bleiben unverändert. Keine finanzielle Änderung oder privater Deploy ohne Benutzerfreigabe.



## Windows-Simulator: geprüfte Updatequelle und gewohnter PowerShell-Start (23.11.2026)

**Konkreter lokaler Benutzerpfad** (nur Dokumentation, kein Zugriff auf diesen PC):
`C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests`

**Bisheriger Startweg des Nutzers** (der Updater wird rekursiv gesucht, Sicherungsordner `backup-<Zahl>` ausgenommen):

```powershell
$root = 'C:\1_WORKPLACE\1.1_EV\1_WALECTRA\ChargeVisor\NEU\ChargeVisor-Business-feature-mobilityhouse-ocpp-chain-tests'

$updater = Get-ChildItem -LiteralPath $root -Recurse -File -Filter UPDATE-SIMULATOR.ps1 |
    Where-Object { $_.FullName -notmatch '\\backup-\d' } |
    Select-Object -First 1

if (!$updater) { throw 'Updater nicht gefunden' }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updater.FullName
```

**Achtung, dieses alte Verfahren kann die FALSCHE VERSION laden.** Am 23.11.2026 wurde der Quellcode beider Updater ausdrücklich verglichen:
- Im **alten privaten** Branch `mawosned/ChargeVisor-Business` / `feature/mobilityhouse-ocpp-chain-tests` enthält `tools/ocpp-chain-simulator/UPDATE-SIMULATOR.ps1` tatsächlich `$repo = 'mawosned/ChargeVisor-Business'`. Der alte Updater lädt damit weitere Dateien aus der **alten privaten Feature-Version**, nicht automatisch den heutigen Entwicklungsstand.
- In der **aktuellen öffentlichen Entwicklung** `mawosned/ChargeVisor-Business-Dev` / `main` ist die gleichnamige Datei korrekt auf `$repo = 'mawosned/ChargeVisor-Business-Dev'` und `param([string]$Branch = 'main')` eingestellt.
- **Beide Updater aktualisieren ihre eigene Datei `UPDATE-SIMULATOR.ps1` nicht** (sie fehlt in ihrer `$files`-Liste). Wer einmal den alten Updater auf dem PC liegen hat, landet durch bloßes wiederholtes Ausführen nicht automatisch bei der neuen öffentlichen Version.
- Der genaue lokale Inhalt ist **noch nicht geprüft**, da keine Verbindung zum Windows-Dateisystem vorliegt. Der Ordnername weist auf die alte Feature-ZIP hin, beweist aber nicht, welche Datei der Nutzer heute tatsächlich dort liegen hat.

**Sicherer Einmalschritt:** Zuerst den lokalen Updater aus dem angegebenen Ordner ermitteln, die Zeile `$repo = ...` anzeigen und vor einem Update eine Kopie der vorhandenen Datei anlegen. Falls sie noch auf `ChargeVisor-Business` zeigt, die **einzelne Updater-Datei** gezielt aus `https://github.com/mawosned/ChargeVisor-Business-Dev/blob/main/tools/ocpp-chain-simulator/UPDATE-SIMULATOR.ps1` beziehen, Inhalt auf `ChargeVisor-Business-Dev` + `main` kontrollieren und anschließend den gewohnten PowerShell-Aufruf wiederholen. Kein pauschales Überschreiben des gesamten Arbeitsordners. Nicht unkritisch den ersten Treffer nehmen, wenn mehrere aktive Updater gefunden werden. GitHub-CLI- und Python-Voraussetzungen des neuen Updaters beachten.

**Bewährter Schnellstart nach korrekter Aktualisierung:** Eine eigens erstellte, **nicht real genutzte** OCPP-Teststation (eigene WSS-URL, eigene Charge-Point-ID und eigenes Basic-Auth-Passwort) verwenden, niemals die echte Lumina-Identität oder ihre Zugangsdaten. `START-SIMULATOR.cmd` im `tools/ocpp-chain-simulator`-Ordner startet die vorhandene GUI. Die GUI kann Master + bis zu 20 Connectoren, Laden/Stoppen, Fehler, RFID, Reconnect und 5- bzw. 120-Minuten-Dauertests simulieren.

**Wichtiger Isolationsunterschied:** Der **erweiterte Windows-Ketten-Simulator** arbeitet laut seiner eigenen aktuellen README mit einer als `normale` OCPP-Hardware angelegten **TEST-Station**, nicht zwingend mit `is_simulator=true`. Seine Testtransaktionen können dadurch wie reale Ladevorgänge aussehen und in Auswertungen eingehen. Deshalb ausschließlich in einem klar getrennten Testmandanten/Testsystem ohne reale Abrechnung betreiben, bis die Trennung code- und datenbankseitig nachweisbar ist. Der **separate, ältere `scripts/ocpp-test-wallbox.py`** dagegen sieht eine explizit virtuelle Teststation und `simulated=true` vor. Nicht beide Szenarien vermischen.

**Reale Referenz-Hardware beibehalten:** Im bisherigen ChargeVisor-Backend ist eine **echte** Enelion Lumina eingerichtet (Screenshot: `Lumina Garage`, `Stellplatz 1`, Master Connector 1, `Bereit`); laut Nutzer war sie bereits angeschlossen und hat tatsächlich erfolgreich geladen. Kein Simulator. Nicht löschen, nicht neu provisionieren, nicht auf eine Simulator-ID umstellen. Weitere echte Wallboxen nur mit eigenen OCPP-Zugangsdaten anschließen.

**Architektur- und Freigabestand:** `ChargeVisor-Business-Dev` öffentlich = Weiterentwicklung/Tests (öffentlich wegen früherer GitHub-Actions-Abrechnungssperre des privaten Repo). `ChargeVisor-Business` privat = Render-gebundener, bestehender Stand. Neon Free zunächst behalten, ggf. später zu Render PostgreSQL wechseln, falls sinnvoll. Render-Einstellungen bleiben wie vom Nutzer gewünscht; **kein ungefragter privater `main`-Push/Deploy**. Erst Simulator-/CI-/Hardwaretests und Freigabe, dann kontrolliert übernehmen.

**Aktualisierter nächster Schritt beim nächsten Chat:** Der Simulator startet wieder mit dem oben dokumentierten **START-SIMULATOR.cmd-Suchbefehl**. Den Updater nicht als Voraussetzung behandeln. Zuerst GUI und getrennte Teststation kontrollieren; danach 5-Minuten-Rauchtest und längeren Dauertest durchführen. Eine spätere Updater-Korrektur setzt die Prüfung des tatsächlichen lokalen Pfads und eine Sicherung voraus. Ergebnisse und echte Hardwarezustände strikt getrennt kontrollieren. Testerfolg erst nach Log/Screenshot oder tatsächlichem Live-Nachweis markieren.



## Reale Enelion Lumina bereits verbunden – Hardware-Referenz (23.11.2026)

**Verifizierte Benutzerinformation und Screenshot, keine neue Live-Abfrage:** Im bestehenden **privaten** ChargeVisor-Backend ist bereits eine **echte physische Enelion Lumina** eingerichtet. Der Nutzer bestätigt ausdrücklich, dass diese Wallbox **bereits erfolgreich verbunden war und real geladen hat**. Der Screenshot aus `Standorte & Ladepunkte` zeigt die Station **„Lumina Garage“** mit einem Ladepunkt **„Stellplatz 1“**, OCPP **Connector #1 · Master**, Status **„Bereit“**, **0 kW** zum Zeitpunkt des Screenshots. **Die Statusanzeige zeigt keinen aktuellen Ladevorgang; erfolgreiche frühere reale Ladevorgänge sind Nutzerangabe, kein hier neu ausgeführter Hardwaretest.** Keine OCPP-Identität, Passwörter, RFID-Daten oder personenbezogene Nutzerinformationen in einem öffentlichen README ablegen.

- **WICHTIG:** Diese Lumina ist **keine Simulation** und darf niemals versehentlich zu `is_simulator=true` konvertiert, gelöscht, ersetzt, neu provisioniert oder als Simulator-OCPP-Identität genutzt werden. Ihre bestehende OCPP-Verbindung und die erfolgreiche Ladefunktion dürfen durch neue Tests nicht unterbrochen werden.
- **Der richtige nächste Entwicklungsschritt ist ein Mischbetrieb:** (1) vorhandene reale Lumina erhalten und ihre realen OCPP-Ereignisse/abgeschlossenen Ladevorgänge kontrolliert prüfen; (2) zusätzliche physische Wallboxen jeweils mit **eigenem** OCPP-Profil/Connector-Mapping verbinden; (3) externe OCPP-Simulatoren parallel mit **eigenen, eindeutig getrennten Test-Identitäten** starten.
- **Schnellstart manuelles Testgerät:** Das bereits vorhandene Python-Bedienfeld `scripts/ocpp-test-wallbox.py` (Dokumentation: `docs/mobilityhouse-simulator.md`) kann lokal mit `python scripts/ocpp-test-wallbox.py --port 8765` gestartet werden, nachdem seine Abhängigkeiten installiert sind. Für getrennte virtuelle Test-IDs weitere eigene Prozesse/Ports. Die Teststation in ChargeVisor **ausdrücklich als virtuelle Test-Wallbox kennzeichnen**, nur Testnutzer/-RFID nutzen; Testtransaktionen müssen `simulated=true` bleiben und dürfen nicht in Abrechnung auftauchen.
- **Erweiterter Windows-Simulator:** `tools/ocpp-chain-simulator/START-SIMULATOR.cmd` startet das bereits vorhandene GUI für **eine OCPP-Master-ID mit bis zu 20 Connectoren**, Status, Laden/Stop, Fehler, Reconnect und Dauertests (siehe `tools/ocpp-chain-simulator/README.md`). **Achtung – anderes Datenmodell:** Die dortige aktuelle Anleitung verlangt eine als **normale physische Station** angelegte Test-ID und warnt ausdrücklich, dass ihre künstlichen Ladevorgänge **nicht automatisch von realen Ladevorgängen unterscheidbar** sind. Daher diesen Simulator **nicht** mit der realen Lumina-ID verwenden und bis zur überprüften Testdatenisolation nur in einer eigens getrennten Testanlage/Testmandanten bzw. isolierten Testumgebung verwenden, **niemals** für abrechnende echte Kunden. Vor dauerhaften Mischtests die Unterscheidung in Code, Datenbank und Berichten absichern und mit Tests belegen.
- **Keine Codebasis verwechseln:** Das aktuelle öffentliche Entwicklungsrepository enthält neuere Funktionen als das private, mit Render verbundene Repository. Eine bereits funktionierende reale Lumina im privaten Backend ist **kein Nachweis**, dass der neueste öffentliche Entwicklungs-Commit auf Render läuft. Bestehenden privaten Render-Service unverändert lassen; Dev-Code zuerst isoliert testen, später erst kontrolliert nach ausdrücklicher Freigabe deployen.
- **Nächster Testplan:** eigene virtuelle Testanlage anlegen, Simulator mit neuer WSS/OCPP-Test-ID verbinden, Heartbeat/Status → Authorize/RFID → StartTransaction → MeterValues → StopTransaction → Reconnect/Störung testen. Live-Status und Historie pro Connector sowie korrekte Abgrenzung von echten/virtuellen Vorgängen prüfen. Danach **parallel** reale Lumina beobachten und weitere echte Hardware mit je eigener OCPP-ID/Connector-Zuordnung hinzufügen. Abschließend 24h-Dauertest auf einer unabhängigen Laufzeit und Hardwaretests (Netzausfall, Offline-RFID, Lastmanagement); keine Erfolgsbehauptung ohne tatsächlichen Nachweis.
- **Hostingentscheidungen bleiben:** Neon Free weiter nutzen; keine kostenpflichtige Änderung oder privater Render-Deploy ohne Freigabe. Das öffentliche Repo ist Entwicklungs-/Teststand, das private Repo enthält den momentan mit Render verbundenen älteren Stand.


## Verbindliche Entwicklungs- und Hostingentscheidung – 23.11.2026

**Diese Festlegung gilt für beide ChargeVisor-Repositories und ist bei jedem neuen Chat zuerst zu beachten. Sie korrigiert ältere allgemeine Upgrade-Empfehlungen.**

- **Neon bleibt vorerst kostenlos.** Wir nutzen für die separate ChargeVisor-Datenbank das bestehende Neon-Free-Projekt `chargevisor-business` (PostgreSQL 18) weiter und beobachten **reale Nutzungsgrenzen, Speicher, Verfügbarkeit, Wiederherstellungsfenster und Last**. **Kein vorsorgliches Neon-Upgrade und keine kostenpflichtigen Datenbankänderungen.** Wenn Neon Free nicht mehr ausreicht, prüfen wir **dann** die Optionen: ggf. Neon kostenpflichtig oder die **vollständige Datenbankmigration zu Render PostgreSQL**, sofern sinnvoll. Eine Migration ist eine **spätere Entscheidung**, kein bereits beschlossener Schritt. Produktions-Backups und unabhängige Restore-Tests bleiben trotzdem Pflicht.
- **Warum gibt es ein öffentliches und ein privates GitHub-Repository?** Beim privaten Repository `mawosned/ChargeVisor-Business` waren weitere GitHub-Actions-Tests durch die **Abrechnungs-/Budget-Sperre** blockiert. Deshalb wurde die separate Entwicklungskopie `mawosned/ChargeVisor-Business-Dev` **öffentlich** geführt, damit wir die dort ausführbaren Tests und die Weiterentwicklung ohne diesen Blocker fortsetzen können. **Das öffentliche Repo ist unser aktueller Arbeits- und Teststand.** Es darf **keine** echten Kundendaten, Passwörter, Tokens, DB-URLs, vollständige Datenbank-Dumps oder privaten Konfigurationswerte enthalten.
- **Rollen der Repositories:** `ChargeVisor-Business-Dev` = neue Backend-Funktionen, vorhandener Mobility-House-/Windows-Simulator, automatische OCPP-/Frontend-/Backup-/Restore-Tests, Fehlerkorrekturen und Dokumentation. `ChargeVisor-Business` = **privates Repository mit Verbindung zum bestehenden Render-Service**, aktuell **nicht** automatisch mit dem neuen Dev-Stand gleichzusetzen. Alles Bestehende bleibt erhalten; keine unaufgeforderten Refactorings, Löschungen oder ungeprüfte Übernahme.
- **Wann auf Render deployen?** **Erst wenn die öffentliche Entwicklung ausreichend fertig und nachweisbar durchgetestet ist** (CI, OCPP-Simulator, Mandanten/RFID/UI, Verschlüsselung/Backup/Restore, reale Hardwaretests soweit möglich). Dann wird der geprüfte Code **kontrolliert** ins private Repo übernommen und nach konkreter Freigabe auf Render deployed. **Nicht jetzt, kein automatischer Übertrag aus dem öffentlichen Dev-Repo.** Der Nutzer möchte den bestehenden Render-Deployment-/Freigabeablauf **nicht verändert** haben und gibt Releases selbst frei. Technisch ist beim privaten Render-Demo-Service `autoDeploy=yes` für privaten `main` aktiv; deshalb **keine ungefragten Commits auf privaten `main`**, auch nicht nur für Dokumentation.
- **Kosten:** Render für dauerhaft verfügbaren Betrieb ggf. kleinster geeigneter kostenpflichtiger Service **erst nach gesonderter Freigabe**. Neon **bleibt Free**, soweit es praktisch und sicher vertretbar ist. Kein Upgrade, keine Bezahlfunktion, kein Tarifwechsel und keine Migration ohne explizite Bestätigung.
- **Verbindlicher Startpunkt für künftige Assistenten:** Zuerst beide READMEs und `AGENTS.md`, die V1-Funktions-/Abnahmeliste sowie Backup-Runbooks lesen, den neuesten Dev-Commit und die tatsächlich grünen Tests prüfen und die Unterschiede zum privaten Render-Stand feststellen. Keine bereits erledigten Arbeiten erneut bauen; **immer im öffentlichen Dev-Repo weiterentwickeln** und erst am Ende freigegeben in privat/Render übertragen. Jede Änderung mit Commit, Testergebnis, offenen Punkten und nächstem Schritt dokumentieren.



> **ZUERST LESEN:** ChargeVisor Business ist ein vollständiges, eigenständiges OCPP-1.6J-Backend für Walectra (WEG/Firmenkunden), nicht nur die historische Browserdemo. Der aktive Entwicklungsstand und die funktionsfähigen CI-Tests liegen in diesem **öffentlichen Entwicklungsrepository**. Die nachfolgende alte Demo-Beschreibung bleibt ausschließlich als historischer Bezug bestehen.
>
> **Render-Freigabe ausdrücklich bestätigt:** Der Benutzer hat erklärt, dass der bisherige Render-Deployment-/Freigabeablauf **so bleiben soll**, weil er die Freigaben selbst steuert. **Keine Änderung an Render-Auto-Deploy-Einstellungen, Tarifen oder Produktivdiensten ohne erneuten ausdrücklichen Auftrag.** Technische Besonderheit: Die private Render-Demo ist mit `mawosned/ChargeVisor-Business` `main` verbunden und in Render ist `autoDeploy=yes` konfiguriert. Daher kann ein Commit auf privatem `main` tatsächlich einen Deploy auslösen. **Nicht ohne ausdrücklich freigegebenen Release auf private `main` schreiben.** Diese Unterscheidung ist verbindlich und darf nicht bei einem neuen Chat vergessen werden.
>
> **Verifizierter Dev-Referenzstand:** Commit `2ffdf095aac7cca57189585ff2271dd6b7ae70d9` – am 23.11.2026 **6/6 GitHub-Actions-Workflows grün**, darunter unabhängiger OCPP-Test, zehn Connectoren, Simulator, API/Frontend-Regression sowie **verschlüsseltes Backup und Restore einer isolierten PostgreSQL-16-Testdatenbank**. Das bedeutet **NICHT**, dass die echte Neon-18-Datenbank schon gesichert ist oder eine bezahlte WEG produktiv freigegeben ist.
>
> **Echte Infrastruktur (geprüft 23.11.2026):** Neon `chargevisor-business` auf PostgreSQL **18**, Free mit **6 Stunden PITR**; die Microsoft-365-SharePoint-Site `ChargeVisorBackups` mit Ordner `Database-Backups` ist erreichbar, aber noch **leer**. Der private GitHub-Backup-Workflow wurde vom Billing-System **vor dem Start** blockiert. Die Entra-App `ChargeVisor Backup` besitzt nach Einrichtung `Sites.Selected` + Site-`write`; ein erfolgreiches Upload steht aus.
>
> **Zielbetrieb vor Kundenstart:** Täglich verschlüsselte volle PostgreSQL-Backups nach SharePoint; zusätzlich zweimal wöchentlich verschlüsselte CSV-Snapshots abgeschlossener Nicht-Test-Ladevorgänge, getrennte Schlüsselverwaltung, echte Wiederherstellungsprobe, unabhängige Ausfallalarme und kontrollierter Release-/Rollback-Test. **CSV ersetzt keinen DB-Dump. Keine zusätzlichen Kosten ohne Benutzerfreigabe.**

## Maßgebliche Dokumente – nach jedem Arbeitsblock aktualisieren

- [Neue verschlüsselte Cloud-Backup- und Session-CSV-Implementierung (noch NICHT produktiv aktiviert)](docs/secure-sharepoint-archive-runbook.md) – verschlüsselter DB-Dump, 2×/Woche CSV, Microsoft Graph Upload und Tests\n- [Aktuelle Backup-, Microsoft-365-, Kosten- und Render-Freigabeentscheidung](docs/backup-operations-decision-2026-11-23.md) – **zuerst lesen**, insbesondere bei Weiterentwicklung von Backup oder Deployment
- [V1 Funktionsliste und offene Abnahmen](docs/v1-feature-implementation-and-gaps.md) – Code, CI und Hardware-Pilot strikt unterscheiden
- [Betriebs-, Backup-, Monitoring- und Restore-Runbook](docs/v1-production-readiness-runbook.md) – bereits getestete Wiederherstellungslogik; Produktivaktivierung offen
- [Verbindliche Entwicklungsregeln](AGENTS.md) – keine Funktionen entfernen, Tests/Freigaben vor Übernahme
- [Unabhängiger OCPP-Simulator](tools/ocpp-chain-simulator/README.md) und [Mobility-House-Simulator](docs/mobilityhouse-simulator.md) – vorhandene Simulatoren erhalten, nicht neu bauen

**Fortsetzung im nächsten Chat:** Beide Repositories lesen (`ChargeVisor-Business-Dev` und `ChargeVisor-Business`), diese README, `AGENTS.md`, das Runbook und die aktuelle Funktionsliste prüfen, Commit/CI/Render-Status abgleichen. Keine vorhandene Funktion überschreiben, keine stille Übernahme in den privaten Live-Branch. Erst dann beim neuesten offenen Punkt ansetzen.

---

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

