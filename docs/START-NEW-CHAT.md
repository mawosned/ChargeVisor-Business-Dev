# ChargeVisor Business – Start eines neuen Chats

Stand: 25.11.2026. Dieses Dokument enthält ausschließlich für das öffentliche Repository geeignete Projektinformationen.

## Kopier-Prompt

Wir entwickeln ChargeVisor Business für Walectra, nicht BLITZ. Nutze ausschließlich das öffentliche GitHub-Repository `mawosned/ChargeVisor-Business-Dev` für neue Entwicklung. Lies vollständig README.md, AGENTS.md, docs/START-NEW-CHAT.md und docs/project-handover.md, dann relevante Quellcode-Dateien und Runbooks. Prüfe tatsächlichen GitHub-main-Stand, CI und bestehenden Render-Service. Die Migration zur einzigen aktiven Repo-Quelle ist vorbereitet, aber Render war bei letzter Prüfung noch an die frühere private Quelle gebunden. Behaupte erst nach nachgewiesener Quellenumstellung und Live-Deploy, dass die Migration fertig ist. Die alte private Quelle ist nur Rückfall-/Historienstand; keine doppelte Entwicklung.

Keine unangekündigten Design-, Funktions-, Hardware-, Datenbank- oder Render-Konfigurationsänderungen. Nur beauftragte Änderungen, Feature-Branch, Rückfallstand, vollständige relevante CI und Git-Diff, freigegebener Merge, Live- und Datenprüfung. Keine Produktionsgeheimnisse oder Kundendaten veröffentlichen. Öffentliche CI ausschließlich mit isolierten Testdaten.

Bewahre Lumina-Bilder/LEDs, Kundenanzeige und Rollen, Master/Slave, RFID, Historie/Exporte, Play/Pause/Stop, Diagnose, 12-Sekunden-Anti-Blitz-Fix und neues Branding. Admins können Nutzer und RFID ohne Premium verwalten; Portal-Einladung bleibt Premium, Vorschau read-only. Premium-Buttons haben gemeinsamen türkis-grünen Verlauf und weißen Stern. Externer Windows-Simulator verwendet Standard-OCPP 1.6J und echte Teststationssemantik; seine normalen Transaktionen nicht nachträglich umklassifizieren oder löschen. Für künftige Tests separater SIMULATION-Nutzer mit eigener RFID; keine Testenergie als Kundenenergie abrechnen.

Der letzte freigegebene App-Stand entspricht öffentlichem main vor der Konsolidierungsdoku, Commit 18ad2b0daae0dccf94a1c22863d7fdeed5d15b00, Icon-Release PR #20. DEV PR #21 (Datumsfilter und Fernstart-Rolle) ist separat vorbereitet, alle sechs CI-Workflows zuletzt erfolgreich, aber nicht produktiv. Vor Übernahme Status erneut prüfen. Sichere Backup-Pipeline, tatsächlicher Upload/Restore, Hardware-/Live-UI-Abnahmen und Stabilität bleiben offene Aufgaben; siehe Projektübergabe.

Nach jeder Änderung README und Übergabedokumente aktualisieren. Berichte zuerst den tatsächlich verifizierten Zustand und offene Punkte; beginne keine unaufgeforderten Änderungen.
