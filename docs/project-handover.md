# ChargeVisor Business – Projektübergabe (öffentlich)

Stand 25.11.2026. Verbindlicher neuer Arbeitsort: dieses Repository. Keine Produktionsgeheimnisse, Kundendaten oder vertraulichen privaten Betriebsprotokolle hier speichern.

## Konsolidierung auf ein aktives Repository – 25.11.2026

**Neue verbindliche Nutzerentscheidung:** Dieses öffentliche Repository `mawosned/ChargeVisor-Business-Dev` ist das einzige Ziel für weitere Entwicklung, Tests, Dokumentation und – nach Umstellung der Render-Quelle – Releases. Später soll es privat gestellt werden. Das bisherige private Repository bleibt als unveränderter Rückfall-/Historienstand erhalten, nicht als zweite aktive Entwicklungsquelle.

**Tatsächlicher Status vor Render-Umstellung:** Der bestehende Dienst ist noch mit dem früheren privaten Repository verbunden. Sein aktuell bestätigter Live-Stand entspricht hinsichtlich sämtlicher Web-App-, Backend-, Schema-, Asset- und Paketdateien dem öffentlichen main-Stand `18ad2b0daae0dccf94a1c22863d7fdeed5d15b00`. Vollständiger Vergleich der Git-Dateibäume: 132 identische Dateien; übrige Unterschiede sind Dokumentation, CI, alte Backup-Hilfsdateien und die bereits weiterentwickelte Windows-Simulator-Version im öffentlichen Repo. Diese Simulator-Version bleibt erhalten. Rückfallbranch `backup/pre-single-repo-20261125` sichert den öffentlichen Ausgangsstand. Keine Änderung an Laufzeitcode, DB, Domain, Hardware, Render-Konfiguration oder BLITZ durch diese Dokumentationsänderung.

**Umstellung noch offen:** Im bestehenden Render-Service nur Build > Source auf dieses GitHub-Repo, Branch main, Node, npm install / npm start ändern. GitHub-Integration verwenden; keine neue Instanz und keine Änderung von Umgebungsvariablen, Region, Tarif, Domain oder Datenbank. Erst nach verifiziertem Live-Deploy, Datenvergleich und Funktionsprüfung ist der Wechsel abgeschlossen. Alte private Quelle bis dahin nicht löschen/archivieren. Danach alle Codeänderungen ausschließlich hier über Feature-Branches/PR, CI und freigegebenen Merge nach main. Keine manuelle Kopie zwischen Repositories mehr. Reine Doku möglichst ohne unnötiges Produktivdeployment.

**Letzte freigegebene Funktionen:** 24.11. Admin-Nutzeranlage und RFID direkt in der Nutzerliste (keine Premium-Pflicht), Portal-Einladung separat Premium, Rollenvorschau schreibgeschützt; Premium-Aktionen mit einheitlichem türkis-grünem Verlauf und weißem Stern; Favicon/Apple Touch Icon/PWA-Icons, vorhandenes Schriftlogo unverändert. Icon-Release DEV PR #20: 96/96 Node, 13/13 Chromium, 6/6 CI; vorher auf bisherigem Render-Dienst live bestätigt.

**Noch nicht produktiv:** DEV PR #21 (Datumsfilter / Fernstart-Rollenlabel) hat beim zuletzt abgefragten Stand alle sechs CI-Workflows bestanden, wurde aber nicht gemergt/deployed. Nicht mit dem reinen Repository-Wechsel vermischen.

**Backups:** Der alte unverschlüsselte produktive Backup-Workflow wird bewusst nicht in das öffentliche Repo übernommen oder aktiviert. Die bereits vorhandene sichere verschlüsselte Archiv-Implementierung und Runbooks bleiben erhalten; echter Backup-Upload und Restore sind noch nicht nachgewiesen. Keine Produktionssecrets, personenbezogenen Daten, internen Logs oder vertraulichen privaten Übergabedetails in öffentliche Git-Dateien übernehmen. Die spätere Sichtbarkeitsänderung macht frühere Kopien nicht rückgängig.

Aktuelle Übergabe: [docs/START-NEW-CHAT.md](docs/START-NEW-CHAT.md) und [docs/project-handover.md](docs/project-handover.md). Ältere Aussagen zum Zwei-Repo-Prozess sind historische Einträge, keine neue Arbeitsanweisung.


## Funktionsbestand und Grenzen

- Mehrmandantenfähiges OCPP-1.6J-CSMS für Firmen und WEGs. Superadmin richtet Mandanten/Stationen ein; Admin verwaltet eigene Nutzer, RFID und Zuordnungen; Nutzer sehen zugewiesene Ladepunkte. Rollen/Preview-Grenzen erhalten.
- Bestehende Lumina-Bilder, Statusanimationen, Übersicht, Master/Slave und Connector-Zuordnung, getrennte RFID- und Premium-Logik, Ladehistorie und CSV/Excel/PDF, Diagnose und 12-Sekunden-DOM-Update erhalten.
- Fernstart-/Resume-/Stop-Logik und alle Zugriffsprüfungen beibehalten. Aktueller freigegebener Stand enthält keine neue Fernstart-Rollenkennzeichnung aus PR #21.
- Öffentliches Repository besitzt neuere Windows-Simulator-Reconnect- und Soak-Tests. Diese nicht durch ältere private Simulator-Dateien ersetzen. Simulierte normale Transaktionen absichtlich nicht umklassifizieren; separaten Testnutzer/RFID verwenden.
- Offene Aufgaben: nach Quellenumstellung Live-Funktionsprüfung (Admin/RFID/Icons/History/Exporte/WSS), separater Sessionfilter-Fix, echte Wallbox-Ladeprofil-Diagnose, Reconnect-/Langzeitstabilität, verschlüsseltes Backup und produktiver Restore. Keine Erfolgsbehauptungen ohne Nachweis.

## Technische Dokumentation
- [Simulator](../tools/ocpp-chain-simulator/README.md)
- [Sicheres Archiv](secure-sharepoint-archive-runbook.md)
- [Backup-Entscheidungen](backup-operations-decision-2026-11-23.md) (historisch; aktuelle Quelle gemäß README)
- [Start eines neuen Chats](START-NEW-CHAT.md)

Betriebsspezifische Zugangsdaten ausschließlich in genehmigten Secret-Stores. Bestehende alte private Dokumentation wird nicht pauschal veröffentlicht.
