"""Two-hour independent OCPP 1.6J endurance run on an existing GUI WebSocket.

NOT a background cloud job: the Windows app must remain open. This runner
never claims ChargeVisor DB/UI success from an OCPP acknowledgement. Results
use PROTOCOL_OK until separately verified in the Audit Console.

Exercises a dedicated NORMAL (non-billing) OCPP identity. The backend may
create genuine sessions and data, so never run against a real customer station.
"""
import asyncio
import csv
import hashlib
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic

from ocpp.v16 import call

from ocpp_coverage import AuditStore, CATALOG, code_assessment
from paced_plan import build_plan, MIN_REAL_STEP_SECONDS


def iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_identity(identity):
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]


STATUS_SEQUENCE = (
    "Available", "Preparing", "Charging", "SuspendedEV",
    "SuspendedEVSE", "Finishing", "Reserved", "Unavailable", "Faulted",
)
ERROR_CODES = (
    "ConnectorLockFailure", "EVCommunicationError", "GroundFailure",
    "HighTemperature", "InternalError", "LocalListConflict", "NoError",
    "OtherError", "OverCurrentFailure", "OverVoltage", "PowerMeterFailure",
    "PowerSwitchFailure", "ReaderFailure", "ResetFailure", "UnderVoltage",
    "WeakSignal",
)


class SoakRunner:
    """Asynchronous test runner; all socket calls share the GUI master."""

    def __init__(self, master, identity, rfid_tag, notify, duration_seconds=7200,
                 cycle_seconds=300, base_dir=None, _test_interval_seconds=None):
        if _test_interval_seconds is None:
            if not 300 <= duration_seconds <= 86400:
                raise ValueError("Normal endurance runs must last 5 minutes to 24 hours")
            # Production behavior: full minute AFTER each scenario completes.
            self.step_interval_seconds = MIN_REAL_STEP_SECONDS
        else:
            # Explicit internal test override, never exposed in the Windows GUI.
            if not 0 < _test_interval_seconds <= 1:
                raise ValueError("Invalid internal test interval")
            if not 0.1 <= duration_seconds <= 86400:
                raise ValueError("Invalid internal test duration")
            self.step_interval_seconds = float(_test_interval_seconds)
        if cycle_seconds < 10:
            raise ValueError("Cycle must be >=10 seconds")
        self.master = master
        self.identity = identity
        self.rfid_tag = rfid_tag or ""
        self.notify = notify
        self.duration = int(duration_seconds)
        self.cycle_seconds = cycle_seconds
        self.start_at = None
        self.stop_at = None
        self.cycle = 0
        self.owned_txs = {}
        self.rfid_valid = False
        self.planned_steps = build_plan(master.count)
        self.completed_steps = 0
        self.events = []
        self.initial_local_limit = master.limits.site_limit_kw
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
        root = Path(base_dir) if base_dir else Path.home() / "ChargeVisor" / "ocpp-test-results"
        self.run_dir = root / ("soak-" + self.run_id)
        self.audit = AuditStore(identity, base_dir=self.run_dir)
        self.report_paths = {}
        self.finished = False
        self.initial_profiles = set(master.limits.profiles)

    def push(self, level, check, detail, connector=None):
        # Avoid persisting passwords or RFID UIDs.
        event = {"time": iso(), "cycle": self.cycle, "level": level,
                 "check": check, "connector": connector, "detail": str(detail)[:1000]}
        self.events.append(event)
        self.events = self.events[-10000:]
        if level == "FAIL":
            self.notify("soak_log", f"FEHLER {check}: {detail}")
        elif level in ("PROTOCOL_OK", "INFO"):
            self.notify("soak_log", f"{check}: {detail}")
        return event

    def record(self, case_id, verdict, observed, connector=None):
        if case_id in CATALOG:
            existing = self.audit.status(case_id)
            # Failures are sticky: a later successful cycle must never hide a
            # previous intermittent problem in the 2-hour final report.
            if existing == "FAIL" and verdict != "FAIL":
                self.push("INFO", case_id,
                          f"Later {verdict} after previous FAIL: {observed}", connector)
                return
            # Do not erase an earlier actual protocol result just because
            # a subsequent cycle could not perform the same test.
            if existing == "PROTOCOL_OK" and verdict == "NOT_TESTED":
                self.push("INFO", case_id, observed, connector)
                return
            self.audit.mark(case_id, verdict, observed, connector)
        self.push(verdict, case_id, observed, connector)

    async def call(self, payload, label, limit=18):
        return await asyncio.wait_for(self.master.call(payload), timeout=limit)

    async def check_boot_heartbeat(self):
        try:
            response = await self.call(call.Heartbeat(), "Heartbeat")
            if not getattr(response, "current_time", None):
                raise AssertionError("Heartbeat response missing currentTime")
            self.record("CP.Heartbeat", "PROTOCOL_OK",
                        "Heartbeat answered with currentTime; backend lastSeen not verified")
        except Exception as exc:
            self.record("CP.Heartbeat", "FAIL", f"Heartbeat: {type(exc).__name__}: {exc}")

    async def check_unknown_rfid(self):
        # One unique unknown card generated per run, not per cycle.
        tag = "CVPROBE" + secrets.token_hex(5).upper()
        try:
            reply = await self.call(call.Authorize(id_tag=tag), "Unknown RFID")
            result = str(reply.id_tag_info.get("status", ""))
            if result != "Invalid":
                self.record("SCENARIO.RFID.Unknown", "FAIL",
                            f"Unknown RFID unexpectedly returned {result}")
            else:
                self.record("SCENARIO.RFID.Unknown", "PROTOCOL_OK",
                            "Unknown RFID rejected (Invalid); recent-card UI still unverified")
        except Exception as exc:
            self.record("SCENARIO.RFID.Unknown", "FAIL", f"{type(exc).__name__}: {exc}")

    async def check_optional_cp_actions(self):
        """Send three safe OCPP 1.6J extensions and record real support/rejection."""
        requests = [
            ("CP.DataTransfer", call.DataTransfer(
                vendor_id="Walectra", message_id="ChargeVisor-Soak", data="ping")),
            ("CP.DiagnosticsStatusNotification", call.DiagnosticsStatusNotification(status="Idle")),
            ("CP.FirmwareStatusNotification", call.FirmwareStatusNotification(status="Idle")),
        ]
        for case_id, request in requests:
            try:
                response = await self.call(request, case_id)
                status = str(getattr(response, "status", "Accepted"))
                if status in ("Rejected", "NotSupported", "UnknownVendorId", "UnknownMessageId"):
                    self.record(case_id, "NOT_IMPLEMENTED",
                                f"{case_id}: {status} (server response)")
                else:
                    self.record(case_id, "PROTOCOL_OK",
                                f"{case_id}: OCPP response {status}; data/UI unverified")
            except Exception as exc:
                msg = str(exc)
                if any(t in msg for t in ("NotImplemented", "NotSupported", "UnknownVendorId")):
                    self.record(case_id, "NOT_IMPLEMENTED",
                                f"{case_id}: {type(exc).__name__}: {msg[:220]}")
                else:
                    self.record(case_id, "FAIL",
                                f"{case_id}: {type(exc).__name__}: {msg[:220]}")

    async def check_known_rfid(self):
        if not self.rfid_tag:
            self.record("SCENARIO.RFID.Assigned", "NOT_TESTED",
                        "No assigned RFID entered; load transactions will be skipped")
            return False
        try:
            response = await self.call(call.Authorize(id_tag=self.rfid_tag), "Assigned RFID")
            status = str(response.id_tag_info.get("status", ""))
            if status != "Accepted":
                self.record("SCENARIO.RFID.Assigned", "FAIL",
                            f"Assigned test RFID returned {status}; check user/point grants")
                return False
            self.record("SCENARIO.RFID.Assigned", "PROTOCOL_OK",
                        "Assigned RFID accepted; user-point mapping not verified")
            self.record("CP.Authorize", "PROTOCOL_OK",
                        "Authorize returned Accepted for assigned tag; backend data still open")
            return True
        except Exception as exc:
            self.record("SCENARIO.RFID.Assigned", "FAIL", f"{type(exc).__name__}: {exc}")
            return False

    async def statuses_and_errors(self):
        # Exercise each standard status/error using an inactive connector.
        n = self.master.count
        connector = ((self.cycle - 1) % n) + 1
        if self.master.points[connector]["tx"] is not None:
            # Don't replace a live state with Faulted before the session phase.
            return
        for status in STATUS_SEQUENCE:
            key = "STATUS." + status
            code = "OtherError" if status == "Faulted" else "NoError"
            try:
                await asyncio.wait_for(self.master.inject_status(connector, status, code), 18)
                self.record(key, "PROTOCOL_OK",
                            f"StatusNotification {status}/{code} acknowledged on connector {connector}; backend UI not verified",
                            connector)
            except Exception as exc:
                self.record(key, "FAIL", f"{status}: {type(exc).__name__}: {exc}", connector)
        for error in ERROR_CODES:
            key = "ERROR." + error
            try:
                await asyncio.wait_for(self.master.inject_status(connector, "Faulted", error), 18)
                self.record(key, "PROTOCOL_OK",
                            f"Faulted/{error} acknowledged on connector {connector}; alarm display not verified",
                            connector)
            except Exception as exc:
                self.record(key, "FAIL", f"{error}: {type(exc).__name__}: {exc}", connector)
        try:
            await self.master.inject_status(connector, "Available", "NoError")
        except Exception as exc:
            self.push("FAIL", "RestoreStatus", str(exc), connector)

    async def start_chain(self):
        if not self.rfid_tag:
            self.record("SCENARIO.Chain.Parallel", "NOT_TESTED",
                        "No RFID; skipped real charging sessions")
            return []
        candidates = [i for i, p in self.master.points.items()
                      if p["tx"] is None and not p["busy"]]
        if len(candidates) != self.master.count:
            self.record("SCENARIO.Chain.Parallel", "FAIL",
                        "Already active transaction(s); run requires an unused dedicated test station")
            return []
        started = await asyncio.gather(*(
            self.master.start_one(i, self.rfid_tag) for i in candidates
        ), return_exceptions=True)
        successful = []
        for connector, outcome in zip(candidates, started):
            if isinstance(outcome, BaseException):
                self.push("FAIL", "StartTransaction", f"Connector {connector}: {type(outcome).__name__}: {outcome}", connector)
                continue
            tx_id = self.master.points[connector]["tx"]
            if isinstance(tx_id, int) and tx_id > 0:
                successful.append(connector)
                self.owned_txs[connector] = tx_id
        ids = [self.owned_txs[c] for c in successful]
        if not successful or len(set(ids)) != len(ids) or len(successful) != len(candidates):
            self.record("SCENARIO.Chain.Parallel", "FAIL",
                        f"{len(successful)}/{len(candidates)} connectors started, unique tx IDs {len(set(ids))}")
        else:
            self.record("SCENARIO.Chain.Parallel", "PROTOCOL_OK",
                        f"{len(successful)} independent transaction IDs over one OCPP socket; backend assignments unverified")
            self.record("CP.StartTransaction", "PROTOCOL_OK",
                        f"{len(successful)} StartTransaction accepted; backend history not verified")
            if len(successful) >= 10:
                self.record("SCENARIO.Load.TenWallboxes", "PROTOCOL_OK",
                            "10 charging connectors started on one master; backend/load results still open")
        return successful

    async def test_meter_and_local_load(self, connectors):
        if not connectors:
            self.record("SCENARIO.Load.LocalBudget", "NOT_TESTED",
                        "Requires approved RFID and active sessions")
            return
        original = self.master.limits.site_limit_kw
        try:
            # With 10x 7.2 kW loads, 30 kW forces a subset into SuspendedEVSE.
            self.master.limits.local_limit(30)
            active = self.master.active_transactions()
            values = {c: self.master.limits.effective(c, active) for c in connectors}
            total = sum(values.values())
            if total > 30000.1:
                raise AssertionError(f"Local allocation exceeded 30 kW: {total} W")
            self.record("SCENARIO.Load.LocalBudget", "PROTOCOL_OK",
                        f"LOCAL charger budget: {len(connectors)} active, {total:.0f} W <= 30000 W; NOT backend DLM")
            # Verify the backend acknowledges EVERY connector's independent meter frame.
            async def send_meter(connector):
                point = self.master.points[connector]
                power = values[connector]
                await self.call(call.MeterValues(
                    connector_id=connector, transaction_id=point["tx"],
                    meter_value=[{"timestamp": iso(), "sampledValue": [
                        {"value": str(point["meter"]), "unit": "Wh",
                         "measurand": "Energy.Active.Import.Register"},
                        {"value": str(round(power)), "unit": "W",
                         "measurand": "Power.Active.Import"},
                    ]}]
                ), "MeterValues")
            replies = await asyncio.gather(
                *(send_meter(connector) for connector in connectors),
                return_exceptions=True)
            errors = [(c, str(e)) for c, e in zip(connectors, replies)
                      if isinstance(e, BaseException)]
            if errors:
                raise RuntimeError(f"MeterValues ACK failure on {errors[:3]}")
            self.record("CP.MeterValues", "PROTOCOL_OK",
                        f"MeterValues on {len(connectors)} connectors acknowledged at "
                        f"{total:.0f} W sum; backend persistence unverified")
            # Send explicit 0W/SuspendedEVSE status to the affected connector(s).
            suspended = [c for c, watts in values.items() if watts == 0]
            for connector in suspended:
                await self.master.inject_status(connector, "SuspendedEVSE")
            await asyncio.sleep(min(15, max(1, self.cycle_seconds / 15)))
            if suspended:
                self.record("SCENARIO.Load.SuspendedEVSE", "PROTOCOL_OK",
                            f"0W/SuspendedEVSE ACK on {len(suspended)} connectors under "
                            "30kW LOCAL cap; backend UI unverified")
            else:
                self.record("SCENARIO.Load.SuspendedEVSE", "NOT_TESTED",
                            "Local 30 kW limit did not require connector suspension")
        except Exception as exc:
            self.record("SCENARIO.Load.LocalBudget", "FAIL",
                        f"{type(exc).__name__}: {exc}")
        finally:
            self.master.limits.local_limit(original)
            for connector in connectors:
                if (self.master.points[connector]["tx"] is not None and
                    self.master.points[connector]["forced_status"] == "SuspendedEVSE"):
                    try:
                        await self.master.inject_status(connector, "Charging")
                    except Exception as exc:
                        self.push("FAIL", "ResumeAfterLocalLimit",
                                  f"{type(exc).__name__}: {exc}", connector)

    async def test_suspended(self, connectors):
        if not connectors:
            self.record("SCENARIO.Load.SuspendedEV", "NOT_TESTED",
                        "No running session (RFID missing/rejected)")
            return
        connector = connectors[0]
        try:
            tx = self.master.points[connector]["tx"]
            await self.master.inject_status(connector, "SuspendedEV")
            await asyncio.sleep(min(5, max(1, self.cycle_seconds / 45)))
            if self.master.points[connector]["tx"] != tx:
                raise AssertionError("SuspendedEV closed an active transaction")
            self.record("SCENARIO.Load.SuspendedEV", "PROTOCOL_OK",
                        f"SuspendedEV transmitted for active Tx {tx}; backend state still unverified")
            await self.master.inject_status(connector, "SuspendedEVSE")
            await asyncio.sleep(min(5, max(1, self.cycle_seconds / 45)))
            if self.master.points[connector]["tx"] != tx:
                raise AssertionError("SuspendedEVSE closed an active transaction")
            self.record("SCENARIO.Load.SuspendedEVSE", "PROTOCOL_OK",
                        f"SuspendedEVSE transmitted for active Tx {tx}; backend state still unverified")
            await self.master.inject_status(connector, "Charging")
        except Exception as exc:
            self.record("SCENARIO.Load.SuspendedEV", "FAIL",
                        f"{type(exc).__name__}: {exc}", connector)

    async def observe_inbound(self, case_id, observed, connector=None):
        """Log actual CSMS->charger command observed while the endurance run is active.

        This still does not prove the command's effect on persistent backend data.
        """
        if not self.start_at or self.finished or case_id not in CATALOG:
            return
        if "NotSupported" in observed or "nicht implementiert" in observed:
            verdict = "NOT_IMPLEMENTED"
        elif "Rejected" in observed:
            verdict = "FAIL"
        else:
            verdict = "PROTOCOL_OK"
        self.record(case_id, verdict, observed + " (CSMS command seen live)", connector)

    async def observe_remote_profile(self):
        profiles = set(self.master.limits.profiles)
        new = profiles - self.initial_profiles
        if new:
            self.record("CSMS.SetChargingProfile", "PROTOCOL_OK",
                        f"Received real SetChargingProfile from backend: profile ids {sorted(new)}; "
                        "actual power change must be checked")
            self.record("SCENARIO.Load.SetPoint", "PROTOCOL_OK",
                        "Received OCPP charging profile; no verified ChargeVisor DLM decision")
            self.initial_profiles = profiles

    async def end_chain(self, connectors):
        results = await asyncio.gather(*(
            self.master.stop_one(c, reason="Local") for c in connectors
            if self.master.points[c]["tx"] is not None
        ), return_exceptions=True)
        failures = [str(x) for x in results if isinstance(x, BaseException)]
        for connector in connectors:
            if self.master.points[connector]["tx"] is None:
                self.owned_txs.pop(connector, None)
        if failures:
            self.record("CP.StopTransaction", "FAIL",
                        f"{len(failures)} stop failures: {'; '.join(failures)[:350]}")
        elif connectors:
            self.record("CP.StopTransaction", "PROTOCOL_OK",
                        f"{len(connectors)} StopTransaction acknowledged; history not verified")
            self.record("SCENARIO.Chain.Isolation", "PROTOCOL_OK",
                        "Separate sessions and meter values emitted by connector; DB mapping unverified")

    async def tick(self, phase, duration=None):
        if self.start_at is None:
            return
        elapsed = min(self.duration, int(monotonic() - self.start_at))
        self.notify("soak_progress", elapsed, self.duration, self.cycle, phase)
        if duration:
            await asyncio.sleep(duration)

    async def execute_paced_step(self, step):
        """One OCPP test scenario at a time, against one connector if relevant."""
        kind, connector, value = step["kind"], step.get("connector"), step.get("value")
        self.push("INFO", "STEP", f"{kind} · Connector {connector or '-'} · {value or ''}", connector)

        if kind == "RFID_KNOWN":
            self.rfid_valid = await self.check_known_rfid()
            return
        if kind == "RFID_UNKNOWN":
            await self.check_unknown_rfid()
            return
        if kind == "HEARTBEAT":
            await self.check_boot_heartbeat()
            return

        if kind == "START":
            if not self.rfid_valid:
                self.record("CP.StartTransaction", "NOT_TESTED",
                            "No valid RFID for physical-mode charging", connector)
                return
            if self.master.points[connector]["tx"] is not None:
                self.push("INFO", "START", "Connector already has an active test session", connector)
                return
            try:
                await asyncio.wait_for(self.master.start_one(connector, self.rfid_tag), 24)
                tx = self.master.points[connector]["tx"]
                if not isinstance(tx, int):
                    raise RuntimeError("No accepted transaction ID")
                self.owned_txs[connector] = tx
                self.record("CP.StartTransaction", "PROTOCOL_OK",
                            f"Connector {connector} accepted StartTransaction tx={tx}; backend DB unchecked",
                            connector)
                self.record("STATUS.Preparing", "PROTOCOL_OK",
                            f"Connector {connector}: Preparing sent in start sequence", connector)
                self.record("STATUS.Charging", "PROTOCOL_OK",
                            f"Connector {connector}: Charging sent in start sequence", connector)
                if len(self.owned_txs) >= 2:
                    if len(set(self.owned_txs.values())) == len(self.owned_txs):
                        self.record("SCENARIO.Chain.Parallel", "PROTOCOL_OK",
                                    f"{len(self.owned_txs)} independent concurrent sessions ramped "
                                    "one connector per minute; backend UI unchecked")
                    else:
                        self.record("SCENARIO.Chain.Parallel", "FAIL",
                                    "Same transaction ID returned for multiple connectors")
                if self.master.count >= 10 and len(self.owned_txs) == self.master.count:
                    self.record("SCENARIO.Load.TenWallboxes", "PROTOCOL_OK",
                                f"{self.master.count} active sessions started sequentially; "
                                "backend UI/load distribution unchecked")
            except Exception as exc:
                self.record("CP.StartTransaction", "FAIL",
                            f"Connector {connector}: {type(exc).__name__}: {exc}", connector)
            return

        if kind == "STOP":
            tx = self.master.points[connector]["tx"]
            if tx is None:
                self.push("INFO", "STOP", f"Connector {connector} has no running transaction", connector)
                return
            try:
                await asyncio.wait_for(self.master.stop_one(connector), 24)
                self.owned_txs.pop(connector, None)
                # Restore forced EV suspension from an earlier scenario.
                if self.master.points[connector]["forced_status"] is not None:
                    await asyncio.wait_for(self.master.inject_status(
                        connector, "Available", "NoError"), 15)
                self.record("CP.StopTransaction", "PROTOCOL_OK",
                            f"Connector {connector} transaction {tx} stopped; history unchecked",
                            connector)
                self.record("STATUS.Finishing", "PROTOCOL_OK",
                            f"Connector {connector}: Finishing sent during stop", connector)
                self.record("STATUS.Available", "PROTOCOL_OK",
                            f"Connector {connector}: Available after stop", connector)
            except Exception as exc:
                self.record("CP.StopTransaction", "FAIL",
                            f"Connector {connector}: {type(exc).__name__}: {exc}", connector)
            return

        if kind in ("SUSPEND_EV", "SUSPEND_EVSE"):
            status = "SuspendedEV" if kind == "SUSPEND_EV" else "SuspendedEVSE"
            tx = self.master.points[connector]["tx"]
            if tx is None:
                self.record("SCENARIO.Load." + status, "NOT_TESTED",
                            "Requires an active authorized transaction", connector)
                return
            try:
                await asyncio.wait_for(self.master.inject_status(connector, status), 15)
                if self.master.points[connector]["tx"] != tx:
                    raise AssertionError("Transaction unexpectedly ended")
                self.record("SCENARIO.Load." + status, "PROTOCOL_OK",
                            f"{status} ACK for active transaction {tx}; power/GUI unchecked",
                            connector)
                self.record("STATUS." + status, "PROTOCOL_OK",
                            f"{status} ACK for active transaction {tx}; ChargeVisor UI unchecked",
                            connector)
            except Exception as exc:
                self.record("SCENARIO.Load." + status, "FAIL",
                            f"{type(exc).__name__}: {exc}", connector)
            return

        if kind == "LIMIT_ON":
            if not self.owned_txs:
                self.record("SCENARIO.Load.LocalBudget", "NOT_TESTED",
                            "No active transactions: missing/invalid RFID")
                return
            self.master.limits.local_limit(30)
            active = self.master.active_transactions()
            power = {c: self.master.limits.effective(c, active) for c in active}
            total = sum(power.values())
            if total > 30000.1:
                self.record("SCENARIO.Load.LocalBudget", "FAIL",
                            f"Local charger algorithm exceeded 30 kW: {total:.1f} W")
            else:
                # A local arithmetic check alone cannot earn PROTOCOL_OK.
                # Check the actual MeterValues OCPP response in the next step.
                self.push("INFO", "LOCAL_LOAD",
                          f"Local model computes {total / 1000:.2f} kW "
                          f"for {len(active)} connectors; awaiting MeterValues ACK")
                if any(v == 0 for v in power.values()):
                    self.push("PROTOCOL_OK", "LOAD", "Expected 0W / SuspendedEVSE for "
                              f"{sum(v == 0 for v in power.values())} connectors")
            return

        if kind == "LIMIT_OFF":
            self.master.limits.local_limit(self.initial_local_limit)
            self.push("INFO", "LOAD", "Local 30 kW cap removed; Backend DLM not proven")
            return

        if kind == "METER":
            active = self.master.active_transactions()
            if not active:
                self.record("CP.MeterValues", "NOT_TESTED",
                            "No active test transaction", connector)
                return
            target = connector if connector in active else next(iter(active))
            point = self.master.points[target]
            power = self.master.limits.effective(target, active)
            try:
                await self.call(call.MeterValues(
                    connector_id=target, transaction_id=point["tx"],
                    meter_value=[{"timestamp": iso(), "sampledValue": [
                        {"value": str(point["meter"]), "unit": "Wh",
                         "measurand": "Energy.Active.Import.Register"},
                        {"value": str(round(power)), "unit": "W",
                         "measurand": "Power.Active.Import"},
                    ]}]
                ), "MeterValues")
                self.record("CP.MeterValues", "PROTOCOL_OK",
                            f"Connector {target}: {power:.0f} W / MeterValues ACK; "
                            "backend reading not verified", target)
                if self.master.limits.site_limit_kw is not None:
                    total = sum(self.master.limits.effective(c, active) for c in active)
                    cap = self.master.limits.site_limit_kw * 1000
                    if total > cap + 0.5:
                        self.record("SCENARIO.Load.LocalBudget", "FAIL",
                                    f"Simulated total {total:.1f} W exceeds {cap:.1f} W")
                    else:
                        self.record("SCENARIO.Load.LocalBudget", "PROTOCOL_OK",
                                    f"Local power model under {cap / 1000:.1f} kW; "
                                    "at least one MeterValues ACK received. Backend DLM not proven.")
            except Exception as exc:
                self.record("CP.MeterValues", "FAIL",
                            f"Connector {target}: {type(exc).__name__}: {exc}", target)
            return

        if kind in ("STATUS", "ERROR", "RESTORE"):
            status = ("Faulted" if kind == "ERROR" else
                      "Available" if kind == "RESTORE" else value)
            error = value if kind == "ERROR" else "OtherError" if status == "Faulted" else "NoError"
            try:
                await asyncio.wait_for(self.master.inject_status(connector, status, error), 18)
                if kind == "ERROR":
                    case_id = "ERROR." + error
                else:
                    case_id = "STATUS." + status
                self.record(case_id, "PROTOCOL_OK",
                            f"Connector {connector}: {status}/{error} OCPP ACK; "
                            "ChargeVisor dashboard/DB unverified", connector)
                if status == "Faulted":
                    self.record("STATUS.Faulted", "PROTOCOL_OK",
                                f"Connector {connector}: Faulted/{error} OCPP ACK", connector)
            except Exception as exc:
                case_id = "ERROR." + value if kind == "ERROR" else "STATUS." + status
                self.record(case_id, "FAIL",
                            f"Connector {connector}: {type(exc).__name__}: {exc}", connector)
            return

        if kind == "OPTIONAL_PROBE":
            requests = {
                "DataTransfer": lambda: call.DataTransfer(
                    vendor_id="Walectra", message_id="CV-Paced-Check", data="ping"),
                "DiagnosticsStatusNotification": lambda: call.DiagnosticsStatusNotification(
                    status="Idle"),
                "FirmwareStatusNotification": lambda: call.FirmwareStatusNotification(
                    status="Idle"),
            }
            case_id = "CP." + value
            try:
                reply = await self.call(requests[value](), case_id)
                status = str(getattr(reply, "status", "Accepted"))
                verdict = ("NOT_IMPLEMENTED" if status in (
                    "Rejected", "NotSupported", "UnknownVendorId", "UnknownMessageId")
                           else "PROTOCOL_OK")
                self.record(case_id, verdict,
                            f"{value} response {status}; backend result unchecked", connector)
            except Exception as exc:
                message = str(exc)
                verdict = ("NOT_IMPLEMENTED" if any(x in message for x in (
                    "NotSupported", "NotImplemented", "UnknownVendorId"))
                           else "FAIL")
                self.record(case_id, verdict,
                            f"{value} returned {type(exc).__name__}: {message[:200]}",
                            connector)
            return

        self.push("INFO", kind, "Unknown scheduled test; intentionally not marked PASS")

    async def run(self):
        """A paced, single-scenario-at-a-time endurance run.

        The GUI default is exactly 60 seconds *after completion of a test*
        before the next distinct test starts. Heartbeat/MeterValues background
        telemetry is exempt: it is not a change of test scenario.
        """
        if any(p["tx"] is not None for p in self.master.points.values()):
            raise RuntimeError("Stop existing transactions before starting the endurance test")
        self.start_at = monotonic()
        self.stop_at = self.start_at + self.duration
        status = "COMPLETED"
        self.push("INFO", "RUN",
                  f"Started: {self.duration}s, connector_count={self.master.count}, "
                  f"minimum {self.step_interval_seconds:.0f}s after each test step")
        self.record("SCENARIO.Chain.OneSocket", "PROTOCOL_OK",
                    f"One OCPP WebSocket, {self.master.count} Connector IDs")
        self.record("CP.BootNotification", "PROTOCOL_OK",
                    "BootNotification Accepted during connection; backend info unchecked")
        try:
            while monotonic() < self.stop_at:
                step = self.planned_steps[self.completed_steps % len(self.planned_steps)]
                self.cycle = self.completed_steps + 1
                await self.tick(f"Test {self.cycle}: {step['kind']} "
                                f"Connector {step.get('connector') or '-'}")
                try:
                    await self.execute_paced_step(step)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    # A failed step is recorded but does NOT stop a 2h run.
                    self.push("FAIL", "STEP",
                              f"{step['kind']} connector {step.get('connector')}: "
                              f"{type(exc).__name__}: {exc}")
                self.completed_steps += 1
                # 60s dwell AFTER each step; do not switch fault/status quickly.
                dwell_until = min(self.stop_at, monotonic() + self.step_interval_seconds)
                while monotonic() < dwell_until:
                    if getattr(getattr(self.master, "_connection", None), "closed", False):
                        raise ConnectionError("OCPP socket closed during endurance run")
                    await self.tick(f"Wartezeit nach {step['kind']} "
                                    f"({int(dwell_until - monotonic())}s)")
                    await asyncio.sleep(min(3.0, max(0, dwell_until - monotonic())))
        except asyncio.CancelledError:
            status = "CANCELLED"
            self.push("INFO", "RUN", "User cancelled paced endurance test")
        except Exception as exc:
            status = "FAILED"
            self.push("FAIL", "RUN", f"{type(exc).__name__}: {exc}")
        finally:
            leftovers = [c for c in self.owned_txs
                         if self.master.points[c]["tx"] is not None]
            results = await asyncio.gather(*(
                asyncio.wait_for(self.master.stop_one(c), timeout=8)
                for c in leftovers), return_exceptions=True)
            for connector, outcome in zip(leftovers, results):
                if isinstance(outcome, BaseException):
                    self.push("FAIL", "Cleanup",
                              f"Connector {connector}: {type(outcome).__name__}: {outcome}")
            self.owned_txs.clear()
            self.master.limits.local_limit(self.initial_local_limit)
            if not getattr(getattr(self.master, "_connection", None), "closed", False):
                for connector, point in self.master.points.items():
                    if point["tx"] is not None:
                        continue
                    if point["status"] != "Available" or point["forced_status"] is not None:
                        try:
                            await asyncio.wait_for(self.master.inject_status(
                                connector, "Available"), timeout=5)
                        except Exception as exc:
                            self.push("FAIL", "RestoreStatus",
                                      f"Connector {connector}: {exc}")
            self.finished = True
            try:
                self.report_paths = self.export_report(status)
                self.notify("soak_done", status,
                            str(self.report_paths.get("csv", "")),
                            str(self.report_paths.get("json", "")),
                            self.audit.summary())
            except Exception as exc:
                self.notify("soak_done", "REPORT_FAILED", "", "",
                            {"error": str(exc)})

    def export_report(self, final_status):
        self.run_dir.mkdir(parents=True, exist_ok=True)
        matrix_json = self.audit.export("json", self.run_dir / "ocpp-soll-ist.json")
        matrix_csv = self.audit.export("csv", self.run_dir / "ocpp-soll-ist.csv")
        metadata = {
            "schema": 1,
            "run_id": self.run_id,
            "finished_at": iso(),
            "duration_seconds_requested": self.duration,
            "duration_seconds_elapsed": (
                round(monotonic() - self.start_at, 1) if self.start_at is not None else 0
            ),
            "cycles_completed": self.cycle,
            "test_steps_completed": self.completed_steps,
            "minimum_pause_after_each_test_seconds": self.step_interval_seconds,
            "test_timing": "one connector transition per test step; parallel charging ramps one/minute",
            "wallbox_nominal_w": self.master.limits.nominal_w,
            "connectors": self.master.count,
            "identity_sha256": safe_identity(self.identity),
            "result": final_status,
            "summary": self.audit.summary(),
            "meaning": {
                "PROTOCOL_OK": "OCPP answered, backend storage/UI NOT proven",
                "PASS": "Requires independent backend/UI evidence (none auto assigned)",
                "FAIL": "OCPP/protocol/scenario failed",
                "NOT_TESTED": "Not run or cannot be triggered using charger-side access",
                "NOT_IMPLEMENTED": "Explicitly not supported after actual test",
            },
            "load_management": {
                "local_simulation": True,
                "csms_dynamic_load_management_proven": False,
                "note": "30 kW local budget is a simulator algorithm; no automatic backend DLM proof",
            },
            "matrix_json": str(matrix_json),
            "matrix_csv": str(matrix_csv),
            "events": self.events,
        }
        json_file = self.run_dir / "soak-report.json"
        csv_file = self.run_dir / "soak-events.csv"
        json_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        with csv_file.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=["time", "cycle", "level", "check", "connector", "detail"],
                delimiter=";",
            )
            writer.writeheader()
            writer.writerows(self.events)
        return {"json": json_file, "csv": csv_file,
                "matrix_json": matrix_json, "matrix_csv": matrix_csv}
