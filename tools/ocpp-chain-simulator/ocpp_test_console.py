"""Tkinter OCPP audit window with real protocol probes and manual backend proof.

The 'Protocol OK' verdict means only OCPP request / response, never correct
ChargeVisor persistence, user assignment, tariff or UI state. Those must be
confirmed as PASS using an explicit reviewer/evidence note.
"""
import asyncio
import json
import queue
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from ocpp.v16 import call
from ocpp_coverage import AuditStore, CATALOG, SIDES, code_assessment


async def probe_case(master, case_id, connector=1, tag=""):
    """Run an OCPP probe on the *actual* connected WebSocket."""
    if case_id not in CATALOG:
        raise ValueError("Unknown case")
    case = CATALOG[case_id]
    if case["direction"] != "CP" or not case["auto"]:
        return "NOT_TESTED", "Nicht automatisch auslösbar. Bei Backend→Wallbox den Befehl in ChargeVisor auslösen und danach Ist-Zustand bestätigen."
    if not master:
        return "NOT_TESTED", "Keine Verbindung zum OCPP-Server"
    if connector not in master.points:
        return "NOT_TESTED", "Connector ist nicht in der aktuellen Ladekette konfiguriert."

    name = case_id.split(".", 1)[1]
    try:
        if case_id.startswith("STATUS.") or case_id.startswith("ERROR."):
            if case_id.startswith("STATUS."):
                status, error = name, "OtherError" if name == "Faulted" else "NoError"
            else:
                status, error = "Faulted", name
            await asyncio.wait_for(master.inject_status(connector, status, error), 15)
            return "PROTOCOL_OK", f"StatusNotification {status}/{error} für Connector {connector} vom Backend bestätigt; Frontendwirkung noch offen"
        if name == "BootNotification":
            await asyncio.wait_for(master.boot(), 15)
            return "PROTOCOL_OK", "BootNotification Accepted und Heartbeat beantwortet; Anzeige/Firmware noch offen"
        if name == "Heartbeat":
            reply = await asyncio.wait_for(master.call(call.Heartbeat()), 15)
            if not getattr(reply, "current_time", None):
                return "FAIL", "Heartbeat-Antwort ohne currentTime"
            return "PROTOCOL_OK", "Heartbeat beantwortet; lastSeen im Backend noch zu prüfen"
        if name == "Authorize":
            if not tag:
                return "NOT_TESTED", "RFID/idTag fehlt; diese UID muss im Backend autorisiert oder bewusst unbekannt sein"
            reply = await asyncio.wait_for(master.call(call.Authorize(id_tag=tag)), 15)
            outcome = reply.id_tag_info["status"]
            return "PROTOCOL_OK", f"Authorize({len(tag)} Zeichen): Antwort {outcome}; Nutzer-/Ladepunktfreigabe noch zu prüfen"
        if name == "StatusNotification":
            await asyncio.wait_for(master.set_status(connector, "Available"), 15)
            return "PROTOCOL_OK", f"Connector {connector}: StatusNotification Available ACK; Frontend noch offen"
        if name == "StartTransaction":
            if not tag:
                return "NOT_TESTED", "Vor StartTransaction zuerst im RFID-Feld eine gültige Karte angeben"
            if master.points[connector]["tx"] is not None:
                return "NOT_TESTED", "Connector lädt bereits; zuerst StopTransaction ausführen"
            await asyncio.wait_for(master.start_one(connector, tag), 18)
            tx = master.points[connector]["tx"]
            if tx is None:
                return "FAIL", "Kein Transaktions-ID nach StartTransaction"
            return "PROTOCOL_OK", f"Connector {connector}: transactionId {tx}; Nutzer und Datenbank noch prüfen"
        if name == "StopTransaction":
            tx = master.points[connector]["tx"]
            if tx is None:
                return "NOT_TESTED", "Keine aktive Transaktion zum Beenden"
            await asyncio.wait_for(master.stop_one(connector), 18)
            if master.points[connector]["tx"] is not None:
                return "FAIL", "Transaktion nach StopTransaction noch aktiv"
            return "PROTOCOL_OK", f"Connector {connector}: Tx {tx} beendet; Rechnung/Historie noch prüfen"
        if name == "MeterValues":
            point = master.points[connector]
            if point["tx"] is None:
                return "NOT_TESTED", "MeterValues mit transactionId erfordert aktiven Ladevorgang"
            reply = await asyncio.wait_for(master.call(call.MeterValues(
                connector_id=connector, transaction_id=point["tx"],
                meter_value=[{"timestamp": master_test_time(), "sampledValue": [
                    {"value": str(point["meter"]), "unit": "Wh",
                     "measurand": "Energy.Active.Import.Register"},
                    {"value": "7200", "unit": "W", "measurand": "Power.Active.Import"},
                ]}]
            )), 15)
            return "PROTOCOL_OK", f"MeterValues Connector {connector} Tx {point['tx']} beantwortet; DB-Zähler muss geprüft werden"
        if name == "DataTransfer":
            reply = await asyncio.wait_for(master.call(call.DataTransfer(
                vendor_id="Walectra", message_id="CV-Probe", data="ping"
            )), 15)
            status = str(getattr(reply, "status", ""))
            if status in ("Rejected", "NotSupported", "UnknownVendorId", "UnknownMessageId"):
                return "NOT_IMPLEMENTED", f"DataTransfer: {status}; kein herstellerspezifischer Handler vorhanden"
            return "PROTOCOL_OK", f"DataTransfer Status {status}; Geschäftslogik noch zu prüfen"
        if name == "DiagnosticsStatusNotification":
            await asyncio.wait_for(master.call(call.DiagnosticsStatusNotification(
                status="Idle"
            )), 15)
            return "PROTOCOL_OK", "DiagnosticsStatusNotification Idle ACK; Backendlog noch prüfen"
        if name == "FirmwareStatusNotification":
            await asyncio.wait_for(master.call(call.FirmwareStatusNotification(
                status="Idle"
            )), 15)
            return "PROTOCOL_OK", "FirmwareStatusNotification Idle ACK; Backendlog noch prüfen"
        return "NOT_TESTED", f"{name} braucht einen separaten Protokollablauf; hier noch nicht automatisiert"
    except Exception as exc:
        kind = type(exc).__name__
        code = getattr(exc, "code", "")
        if kind in ("NotSupportedError", "NotImplementedError") or str(code) in (
            "NotSupported", "NotImplemented"):
            return "NOT_IMPLEMENTED", f"ChargeVisor antwortet {kind} / {code}"
        return "FAIL", f"{kind}: {str(exc)[:400]}"


def master_test_time():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


class CoverageWindow(tk.Toplevel):
    def __init__(self, app):
        super().__init__(app)
        self.app = app
        self.title("ChargeVisor – OCPP 1.6J Soll / Ist Testmatrix")
        self.geometry("1270x800")
        self.minsize(950, 640)
        self.store = AuditStore(app.id_var.get().strip())
        self.queue = queue.Queue()
        self.search = tk.StringVar()
        self.group = tk.StringVar(value="Alle")
        self.conn = tk.IntVar(value=1)
        self.summary_var = tk.StringVar()
        self.last_selected = None
        self.last_observed = ""
        self._build()
        self._refresh()
        self.after(150, self._poll)

    def _build(self):
        outer = ttk.Frame(self, padding=12)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="OCPP 1.6J · ChargeVisor Soll / Ist",
                  font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(outer, text="PROTOCOL_OK = OCPP-Antwort erhalten. PASS erst nach Bestätigung der Wirkung im ChargeVisor-Backend/Frontend. Ungeprüfte Features bleiben offen.",
                  foreground="#52677a").pack(anchor="w", pady=(3, 9))
        tools = ttk.Frame(outer)
        tools.pack(fill="x")
        ttk.Label(tools, text="Suche").pack(side="left")
        ttk.Entry(tools, textvariable=self.search, width=30).pack(side="left", padx=6)
        ttk.Label(tools, text="Bereich").pack(side="left", padx=(10, 2))
        groups = ["Alle"] + sorted({item["group"] for item in CATALOG.values()})
        ttk.Combobox(tools, textvariable=self.group, values=groups,
                     width=28, state="readonly").pack(side="left", padx=5)
        ttk.Label(tools, text="Connector").pack(side="left", padx=(10, 2))
        ttk.Spinbox(tools, from_=1, to=20, width=5,
                    textvariable=self.conn).pack(side="left")
        ttk.Button(tools, text="Aktualisieren", command=self._refresh).pack(side="right")
        cols = ("id", "group", "direction", "code", "verdict", "timestamp")
        main = ttk.Frame(outer)
        main.pack(fill="both", expand=True, pady=(12, 8))
        self.tree = ttk.Treeview(main, columns=cols, show="headings", selectmode="browse")
        headings = {"id": "OCPP-Test-ID", "group": "Kategorie",
                    "direction": "Richtung", "code": "Backend-Codecheck", "verdict": "ChargeVisor Ist",
                    "timestamp": "Letzter Test"}
        widths = {"id": 240, "group": 255, "direction": 170,
                  "code": 230, "verdict": 155, "timestamp": 165}
        for col in cols:
            self.tree.heading(col, text=headings[col])
            self.tree.column(col, width=widths[col], stretch=col in ("id", "group"))
        scroll = ttk.Scrollbar(main, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.tree.bind("<<TreeviewSelect>>", self._selection)
        self.search.trace_add("write", lambda *_: self._refresh())
        self.group.trace_add("write", lambda *_: self._refresh())

        info = ttk.LabelFrame(outer, text="SOLL / IST / Prüfnachweis", padding=8)
        info.pack(fill="x")
        self.details = tk.Text(info, height=6, wrap="word", font=("Consolas", 10))
        self.details.pack(fill="x", expand=False)
        self.details.configure(state="disabled")

        buttons = ttk.Frame(outer)
        buttons.pack(fill="x", pady=(8, 4))
        ttk.Button(buttons, text="OCPP-Test ausführen", command=self._run).pack(side="left", padx=2)
        ttk.Button(buttons, text="Dauertest (60 s pro Schritt)", command=self._batch).pack(side="left", padx=2)
        ttk.Button(buttons, text="Backend/Frontend PASS bestätigen", command=self._pass).pack(side="left", padx=2)
        ttk.Button(buttons, text="FAIL markieren", command=lambda: self._manual("FAIL")).pack(side="left", padx=2)
        ttk.Button(buttons, text="Nicht implementiert", command=lambda: self._manual("NOT_IMPLEMENTED")).pack(side="left", padx=2)
        ttk.Button(buttons, text="Zurücksetzen", command=lambda: self._manual("NOT_TESTED")).pack(side="left", padx=2)
        ttk.Button(buttons, text="CSV exportieren", command=lambda: self._export("csv")).pack(side="right", padx=2)
        ttk.Button(buttons, text="JSON exportieren", command=lambda: self._export("json")).pack(side="right", padx=2)
        ttk.Label(outer, textvariable=self.summary_var).pack(anchor="w", pady=(5, 0))

    def _selected(self):
        names = self.tree.selection()
        return names[0] if names else None

    def _refresh(self):
        selected = self._selected()
        q = self.search.get().strip().casefold()
        group = self.group.get()
        for item in self.tree.get_children():
            self.tree.delete(item)
        for case in CATALOG.values():
            if group != "Alle" and group != case["group"]:
                continue
            if q and q not in (case["id"] + " " + case["expected"] + " " + case["group"]).casefold():
                continue
            record = self.store.rows.get(case["id"], {})
            self.tree.insert("", "end", iid=case["id"],
                             values=(case["id"], case["group"],
                                     SIDES[case["direction"]], code_assessment(case["id"]),
                                     self.store.status(case["id"]),
                                     record.get("timestamp", "–")))
        if selected and self.tree.exists(selected):
            self.tree.selection_set(selected)
        else:
            rows = self.tree.get_children()
            if rows:
                self.tree.selection_set(rows[0])
        self._selection()
        counts = self.store.summary()
        self.summary_var.set(
            f"Gesamt {len(CATALOG)} | PASS: {counts['PASS']} | FAIL: {counts['FAIL']} | "
            f"Protokoll OK / Backend offen: {counts['PROTOCOL_OK']} | "
            f"Nicht implementiert: {counts['NOT_IMPLEMENTED']} | "
            f"Nicht getestet: {counts['NOT_TESTED']} | "
            f"Ergebnisse: {self.store.path}"
        )

    def _selection(self, *_):
        case_id = self._selected()
        if not case_id or case_id not in CATALOG:
            return
        case = CATALOG[case_id]
        record = self.store.rows.get(case_id, {})
        detail = (
            f"TEST: {case_id}  [{SIDES[case['direction']]}]\n"
            f"SOLL: {case['expected']}\n"
            f"NACHWEIS: {case['verify']}\n"
            f"CODECHECK (nur Repository): {code_assessment(case_id)}\n"
            f"IST: {record.get('observed') or 'Noch nicht geprüft'}\n"
            f"EVIDENZ: {record.get('evidence') or 'Noch kein Backend/Frontend-Nachweis'}\n"
            f"ERGEBNIS: {self.store.status(case_id)}"
        )
        self.details.configure(state="normal")
        self.details.delete("1.0", "end")
        self.details.insert("1.0", detail)
        self.details.configure(state="disabled")

    def _run(self):
        case_id = self._selected()
        if not case_id:
            return
        case = CATALOG[case_id]
        if not case["auto"]:
            messagebox.showinfo("Manueller Test", (
                "Dieser Test erfordert eine Aktion im ChargeVisor-Backend oder eine "
                "manuelle Sichtprüfung. Er wird nicht als erfolgreich markiert, "
                "solange keine tatsächliche OCPP-Antwort und der Backend-Nachweis vorliegen."
            ), parent=self)
            return
        if not self.app.connected or not self.app.ocpp_master:
            messagebox.showerror("Offline", "Zuerst Simulator mit ChargeVisor verbinden.", parent=self)
            return
        connector = self.conn.get()
        tag = self.app.tag_var.get().strip()
        result = asyncio.run_coroutine_threadsafe(
            probe_case(self.app.ocpp_master, case_id, connector, tag), self.app.loop)
        def done(future):
            try:
                verdict, observed = future.result()
            except Exception as exc:
                verdict, observed = "FAIL", type(exc).__name__ + ": " + str(exc)
            self.queue.put((case_id, verdict, observed, connector))
        result.add_done_callback(done)
        self.summary_var.set(f"Läuft: {case_id} auf Connector {connector} ...")

    def _batch(self):
        """Never run rapid-fire OCPP tests: delegate to paced GUI endurance."""
        self.app._start_soak()

    def _poll(self):
        if not self.winfo_exists():
            return
        try:
            while True:
                case_id, verdict, observed, connector = self.queue.get_nowait()
                if case_id == "__DONE__":
                    self._refresh()
                    messagebox.showinfo("Testlauf", observed, parent=self)
                    continue
                try:
                    self.store.mark(case_id, verdict, observed, connector)
                except (ValueError, OSError) as exc:
                    messagebox.showerror("Speichern", str(exc), parent=self)
                self._refresh()
        except queue.Empty:
            pass
        self.after(150, self._poll)

    def record_inbound(self, case_id, observed, connector=None, verdict="PROTOCOL_OK"):
        """Call on Tk main thread only after the actual CSMS handler responds."""
        if case_id not in CATALOG:
            return
        if self.store.status(case_id) == "PASS":
            return
        self.store.mark(case_id, verdict, observed, connector)
        self._refresh()

    def _pass(self):
        case_id = self._selected()
        if not case_id:
            return
        if self.store.status(case_id) not in ("PROTOCOL_OK", "FAIL", "NOT_IMPLEMENTED"):
            messagebox.showwarning("Nachweis fehlt",
                "Führe zunächst den OCPP-Protokolltest aus oder bestätige einen "
                "echten eingegangenen Backend-Befehl. Nur anschließend PASS vergeben.",
                parent=self)
            return
        proof = simpledialog.askstring(
            "Backend-/Frontend-Nachweis",
            "Was wurde in ChargeVisor geprüft? Beispiel: Connector 3, "
            "Status Faulted im Frontend mit Zeitstempel sichtbar; "
            "OCPP-Ereignis bestätigt.\nOhne Nachweis kein PASS.",
            parent=self,
        )
        if not proof or len(proof.strip()) < 8:
            return
        before = self.store.rows.get(case_id, {})
        self.store.mark(case_id, "PASS", before.get("observed", "Manuell geprüft"),
                        before.get("connector"), proof.strip(), "Manuell bestätigt")
        self._refresh()

    def _manual(self, verdict):
        case_id = self._selected()
        if not case_id:
            return
        if verdict == "NOT_TESTED":
            observed = "Zurückgesetzt: kein belastbarer Nachweis"
        else:
            observed = simpledialog.askstring(
                "Ist-Ergebnis begründen",
                "Welche konkrete Fehlfunktion oder Nichtimplementierung wurde festgestellt?",
                parent=self)
            if not observed:
                return
        previous = self.store.rows.get(case_id, {})
        self.store.mark(case_id, verdict, observed,
                        previous.get("connector"), "" if verdict != "PASS" else previous.get("evidence", ""))
        self._refresh()

    def _export(self, fmt):
        extension = ".csv" if fmt == "csv" else ".json"
        filename = filedialog.asksaveasfilename(
            parent=self, title="OCPP Soll-/Ist-Bericht exportieren",
            defaultextension=extension,
            filetypes=[("CSV für Excel", "*.csv")] if fmt == "csv" else [("JSON", "*.json")],
            initialfile=f"ChargeVisor-OCPP-16J-Testmatrix{extension}")
        if not filename:
            return
        try:
            path = self.store.export(fmt, filename)
            messagebox.showinfo("Export abgeschlossen", f"Bericht gespeichert:\n{path}", parent=self)
        except OSError as exc:
            messagebox.showerror("Export fehlgeschlagen", str(exc), parent=self)
