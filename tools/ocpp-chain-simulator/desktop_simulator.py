"""Desktop control panel: independently simulates one OCPP master with N connectors.

No GUI library to install: tkinter ships with standard Windows Python.
Use a dedicated non-billing installation registered as NORMAL OCPP hardware.
"""
import asyncio
import base64
import contextlib
import queue
import secrets
import threading
import os
import subprocess
import ctypes
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox
from urllib.parse import quote, urlsplit

import websockets
from ocpp.routing import on
from ocpp.v16 import call, call_result
from ocpp.v16.enums import Action

from chain_simulator import ChainMaster, require, timestamp, validate_url, value_of
from smart_charging import ChargingProfileModel
from ocpp_test_console import CoverageWindow
from ocpp_coverage import AuditStore, CATALOG
from ocpp_soak import SoakRunner
from firmware_lifecycle import FirmwareLifecycle


class InteractiveMaster(ChainMaster):
    def __init__(self, identity, ws, count, notify, nominal_amp=16):
        super().__init__(identity, ws)
        self.count = count
        self.notify = notify
        self.limits = ChargingProfileModel(count, nominal_w=230 * 3 * nominal_amp)
        self._firmware = FirmwareLifecycle(self.call, lambda msg: self.event('log', msg))
        self.config = {"HeartbeatInterval": "30", "MeterValueSampleInterval": "5",
                       "EnelionFreeChargeEnabled": "false",
                       "EnelionFreeChargeOcppIdtag": "CV-FREECHARGE"}
        self.points = {i: {"tx": None, "meter": 1000 * i, "task": None, "busy": False,
                           "status": "Available", "forced_status": None,
                           "pending_disabled": False}
                       for i in range(1, count + 1)}

    def event(self, *args):
        self.notify(*args)

    def active_transactions(self):
        return {i: p["tx"] for i, p in self.points.items() if p["tx"] is not None}

    async def set_status(self, connector, status, error_code="NoError"):
        if connector not in self.points:
            raise ValueError("Unknown connector")
        self.points[connector]["status"] = status
        await self.call(call.StatusNotification(
            connector_id=connector, status=status, error_code=error_code,
            timestamp=timestamp()))
        self.event("point", connector, status, self.points[connector]["tx"] is not None)
        self.event("audit", "STATUS." + status,
                   f"StatusNotification {status} vom Backend bestätigt", connector)
        if status == "Faulted":
            self.event("audit", "ERROR." + error_code,
                       f"StatusNotification Faulted/{error_code} beantwortet", connector)
        self.event("log", f"Connector {connector}: {status}" +
                   (f" ({error_code})" if error_code != "NoError" else ""))

    async def inject_status(self, connector, status, error_code="NoError"):
        p = self.points[connector]
        p["forced_status"] = status if status in (
            "SuspendedEV", "SuspendedEVSE", "Faulted", "Unavailable") else None
        await self.set_status(connector, status, error_code)

    async def authorize_tag(self, id_tag):
        require(1 <= len(id_tag) <= 20, "RFID ID must be 1..20 chars")
        response = await self.call(call.Authorize(id_tag=id_tag))
        status = value_of(response.id_tag_info["status"])
        self.event("log", f"RFID Authorize: {status}. "
                   + ("Karte jetzt im ChargeVisor-Menü RFID-Karten verwalten zuweisen."
                      if status != "Accepted" else "Karte wurde akzeptiert."))
        return status

    def set_site_limit(self, kw):
        self.limits.local_limit(kw)
        self.event("log", f"Lokale Anschlussgrenze: {kw} kW (simulierte Masterregelung). "
                   "Dies ist KEIN vom Backend empfangener SetChargingProfile-Befehl.")


    async def start_one(self, connector, id_tag="CV-SIM-TEST"):
        point = self.points[connector]
        require(not point["busy"] and point["tx"] is None,
                f"Connector {connector} is busy or already charging")
        require(point["status"] not in ("Unavailable", "Faulted"),
                f"Connector {connector} is unavailable or faulted")
        point["busy"] = True
        try:
            await self.set_status(connector, "Preparing")
            self.event("point", connector, "Preparing")
            reply = await self.call(call.Authorize(id_tag=id_tag))
            require(value_of(reply.id_tag_info["status"]) == "Accepted",
                    f"Connector {connector}: RFID not authorized")
            started = await self.call(call.StartTransaction(
                connector_id=connector, id_tag=id_tag,
                meter_start=point["meter"], timestamp=timestamp()
            ))
            require(value_of(started.id_tag_info["status"]) == "Accepted"
                    and isinstance(started.transaction_id, int)
                    and started.transaction_id > 0,
                    f"Connector {connector}: StartTransaction rejected")
            point["tx"] = started.transaction_id
            self.limits.transaction_started(connector)
            await self.set_status(connector, "Charging")
            self.event("point", connector, "Charging")
            self.event("log", f"Connector {connector}: charging, transaction #{point['tx']}")
            point["task"] = asyncio.create_task(self.send_meter_values(connector))
        except Exception:
            if point["tx"] is None:
                with contextlib.suppress(Exception):
                    await self.set_status(connector, "Available")
                self.event("point", connector, "Available")
            raise
        finally:
            point["busy"] = False

    async def send_meter_values(self, connector):
        point = self.points[connector]
        try:
            while point["tx"] is not None:
                interval = int(self.config["MeterValueSampleInterval"])
                await asyncio.sleep(interval)
                forced = point["forced_status"]
                power_w = self.limits.effective(connector, self.active_transactions())
                minimum_w = 6 * self.limits.voltage * self.limits.phases
                if forced in ("SuspendedEV", "SuspendedEVSE", "Faulted", "Unavailable"):
                    power_w = 0
                    target = forced
                elif power_w < minimum_w:
                    power_w = 0
                    target = "SuspendedEVSE"
                else:
                    target = "Charging"
                if point["status"] != target:
                    await self.set_status(connector, target,
                                          "OtherError" if target == "Faulted" else "NoError")
                point["meter"] += round(power_w * interval / 3600)
                await self.call(call.MeterValues(
                    connector_id=connector, transaction_id=point["tx"],
                    meter_value=[{"timestamp": timestamp(), "sampledValue": [
                        {"value": str(point["meter"]),
                         "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                        {"value": str(round(power_w)),
                         "measurand": "Power.Active.Import", "unit": "W"},
                        {"value": str(round(power_w / (self.limits.voltage *
                                                   self.limits.phases), 2)),
                         "measurand": "Current.Import", "unit": "A"},
                    ]}]
                ))
                self.event("meter", connector, point["meter"], round(power_w))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.event("log", f"Connector {connector}: meter error: {error}")

    async def stop_one(self, connector, reason="Local"):
        point = self.points[connector]
        require(not point["busy"] and point["tx"] is not None,
                f"Connector {connector} is not charging or busy")
        point["busy"] = True
        try:
            if point["task"]:
                point["task"].cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await point["task"]
                point["task"] = None
            await self.call(call.StopTransaction(
                transaction_id=point["tx"], meter_stop=point["meter"],
                timestamp=timestamp(), reason=reason
            ))
            self.event("log", f"Connector {connector}: transaction #{point['tx']} stopped")
            point["tx"] = None
            self.limits.transaction_stopped(connector)
            await self.set_status(connector, "Finishing")
            self.event("point", connector, "Finishing")
            if point["forced_status"] in ("Faulted", "Unavailable"):
                await self.set_status(connector, point["forced_status"],
                                      "OtherError" if point["forced_status"] == "Faulted" else "NoError")
            else:
                await self.set_status(connector, "Available")
                self.event("point", connector, "Available")
            if point["pending_disabled"]:
                point["pending_disabled"] = False
                await self.set_status(connector, "Unavailable")
        finally:
            point["busy"] = False

    @on(Action.set_charging_profile)
    async def on_set_charging_profile(self, connector_id, cs_charging_profiles, **kwargs):
        status = self.limits.set_profile(
            connector_id, cs_charging_profiles, self.active_transactions()
        )
        self.event("log", f"CSMS SetChargingProfile connector={connector_id}: {status}. "
                   f"Active profiles: {self.limits.describe()}")
        self.event("audit", "CSMS.SetChargingProfile",
                   f"SetChargingProfile für Connector {connector_id}: {status}", connector_id)
        return call_result.SetChargingProfile(status=status)

    @on(Action.clear_charging_profile)
    async def on_clear_charging_profile(self, id=None, connector_id=None,
                                        charging_profile_purpose=None, stack_level=None, **kwargs):
        status = self.limits.clear(id, connector_id, charging_profile_purpose, stack_level)
        self.event("log", f"CSMS ClearChargingProfile: {status}; "
                   f"remaining={self.limits.describe()}")
        self.event("audit", "CSMS.ClearChargingProfile",
                   f"ClearChargingProfile: {status}", connector_id)
        return call_result.ClearChargingProfile(status=status)

    @on(Action.get_composite_schedule)
    async def on_get_composite_schedule(self, connector_id, duration,
                                         charging_rate_unit=None, **kwargs):
        if connector_id not in self.points or duration < 1:
            return call_result.GetCompositeSchedule(status="Rejected")
        watts = self.limits.effective(connector_id, self.active_transactions())
        unit = charging_rate_unit or "W"
        limit = watts / (self.limits.voltage * self.limits.phases) if unit == "A" else watts
        self.event("log", f"CSMS GetCompositeSchedule connector {connector_id}: {limit:.1f} {unit}")
        self.event("audit", "CSMS.GetCompositeSchedule",
                   f"GetCompositeSchedule für Connector {connector_id}: Accepted ({limit:.1f} {unit})", connector_id)
        return call_result.GetCompositeSchedule(
            status="Accepted", connector_id=connector_id, schedule_start=timestamp(),
            charging_schedule={
                "duration": duration,
                "charging_rate_unit": unit,
                "charging_schedule_period": [
                    {"start_period": 0, "limit": round(limit, 2), "number_phases": self.limits.phases}
                ]
            })

    @on(Action.change_configuration)
    async def on_change_configuration(self, key, value, **kwargs):
        if key not in self.config:
            self.event("log", f"CSMS ChangeConfiguration {key}: NotSupported")
            self.event("audit", "CSMS.ChangeConfiguration",
                       f"ChangeConfiguration {key}: NotSupported", None)
            return call_result.ChangeConfiguration(status="NotSupported")
        if key in ("HeartbeatInterval", "MeterValueSampleInterval"):
            try:
                number = int(value)
                if number < 1 or number > 300:
                    raise ValueError()
            except ValueError:
                return call_result.ChangeConfiguration(status="Rejected")
        self.config[key] = str(value)
        self.event("log", f"CSMS ChangeConfiguration {key}={value}: Accepted")
        self.event("audit", "CSMS.ChangeConfiguration",
                   f"ChangeConfiguration {key}: Accepted", None)
        return call_result.ChangeConfiguration(status="Accepted")

    @on(Action.get_configuration)
    async def on_get_configuration(self, key=None, **kwargs):
        requested = list(self.config) if key is None else key
        known = [{"key": k, "readonly": False, "value": self.config[k]}
                 for k in requested if k in self.config]
        unknown = [k for k in requested if k not in self.config]
        self.event("audit", "CSMS.GetConfiguration",
                   f"GetConfiguration: {len(known)} Werte, {len(unknown)} unbekannte Schlüssel", None)
        return call_result.GetConfiguration(configuration_key=known,
                                            unknown_key=unknown or None)

    @on(Action.change_availability)
    async def on_change_availability(self, connector_id, type, **kwargs):
        ids = list(self.points) if connector_id == 0 else [connector_id]
        if not ids or any(i not in self.points for i in ids):
            return call_result.ChangeAvailability(status="Rejected")
        status = "Available" if type == "Operative" else "Unavailable"
        scheduled = False
        for i in ids:
            if status == "Unavailable" and self.points[i]["tx"] is not None:
                self.points[i]["pending_disabled"] = True
                scheduled = True
            else:
                self.points[i]["pending_disabled"] = False
                self.points[i]["forced_status"] = (None if status == "Available" else "Unavailable")
                await self.set_status(i, status)
        self.event("log", f"CSMS ChangeAvailability {type}: " +
                   ("Scheduled" if scheduled else "Accepted"))
        self.event("audit", "CSMS.ChangeAvailability",
                   f"ChangeAvailability {type}: {'Scheduled' if scheduled else 'Accepted'}", connector_id)
        return call_result.ChangeAvailability(
            status="Scheduled" if scheduled else "Accepted")

    @on(Action.trigger_message)
    async def on_trigger_message(self, requested_message, connector_id=None, **kwargs):
        if requested_message not in ("Heartbeat", "StatusNotification", "MeterValues"):
            return call_result.TriggerMessage(status="NotImplemented")
        if connector_id is not None and connector_id not in self.points:
            return call_result.TriggerMessage(status="Rejected")
        self.event("audit", "CSMS.TriggerMessage",
                   f"TriggerMessage {requested_message}: Accepted", connector_id)
        asyncio.create_task(self._trigger(requested_message, connector_id))
        return call_result.TriggerMessage(status="Accepted")

    async def _trigger(self, action, connector_id):
        try:
            await asyncio.sleep(0.1)
            if action == "Heartbeat":
                await self.call(call.Heartbeat())
            elif action == "StatusNotification":
                for i in ([connector_id] if connector_id else self.points):
                    await self.set_status(i, self.points[i]["status"])
            elif action == "MeterValues":
                for i in ([connector_id] if connector_id else self.points):
                    p = self.points[i]
                    await self.call(call.MeterValues(
                        connector_id=i,
                        transaction_id=p["tx"],
                        meter_value=[{"timestamp": timestamp(), "sampledValue": [{
                            "value": str(p["meter"]),
                            "measurand": "Energy.Active.Import.Register", "unit": "Wh"
                        }]}]))
            self.event("log", f"CSMS TriggerMessage {action}: sent")
        except Exception as exc:
            self.event("log", f"TriggerMessage {action} failed: {exc}")

    @on(Action.unlock_connector)
    async def on_unlock_connector(self, connector_id, **kwargs):
        status = "Unlocked" if connector_id in self.points else "UnlockFailed"
        self.event("log", f"CSMS UnlockConnector {connector_id}: {status}")
        self.event("audit", "CSMS.UnlockConnector", f"UnlockConnector: {status}", connector_id)
        return call_result.UnlockConnector(status=status)

    @on(Action.reset)
    async def on_reset(self, type, **kwargs):
        # Do not falsely acknowledge firmware/hardware reboot that isn't modeled.
        self.event("log", f"CSMS Reset {type}: Rejected (reboot not emulated)")
        self.event("audit", "CSMS.Reset", f"Reset {type}: Rejected (nicht implementiert)", None)
        return call_result.Reset(status="Rejected")

    @on(Action.update_firmware)
    async def on_update_firmware(self, location, retrieve_date, retries=None,
                                 retry_interval=None, **kwargs):
        # A separate *protocol-only* emulator: no real download or flash.
        # OCPP UpdateFirmware.conf is empty by specification; independent
        # status messages and reboot-version observation are the evidence.
        if not self._firmware.queue(location, can_run=not self.active_transactions()):
            raise ValueError("Simulated firmware update requires an idle test station and HTTPS URL")
        self.event("log", "OCPP UpdateFirmware received: protocol simulation queued")
        self.event("audit", "CSMS.UpdateFirmware",
                   "Only status/lifecycle emulated; no real firmware updated", None)
        return call_result.UpdateFirmware()

    @on(Action.remote_start_transaction)
    async def on_remote_start(self, id_tag, connector_id=None, **kwargs):
        number = connector_id or 1
        state = self.points.get(number)
        if not state or state["tx"] is not None or state["busy"]:
            return call_result.RemoteStartTransaction(status="Rejected")
        self.event("audit", "CSMS.RemoteStartTransaction",
                   f"RemoteStartTransaction Connector {number}: Accepted; tatsächlichen Start prüfen", number)
        asyncio.create_task(self._remote_start(number, id_tag))
        return call_result.RemoteStartTransaction(status="Accepted")

    async def _remote_start(self, number, tag):
        try:
            await self.start_one(number, tag)
        except Exception as exc:
            self.event("log", f"RemoteStart connector {number} failed: {exc}")

    @on(Action.remote_stop_transaction)
    async def on_remote_stop(self, transaction_id, **kwargs):
        for number, state in self.points.items():
            if state["tx"] == transaction_id and not state["busy"]:
                self.event("audit", "CSMS.RemoteStopTransaction",
                           f"RemoteStopTransaction Connector {number}: Accepted; tatsächlichen Stop prüfen", number)
                asyncio.create_task(self._remote_stop(number))
                return call_result.RemoteStopTransaction(status="Accepted")
        return call_result.RemoteStopTransaction(status="Rejected")

    async def _remote_stop(self, number):
        try:
            await self.stop_one(number, reason="Remote")
        except Exception as exc:
            self.event("log", f"RemoteStop connector {number} failed: {exc}")


class SimulatorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ChargeVisor – OCPP Ladeketten-Simulator")
        self.geometry("1060x850")
        self.minsize(850, 650)
        self.events = queue.Queue()
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop_worker, daemon=True).start()
        self.ocpp_master = None
        self.socket = None
        self.receiver = None
        self.monitor = None
        self.heartbeat_task = None
        self.reconnect_task = None
        self.manual_disconnect = True
        self.connection_settings = None
        self.recovery_snapshots = {}
        self.last_meters = {}
        self.url_var = tk.StringVar()
        self.id_var = tk.StringVar(value="CV-MASTER-TEST")
        self.password_var = tk.StringVar()
        self.count_var = tk.IntVar(value=6)
        self.nominal_power_var = tk.StringVar(value="11 kW (3 x 16 A)")
        self.tag_var = tk.StringVar(value="")
        self.remote_var = tk.BooleanVar(value=False)
        self.site_kw_var = tk.StringVar(value="")
        self.connector_var = tk.IntVar(value=1)
        self.status_var = tk.StringVar(value="SuspendedEV")
        self.error_var = tk.StringVar(value="NoError")
        self.stop_reason_var = tk.StringVar(value="Local")
        self.connected = False
        self.audit_window = None
        self.audit_store = AuditStore("unbound")
        self.soak_runner = None
        self.soak_future = None
        self.last_soak_dir = None
        self.soak_minutes_var = tk.StringVar(value="120")
        self.soak_status_var = tk.StringVar(value="Dauertest nicht gestartet")
        self.point_widgets = {}
        self._build()
        self.count_var.trace_add("write", self._count_changed)
        self.after(100, self._drain_events)
        self.protocol("WM_DELETE_WINDOW", self._close_app)

    def report_callback_exception(self, exc_type, exc_value, exc_tb):
        """Keep the original Tk callback error instead of hiding it."""
        try:
            directory = Path.home() / "ChargeVisor" / "ocpp-test-results"
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / "simulator-gui-errors.log"
            report = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
            # Remove application secrets from error strings before writing.
            for var in (getattr(self, "password_var", None),
                        getattr(self, "tag_var", None)):
                try:
                    secret = var.get() if var is not None else ""
                    if secret:
                        report = report.replace(secret, "[REDACTED]")
                except Exception:
                    pass
            from datetime import datetime, timezone
            with path.open("a", encoding="utf-8") as handle:
                handle.write("\n" + datetime.now(timezone.utc).isoformat() +
                             " Tk callback exception:\n" + report + "\n")
            messagebox.showerror("Simulator-Fehler",
                                 f"Interner GUI-Fehler protokolliert in:\n{path}\n\n"
                                 f"{exc_type.__name__}: {str(exc_value)[:180]}")
        except Exception:
            # Fallback: never allow the exception reporter to crash Tkinter itself.
            traceback.print_exception(exc_type, exc_value, exc_tb)

    def _loop_worker(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def _build(self):
        root = ttk.Frame(self, padding=16)
        root.pack(fill="both", expand=True)
        ttk.Label(root, text="ChargeVisor · virtueller OCPP-Master",
                  font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(root, text="Eine WebSocket-Verbindung · Connector 1 = Master · 2–N = Slaves",
                  foreground="#51768a").pack(anchor="w", pady=(2, 14))

        settings = ttk.LabelFrame(root, text="OCPP-Verbindung (wie echte Hardware)", padding=12)
        settings.pack(fill="x")
        settings.columnconfigure(1, weight=1)
        fields = [
            ("OCPP Server-URL", self.url_var, False),
            ("Charge-Point-ID", self.id_var, False),
            ("OCPP Basic-Auth-Passwort", self.password_var, True),
        ]
        for row, (label, var, secret) in enumerate(fields):
            ttk.Label(settings, text=label).grid(row=row, column=0, sticky="w", pady=5, padx=(0, 10))
            entry = ttk.Entry(settings, textvariable=var, show="*" if secret else "")
            entry.grid(row=row, column=1, columnspan=3, sticky="ew", pady=5)
        ttk.Label(settings, text="Anzahl Wallboxen").grid(row=3, column=0, sticky="w", pady=6)
        ttk.Spinbox(settings, from_=1, to=20, width=8, textvariable=self.count_var).grid(
            row=3, column=1, sticky="w", pady=6)
        ttk.Label(settings, text="RFID / idTag").grid(row=3, column=2, sticky="e", padx=(4, 10))
        ttk.Entry(settings, textvariable=self.tag_var, width=20).grid(
            row=3, column=3, sticky="ew")
        ttk.Label(settings, text="Wallbox-Nennleistung (beim Verbinden)").grid(row=4, column=0, sticky="w", pady=4)
        ttk.Combobox(settings, textvariable=self.nominal_power_var,
                     values=["11 kW (3 x 16 A)", "22 kW (3 x 32 A)"],
                     width=19, state="readonly").grid(row=4, column=1, sticky="w")
        ttk.Button(settings, text="Neue RFID-ID erzeugen", command=self._generate_rfid).grid(
            row=4, column=2, sticky="e", pady=4, padx=3)
        ttk.Button(settings, text="RFID prüfen/anlernen", command=self._authorize_current).grid(
            row=4, column=3, sticky="w", pady=4)
        ttk.Checkbutton(settings, text="Externen WSS-Server erlauben (eigene Testanlage)",
                        variable=self.remote_var).grid(row=5, column=0, columnspan=4,
                                                       sticky="w", pady=(4, 0))
        ttk.Label(settings, text="Server-URL: ws://127.0.0.1:10000/ocpp/ oder wss://STAGING/ocpp/\n"
                  "Master hat eine OCPP-ID, Slaves eigene Connector-IDs. RFID muss in ChargeVisor freigegeben sein.",
                  foreground="#555").grid(row=6, column=0, columnspan=4, sticky="w", pady=(8, 0))
        buttons = ttk.Frame(root)
        buttons.pack(fill="x", pady=12)
        self.connect_button = ttk.Button(buttons, text="Verbinden", command=self.connect)
        self.connect_button.pack(side="left")
        self.disconnect_button = ttk.Button(buttons, text="Trennen", command=self.disconnect,
                                            state="disabled")
        self.disconnect_button.pack(side="left", padx=8)
        ttk.Button(buttons, text="OCPP SOLL / IST · Testkonsole",
                   command=self._open_audit_console).pack(side="left", padx=12)
        ttk.Button(buttons, text="Simulator aktualisieren",
                   command=self._update_simulator).pack(side="left", padx=5)
        self.state_label = ttk.Label(buttons, text="● Offline", foreground="#bc4b42")
        self.state_label.pack(side="right")

        soak = ttk.LabelFrame(root, text="OCPP-Dauertest · mindestens 60 s je Szenario · Ladepunkte nacheinander", padding=8)
        soak.pack(fill="x", pady=(0, 8))
        ttk.Label(soak, text="Testdauer").pack(side="left", padx=(0, 5))
        ttk.Combobox(soak, textvariable=self.soak_minutes_var, width=7,
                     state="readonly", values=["5", "30", "120"]).pack(side="left")
        ttk.Label(soak, text="Minuten").pack(side="left", padx=(3, 10))
        self.start_soak_button = ttk.Button(soak, text="Automatischen Test starten",
                                            command=self._start_soak, state="disabled")
        self.start_soak_button.pack(side="left", padx=3)
        self.stop_soak_button = ttk.Button(soak, text="Beenden + Bericht erstellen",
                                           command=self._stop_soak, state="disabled")
        self.stop_soak_button.pack(side="left", padx=3)
        ttk.Button(soak, text="Letzten Bericht öffnen",
                   command=self._open_soak_report).pack(side="left", padx=3)
        ttk.Label(root, textvariable=self.soak_status_var, foreground="#52677a").pack(
            anchor="w", pady=(0, 8))
        advanced = ttk.LabelFrame(root, text="Erweiterte OCPP-Tests – Status, Fehler, Lastmanagement", padding=9)
        advanced.pack(fill="x", pady=(0, 10))
        ttk.Label(advanced, text="Anschlusslimit (kW)").grid(row=0, column=0, sticky="w", padx=3)
        ttk.Entry(advanced, textvariable=self.site_kw_var, width=8).grid(row=0, column=1, padx=4)
        ttk.Button(advanced, text="Lokal anwenden", command=self._apply_site_limit).grid(
            row=0, column=2, padx=4)
        ttk.Label(advanced, text="Leer = kein lokales Limit · begrenzt gesamte Ladekette, nicht ChargeVisor",
                  foreground="#667").grid(row=0, column=3, columnspan=4, sticky="w", padx=8)
        ttk.Label(advanced, text="Connector").grid(row=1, column=0, sticky="w", pady=7, padx=3)
        ttk.Spinbox(advanced, from_=1, to=20, textvariable=self.connector_var, width=7).grid(
            row=1, column=1, padx=4)
        ttk.Combobox(advanced, textvariable=self.status_var, width=18, state="readonly",
                     values=["Available", "Preparing", "Charging", "SuspendedEV",
                             "SuspendedEVSE", "Finishing", "Reserved", "Unavailable", "Faulted"]
                     ).grid(row=1, column=2, sticky="ew", padx=4)
        ttk.Combobox(advanced, textvariable=self.error_var, width=23, state="readonly",
                     values=["NoError", "OtherError", "OverCurrentFailure",
                             "GroundFailure", "HighTemperature", "PowerMeterFailure",
                             "PowerSwitchFailure", "EVCommunicationError",
                             "ConnectorLockFailure", "UnderVoltage", "OverVoltage",
                             "InternalError", "LocalListConflict", "ReaderFailure",
                             "ResetFailure", "WeakSignal"]
                     ).grid(row=1, column=3, sticky="ew", padx=4)
        ttk.Button(advanced, text="Status / Fehler senden", command=self._inject_state).grid(
            row=1, column=4, padx=4)
        ttk.Label(advanced, text="Stop-Grund").grid(row=2, column=0, sticky="w", pady=5, padx=3)
        ttk.Combobox(advanced, textvariable=self.stop_reason_var, width=18, state="readonly",
                     values=["Local", "EVDisconnected", "Remote", "PowerLoss",
                             "EmergencyStop", "DeAuthorized", "Reboot"]
                     ).grid(row=2, column=1, columnspan=2, sticky="w", pady=5)
        ttk.Button(advanced, text="Alle starten", command=self._start_all).grid(row=2, column=3, padx=4)
        ttk.Button(advanced, text="Alle stoppen", command=self._stop_all).grid(row=2, column=4, padx=4)
        ttk.Label(root, text="Virtuelle Ladepunkte", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.points_container = ttk.Frame(root)
        self.points_container.pack(fill="x", pady=(6, 12))
        self._render_points(6)
        ttk.Label(root, text="OCPP-Protokoll / Ereignisse", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.logbox = tk.Text(root, height=10, state="disabled", wrap="word",
                              font=("Consolas", 9))
        self.logbox.pack(fill="both", expand=True, pady=(6, 0))
        self._log("Normale Station in ChargeVisor anlegen und ihre OCPP-Zugangsdaten eintragen.")

    def _update_simulator(self):
        if self.soak_future and not self.soak_future.done():
            messagebox.showwarning("Dauertest aktiv",
                "Der automatische Test läuft noch. Erst 'Beenden + Bericht erstellen' verwenden.")
            return
        updater = Path(__file__).resolve().with_name("UPDATE-SIMULATOR.ps1")
        if not updater.is_file():
            messagebox.showerror("Updater fehlt", "UPDATE-SIMULATOR.ps1 nicht gefunden.")
            return
        if not messagebox.askyesno("Simulator aktualisieren",
                                   "Das aktuelle Simulatorfenster wird geschlossen. "
                                   "PowerShell lädt danach nur die Simulator-Dateien "
                                   "neu aus dem GitHub-Branch und startet die neue Version."):
            return
        try:
            subprocess.Popen(["powershell.exe", "-NoProfile",
                              "-ExecutionPolicy", "Bypass", "-File", str(updater)],
                             cwd=str(updater.parent),
                             creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
            self._close_app()
        except OSError as exc:
            messagebox.showerror("Update fehlgeschlagen", str(exc))

    def _open_audit_console(self):
        if self.audit_window and self.audit_window.winfo_exists():
            self.audit_window.lift()
            self.audit_window.focus_force()
            return
        self.audit_window = CoverageWindow(self)
        self.audit_store = self.audit_window.store

    def _prevent_windows_sleep(self, active):
        # Preserve Windows system availability while a real endurance run is active.
        try:
            flags = 0x80000001 if active else 0x80000000
            ctypes.windll.kernel32.SetThreadExecutionState(flags)
        except (AttributeError, OSError):
            pass

    def _start_soak(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Zuerst die OCPP-Verbindung herstellen.")
            return
        if self.soak_future and not self.soak_future.done():
            messagebox.showwarning("Bereits aktiv", "Es läuft schon ein Dauertest.")
            return
        duration = int(self.soak_minutes_var.get())
        if any(p["tx"] is not None for p in self.ocpp_master.points.values()):
            messagebox.showerror("Ladung aktiv",
                                 "Alle laufenden Transaktionen vor dem Dauertest stoppen.")
            return
        tag = self.tag_var.get().strip()
        detail = ("Der Test sendet echte OCPP-Nachrichten an ChargeVisor. "
                  "Er kann zahlreiche Transaktionen, Störungen und Messwerte erzeugen. "
                  "Verwende dafür nur eine eigens angelegte, nicht abrechnungsrelevante "
                  "Wallbox-Identität, niemals die eines Kunden.\n\n"
                  f"Testdauer: {duration} Minuten, {self.ocpp_master.count} Connectoren.\n"
                  "Zwischen unterschiedlichen Testschritten liegt immer mindestens 1 Minute.\n"
                  + ("Ohne gültige RFID werden Ladevorgänge ausgelassen.\n" if not tag else "")
                  + "Das Fenster muss geöffnet bleiben. Ein OCPP-ACK ist KEIN "
                    "Nachweis für korrekte Backend-Daten oder Frontend-Anzeige.\n\n"
                    "Dauertest starten?")
        if not messagebox.askyesno("OCPP-Dauertest starten", detail):
            return
        self.soak_runner = SoakRunner(self.ocpp_master, self.id_var.get().strip(),
                                      tag, self._notify,
                                      duration_seconds=duration * 60)
        self.soak_status_var.set(f"Dauertest wird gestartet: {duration} Min. · mindestens 60s Abstand")
        self.start_soak_button.configure(state="disabled")
        self.stop_soak_button.configure(state="normal")
        self._prevent_windows_sleep(True)
        self.soak_future = asyncio.run_coroutine_threadsafe(
            self.soak_runner.run(), self.loop)
        def completed(future):
            try:
                future.result()
            except Exception as exc:
                self._notify("soak_done", "FAILED", "", "", {"error": str(exc)})
        self.soak_future.add_done_callback(completed)

    def _stop_soak(self):
        if self.soak_future and not self.soak_future.done():
            self.soak_status_var.set("Test wird beendet; Berichte werden gespeichert ...")
            self.soak_future.cancel()
            self.stop_soak_button.configure(state="disabled")

    def _open_soak_report(self):
        folder = self.last_soak_dir
        if not folder:
            messagebox.showinfo("Noch kein Bericht",
                                "Starte zuerst einen Testlauf oder öffne den Ordner "
                                "'%USERPROFILE%/ChargeVisor/ocpp-test-results'.")
            return
        try:
            os.startfile(str(folder))
        except OSError as exc:
            messagebox.showerror("Bericht öffnen", str(exc))

    def _generate_rfid(self):
        # Use a printable, ordinary UID (not reserved CV-SIM-TEST/SIM-* tags).
        tag = secrets.token_hex(4).upper()
        self.tag_var.set(tag)
        self._log(f"Neue RFID-ID: {tag}. Danach 'RFID prüfen/anlernen' klicken.")
        self._log("Im ChargeVisor: RFID-Karten verwalten > Kürzlich erkannt > Zuweisen.")

    def _authorize_current(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Verbinde zuerst die OCPP-Wallbox.")
            return
        tag = self.tag_var.get().strip()
        if not tag or len(tag) > 20:
            messagebox.showerror("RFID ungültig", "RFID-UID muss 1 bis 20 Zeichen haben.")
            return
        self._log(f"RFID-UID {tag} wird als echte OCPP Authorize-Nachricht gesendet.")
        self._schedule(self.ocpp_master.authorize_tag(tag))

    def _apply_site_limit(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Verbinde zuerst die OCPP-Wallbox.")
            return
        raw = self.site_kw_var.get().strip()
        try:
            value = None if not raw else float(raw.replace(",", "."))
            if value is not None and not 0 <= value <= 500:
                raise ValueError("Nur 0 bis 500 kW")
        except ValueError:
            messagebox.showerror("Limit ungültig", "Bitte 0 bis 500 kW oder leer eingeben.")
            return
        self._schedule(self._apply_site(value))

    async def _apply_site(self, kw):
        self.ocpp_master.set_site_limit(kw)

    def _inject_state(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Verbinde zuerst die OCPP-Wallbox.")
            return
        connector = self.connector_var.get()
        if connector not in self.ocpp_master.points:
            messagebox.showerror("Connector ungültig", "Bitte aktiven Connector auswählen.")
            return
        status = self.status_var.get()
        error = self.error_var.get() if status == "Faulted" else "NoError"
        if status == "Faulted" and error == "NoError":
            error = "OtherError"
        self._schedule(self.ocpp_master.inject_status(connector, status, error))

    def _start_all(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Verbinde zuerst die OCPP-Wallbox.")
            return
        tag = self.tag_var.get().strip()
        if not tag:
            messagebox.showerror("RFID", "Erst eine RFID-ID eingeben und in ChargeVisor zuweisen.")
            return
        self._schedule(self._execute_all(True, tag, self.stop_reason_var.get()))

    def _stop_all(self):
        if not self.connected or not self.ocpp_master:
            messagebox.showerror("Offline", "Verbinde zuerst die OCPP-Wallbox.")
            return
        self._schedule(self._execute_all(False, "", self.stop_reason_var.get()))

    async def _execute_all(self, start, tag, reason):
        if not self.ocpp_master:
            return
        eligible = [i for i, p in self.ocpp_master.points.items()
                    if (p["tx"] is None if start else p["tx"] is not None) and not p["busy"]]
        result = await asyncio.gather(*(
            self.ocpp_master.start_one(i, tag) if start else
            self.ocpp_master.stop_one(i, reason=reason)
            for i in eligible), return_exceptions=True)
        failures = [str(x) for x in result if isinstance(x, Exception)]
        self._notify("log", f"{'Start' if start else 'Stop'} aller Ladepunkte: "
                     f"{len(eligible) - len(failures)}/{len(eligible)} erfolgreich.")
        for item in failures:
            self._notify("log", "FEHLER: " + item)

    def _count_changed(self, *_):
        if self.connected or str(self.connect_button["state"]) == "disabled":
            return
        try:
            number = self.count_var.get()
            if 1 <= number <= 20:
                self._render_points(number)
        except (ValueError, tk.TclError):
            pass

    def _render_points(self, count):
        for widget in self.points_container.winfo_children():
            widget.destroy()
        self.point_widgets = {}
        for i in range(1, count + 1):
            line = ttk.Frame(self.points_container)
            line.pack(fill="x", pady=2)
            ttk.Label(line, text=f"Connector {i} – {'Master' if i == 1 else f'Slave {i-1}'}",
                      width=27).pack(side="left")
            status = ttk.Label(line, text="Offline", width=14)
            status.pack(side="left", padx=8)
            start = ttk.Button(line, text="Laden starten", state="disabled",
                               command=lambda n=i: self._submit_point(n, True))
            start.pack(side="left", padx=5)
            stop = ttk.Button(line, text="Stoppen", state="disabled",
                              command=lambda n=i: self._submit_point(n, False))
            stop.pack(side="left", padx=5)
            meter = ttk.Label(line, text="0 Wh")
            meter.pack(side="right")
            self.point_widgets[i] = (status, start, stop, meter)

    def _log(self, line):
        self.logbox.configure(state="normal")
        self.logbox.insert("end", f"{line}\n")
        self.logbox.see("end")
        self.logbox.configure(state="disabled")

    def _notify(self, *message):
        self.events.put(message)

    def _transport_diagnostic(self, phase, detail=""):
        """Append sanitized connection evidence, separate from RFID/GUI events."""
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        safe = str(detail).replace("\n", " ").replace("\r", " ")[:400]
        secret = self.connection_settings[2] if self.connection_settings else ""
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
        line = f"{stamp} {phase}: {safe}"
        self._notify("log", "[NETZ] " + line)
        try:
            out = Path.home() / "ChargeVisor" / "ocpp-test-results"
            out.mkdir(parents=True, exist_ok=True)
            with (out / "simulator-transport.log").open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            self._notify("log", "[NETZ] Diagnoseprotokoll konnte nicht geschrieben werden")

    def _schedule(self, coroutine):
        future = asyncio.run_coroutine_threadsafe(coroutine, self.loop)

        def after_done(f):
            try:
                f.result()
            except Exception as exc:
                self._notify("log", f"FEHLER: {exc}")
        future.add_done_callback(after_done)

    def connect(self):
        if self.connected:
            return
        try:
            number = self.count_var.get()
            require(1 <= number <= 20, "Anzahl Wallboxen muss 1 bis 20 sein")
            identity = self.id_var.get().strip()
            url = self.url_var.get().strip().rstrip("/")
            require(identity and url, "OCPP-URL und Charge-Point-ID fehlen")
            require(bool(self.password_var.get()), "OCPP-Passwort fehlt")
            if url.endswith("/ocpp"):
                url += "/" + quote(identity, safe="")
            remote = urlsplit(url).hostname not in ("localhost", "127.0.0.1", "::1")
            if remote and not self.remote_var.get():
                approved = messagebox.askyesno(
                    "Externe OCPP-Verbindung",
                    "Du möchtest dich mit einem externen WSS-Server verbinden.\n\n"
                    "Der Simulator verbindet sich genau wie eine echte OCPP-1.6J-Wallbox "
                    "mit der angegebenen ID und dem OCPP-Passwort.\n\n"
                    "Achtung: Auf normalen Stationen werden die erzeugten Ladevorgänge "
                    "auch als normale Transaktionen gespeichert. Bitte nur bei "
                    "eigens für Tests vorgesehenen Stationen ausführen.\n\n"
                    "Verbindung zu diesem OCPP-Server aufbauen?",
                )
                if not approved:
                    return
                self.remote_var.set(True)
            validate_url(url, identity, self.remote_var.get())
        except Exception as exc:
            messagebox.showerror("Ungültige OCPP-Konfiguration", str(exc))
            return
        self._render_points(number)
        self.connect_button.configure(state="disabled")
        self.state_label.configure(text="● Verbinde …", foreground="#bd831f")
        self.audit_store = AuditStore(identity)
        if self.audit_window and self.audit_window.winfo_exists():
            self.audit_window.store = self.audit_store
            self.audit_window._refresh()
        # Tk variables may only be read from the GUI thread.
        nominal_amp = 32 if self.nominal_power_var.get().startswith("22") else 16
        self.manual_disconnect = False
        # A user-selected NEW station must not inherit counters or unfinished
        # transactions from a previously connected OCPP identity.
        self.recovery_snapshots.clear()
        self.last_meters.clear()
        # Snapshot Tkinter values before entering the asyncio background thread.
        self.connection_settings = (url, identity, self.password_var.get(), number, nominal_amp)
        self._schedule(self._connect(*self.connection_settings))

    async def _connect(self, url, identity, password, count, nominal_amp):
        try:
            auth = base64.b64encode(f"{identity}:{password}".encode()).decode()
            self.socket = await websockets.connect(
                url, subprotocols=["ocpp1.6"],
                extra_headers={"Authorization": "Basic " + auth},
                open_timeout=15, ping_interval=20, ping_timeout=30, close_timeout=10
            )
            require(self.socket.subprotocol == "ocpp1.6", "OCPP 1.6J not negotiated")
            self.ocpp_master = InteractiveMaster(identity, self.socket, count, self._notify,
                                            nominal_amp=nominal_amp)
            self.receiver = asyncio.create_task(self.ocpp_master.start())
            await self.ocpp_master.boot()
            # Never reset the simulated energy counter after a reconnect.
            for connector, point in self.ocpp_master.points.items():
                if connector in self.last_meters:
                    point["meter"] = max(point["meter"], self.last_meters[connector])
            # An interrupted transaction belongs to the OLD OCPP socket. Do
            # not start a new session before the backend acknowledges its stop.
            recovered = 0
            for connector, state in list(self.recovery_snapshots.items()):
                await self.ocpp_master.call(call.StopTransaction(
                    transaction_id=state["tx"], meter_stop=state["meter"],
                    timestamp=timestamp(), reason="Other"
                ))
                self.recovery_snapshots.pop(connector)
                recovered += 1
                self._transport_diagnostic("OLD_TX_STOPPED",
                                           f"connector={connector} tx={state['tx']}")
            for i in range(1, count + 1):
                await self.ocpp_master.set_status(i, "Available")
                self._notify("point", i, "Available")
            self.heartbeat_task = asyncio.create_task(self._heartbeat())
            self.monitor = asyncio.create_task(self._watch_connection())
            if self.soak_runner and not self.soak_runner.finished and self.soak_runner.pending_recovery:
                self.soak_runner.connection_restored(self.ocpp_master, recovered)
            self._notify("connected", True)
            self._transport_diagnostic("CONNECTED", f"connectors={count}; reconciled_txs={recovered}")
            self._notify("log", f"Connected: {identity}, 1 socket, {count} connectors")
        except Exception as exc:
            self._notify("log", f"Verbindung fehlgeschlagen: {exc}")
            await self._disconnect()
            raise

    async def _heartbeat(self):
        try:
            while True:
                interval = int(self.ocpp_master.config["HeartbeatInterval"]) if self.ocpp_master else 30
                await asyncio.sleep(interval)
                if self.ocpp_master:
                    await self.ocpp_master.call(call.Heartbeat())
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self._transport_diagnostic("HEARTBEAT_FAILED", type(exc).__name__)
            # Let the socket watcher perform snapshot/recovery once.
            if self.socket:
                with contextlib.suppress(Exception):
                    await self.socket.close()

    async def _watch_connection(self):
        detail = "OCPP receiver stopped"
        try:
            await self.receiver
        except asyncio.CancelledError:
            detail = "OCPP receiver cancelled"
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"
        finally:
            code = getattr(self.socket, "close_code", None)
            reason = getattr(self.socket, "close_reason", None)
            if not self.manual_disconnect:
                # Preserve counters and identify transactions that must be
                # closed on the backend before any fresh sessions are created.
                if self.ocpp_master:
                    for connector, point in self.ocpp_master.points.items():
                        self.last_meters[connector] = point["meter"]
                        if point["tx"] is not None:
                            self.recovery_snapshots[connector] = {
                                "tx": point["tx"], "meter": point["meter"]
                            }
                self._transport_diagnostic(
                    "UNEXPECTED_DISCONNECT",
                    f"{detail}; close_code={code}; close_reason={reason}; "
                    f"pending_txs={len(self.recovery_snapshots)}"
                )
                if self.soak_runner and not self.soak_runner.finished:
                    self.soak_runner.connection_lost(
                        f"code={code}, pending_txs={len(self.recovery_snapshots)}"
                    )
            await self._disconnect()
            if not self.manual_disconnect and self.connection_settings:
                self.reconnect_task = asyncio.create_task(self._retry_connection())

    async def _retry_connection(self):
        attempt = 0
        while not self.manual_disconnect and self.connection_settings:
            attempt += 1
            delay = min(30, 2 ** min(attempt, 5))
            self._transport_diagnostic("RECONNECT_WAIT", f"attempt={attempt}; delay={delay}s")
            self._notify("reconnecting", attempt)
            try:
                await asyncio.sleep(delay)
                if self.manual_disconnect:
                    break
                await self._connect(*self.connection_settings)
                self._transport_diagnostic("RECONNECT_SUCCESS", f"attempt={attempt}")
                return
            except asyncio.CancelledError:
                return
            except Exception as exc:
                self._transport_diagnostic("RECONNECT_ERROR",
                                           f"attempt={attempt}; error={type(exc).__name__}")
        self._notify("reconnecting", 0)

    async def _disconnect(self):
        current = asyncio.current_task()
        if self.manual_disconnect and self.reconnect_task and self.reconnect_task != current:
            self.reconnect_task.cancel()
            self.reconnect_task = None
        if self.heartbeat_task and self.heartbeat_task != current:
            self.heartbeat_task.cancel()
        if self.monitor and self.monitor != current:
            self.monitor.cancel()
        if self.ocpp_master:
            for point in self.ocpp_master.points.values():
                task = point.get("task")
                if task:
                    task.cancel()
        if self.socket:
            with contextlib.suppress(Exception):
                await self.socket.close()
        if self.receiver and self.receiver != current:
            self.receiver.cancel()
        self.socket = None
        self.ocpp_master = None
        self.receiver = None
        self.monitor = None
        self.heartbeat_task = None
        self._notify("connected", False)

    def disconnect(self):
        if self.soak_future and not self.soak_future.done():
            messagebox.showwarning("Dauertest aktiv",
                "Vor dem Trennen zuerst 'Beenden + Bericht erstellen' verwenden.")
            return
        self.manual_disconnect = True
        self._schedule(self._disconnect())

    def _submit_point(self, connector, start):
        if not self.ocpp_master:
            return
        if start:
            tag = self.tag_var.get().strip()
            if not tag:
                messagebox.showerror(
                    "RFID erforderlich",
                    "Trage die RFID-UID einer in ChargeVisor zugelassenen Karte ein. "
                    "Der zugehörige Nutzer muss diesem Ladepunkt zugewiesen sein. "
                    "Für Freecharge kann CV-FREECHARGE verwendet werden, "
                    "wenn Freecharge im Backend aktiviert ist.",
                )
                return
            self._schedule(self.ocpp_master.start_one(connector, tag))
        else:
            self._schedule(self.ocpp_master.stop_one(connector, self.stop_reason_var.get()))

    def _drain_events(self):
        try:
            while True:
                message = self.events.get_nowait()
                kind = message[0]
                if kind == "log":
                    self._log(message[1])
                elif kind == "connected":
                    self.connected = bool(message[1])
                    reconnecting = (not self.manual_disconnect and self.reconnect_task
                                    and not self.reconnect_task.done())
                    self.connect_button.configure(
                        state="disabled" if self.connected or reconnecting else "normal")
                    self.start_soak_button.configure(state="normal" if self.connected and not (
                        self.soak_future and not self.soak_future.done()) else "disabled")
                    self.disconnect_button.configure(state="normal" if self.connected else "disabled")
                    self.state_label.configure(
                        text="● Online" if self.connected else "● Offline",
                        foreground="#178452" if self.connected else "#bc4b42"
                    )
                    if not self.connected:
                        for state, start, stop, meter in self.point_widgets.values():
                            state.configure(text="Offline")
                            start.configure(state="disabled")
                            stop.configure(state="disabled")
                elif kind == "reconnecting":
                    attempt = message[1]
                    if attempt:
                        self.state_label.configure(text=f"● Reconnect {attempt} ...",
                                                   foreground="#bd831f")
                        self.connect_button.configure(state="disabled")
                    else:
                        self.connect_button.configure(state="normal")
                elif kind == "point":
                    _, connector, state, *details = message
                    if connector in self.point_widgets:
                        status, start, stop, meter = self.point_widgets[connector]
                        status.configure(text=state)
                        # SuspendedEV / SuspendedEVSE / Faulted may STILL have
                        # an active transaction. Preserve the Stop button.
                        active = details[0] if details else (
                            self.ocpp_master is not None and
                            self.ocpp_master.points[connector]["tx"] is not None)
                        start.configure(state="disabled" if active or state in ("Faulted", "Unavailable") else "normal")
                        stop.configure(state="normal" if active else "disabled")
                elif kind == "audit":
                    _, case_id, observed, connector = message
                    if case_id in CATALOG and self.audit_store.status(case_id) == "PASS":
                        continue
                    if (case_id in CATALOG and self.soak_runner and self.soak_future
                        and not self.soak_future.done()):
                        self._schedule(self.soak_runner.observe_inbound(case_id, observed, connector))
                    if case_id in CATALOG:
                        verdict = ("NOT_IMPLEMENTED" if "NotSupported" in observed or
                                   "nicht implementiert" in observed else
                                   "FAIL" if "Rejected" in observed else "PROTOCOL_OK")
                        if self.audit_window and self.audit_window.winfo_exists():
                            self.audit_window.record_inbound(case_id, observed, connector, verdict)
                        else:
                            self.audit_store.mark(case_id, verdict, observed, connector)
                elif kind == "soak_log":
                    self._log("[DAUERTEST] " + message[1])
                elif kind == "soak_progress":
                    _, elapsed, target, cycle, phase = message
                    rest = max(0, target - elapsed)
                    self.soak_status_var.set(
                        f"Dauertest läuft · Zyklus {cycle} · {elapsed // 60} / {target // 60} Min. "
                        f"· verbleibend {rest // 60} Min. · {phase}")
                elif kind == "soak_done":
                    self._prevent_windows_sleep(False)
                    _, status, csv_path, json_path, summary = message
                    self.soak_status_var.set(
                        f"Dauertest {status} · OCPP-Check: " +
                        str(summary.get("PROTOCOL_OK", 0)) + " Protokoll OK, " +
                        str(summary.get("FAIL", 0)) + " fehlgeschlagen, " +
                        str(summary.get("NOT_TESTED", 0)) + " offen. Bericht: " + csv_path)
                    self._log("[DAUERTEST] " + status + " · Bericht: " + json_path)
                    if csv_path:
                        self.last_soak_dir = Path(csv_path).parent
                    self.start_soak_button.configure(state="normal" if self.connected else "disabled")
                    self.stop_soak_button.configure(state="disabled")
                    if csv_path and self.soak_runner and status in ("COMPLETED", "COMPLETED_WITH_INTERRUPTION", "CANCELLED", "FAILED"):
                        if not self.audit_window or not self.audit_window.winfo_exists():
                            self.audit_window = CoverageWindow(self)
                        self.audit_window.store = self.soak_runner.audit
                        self.audit_window._refresh()
                        self.audit_window.lift()
                        self._log("[DAUERTEST] Die OCPP Soll-/Ist-Matrix ist jetzt geöffnet.")
                elif kind == "meter":
                    _, connector, energy, power = message
                    if connector in self.point_widgets:
                        self.point_widgets[connector][3].configure(
                            text=f"{energy:,} Wh  ·  {power / 1000:.2f} kW")
        except queue.Empty:
            pass
        self.after(100, self._drain_events)

    def _close_app(self):
        if self.soak_future and not self.soak_future.done():
            messagebox.showwarning("Dauertest aktiv",
                "Der Zweistundentest läuft noch. Verwende zuerst "
                "'Beenden + Bericht erstellen', damit der Testlauf sauber abgeschlossen wird.")
            return
        self.manual_disconnect = True
        self._schedule(self._disconnect())
        self.destroy()


if __name__ == "__main__":
    SimulatorApp().mainloop()
