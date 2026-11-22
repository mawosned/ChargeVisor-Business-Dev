"""Offline smoke tests for the time-bounded OCPP endurance runner.

No real network or ChargeVisor backend is contacted; these tests only verify
runner orchestration, local report semantics and cleanup behavior.
"""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from ocpp_soak import SoakRunner
from smart_charging import ChargingProfileModel


class FakeMaster:
    def __init__(self, count=10):
        self.count = count
        self.points = {c: {"tx": None, "meter": c * 1000,
                            "status": "Available", "forced_status": None,
                            "busy": False} for c in range(1, count + 1)}
        self.limits = ChargingProfileModel(count)
        self._connection = SimpleNamespace(closed=False)

    def active_transactions(self):
        return {c: p["tx"] for c, p in self.points.items() if p["tx"] is not None}

    async def call(self, request):
        name = type(request).__name__
        if name == "Heartbeat":
            return SimpleNamespace(current_time="2026-11-22T15:00:00+00:00")
        if name == "Authorize":
            tag = request.id_tag
            return SimpleNamespace(id_tag_info={
                "status": "Invalid" if tag.startswith("CVPROBE") else "Accepted"
            })
        if name == "MeterValues":
            return SimpleNamespace()
        if name in ("DataTransfer", "DiagnosticsStatusNotification",
                    "FirmwareStatusNotification"):
            raise RuntimeError("NotImplemented by fake CSMS")
        raise AssertionError("Unexpected OCPP request " + name)

    async def inject_status(self, connector, status, error_code="NoError"):
        self.points[connector]["status"] = status
        self.points[connector]["forced_status"] = (
            status if status in ("Faulted", "SuspendedEVSE", "SuspendedEV", "Unavailable")
            else None
        )

    async def set_status(self, connector, status):
        self.points[connector]["status"] = status

    async def start_one(self, connector, tag):
        self.points[connector]["tx"] = 100 + connector
        self.limits.transaction_started(connector)

    async def stop_one(self, connector, reason="Local"):
        self.points[connector]["tx"] = None
        self.limits.transaction_stopped(connector)


class SoakTests(unittest.IsolatedAsyncioTestCase):
    async def test_ten_connector_report_has_no_unverified_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            master = FakeMaster(10)
            events = []
            runner = SoakRunner(master, "CV-TEST-01", "ASSIGNED1",
                                lambda *args: events.append(args),
                                duration_seconds=1.6, cycle_seconds=10,
                                _test_interval_seconds=0.025, base_dir=tmp)
            await asyncio.wait_for(runner.run(), 6)
            self.assertTrue(runner.finished)
            self.assertTrue(all(p["tx"] is None for p in master.points.values()))
            report = json.loads(runner.report_paths["json"].read_text(encoding="utf-8"))
            self.assertEqual(report["result"], "COMPLETED")
            self.assertEqual(report["summary"]["PASS"], 0)
            self.assertGreater(report["summary"]["PROTOCOL_OK"], 10)
            self.assertEqual(runner.audit.status("SCENARIO.Chain.Parallel"), "PROTOCOL_OK")
            self.assertEqual(runner.audit.status("SCENARIO.Load.LocalBudget"), "PROTOCOL_OK")
            self.assertEqual(runner.audit.status("CSMS.GetDiagnostics"), "NOT_TESTED")
            self.assertFalse(any("ASSIGNED1" in json.dumps(event)
                                 for event in report["events"]))
            self.assertTrue(any(m[0] == "soak_done" for m in events))

    async def test_run_without_rfid_does_not_fake_charge_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            master = FakeMaster(2)
            runner = SoakRunner(master, "CV-TEST-02", "",
                                lambda *args: None,
                                duration_seconds=1.6, cycle_seconds=10,
                                _test_interval_seconds=0.025, base_dir=tmp)
            await asyncio.wait_for(runner.run(), 6)
            self.assertEqual(runner.audit.status("SCENARIO.RFID.Assigned"), "NOT_TESTED")
            self.assertEqual(runner.audit.status("SCENARIO.Chain.Parallel"), "NOT_TESTED")
            self.assertEqual(runner.audit.status("CSMS.SetChargingProfile"), "NOT_TESTED")

    async def test_cancel_still_saves_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            master = FakeMaster(3)
            runner = SoakRunner(master, "CV-TEST-CANCEL", "ASSIGNED1",
                                lambda *args: None,
                                duration_seconds=7200, cycle_seconds=300,
                                _test_interval_seconds=0.025, base_dir=tmp)
            job = asyncio.create_task(runner.run())
            await asyncio.sleep(0.1)
            job.cancel()
            await asyncio.wait_for(job, 10)
            report = json.loads(runner.report_paths["json"].read_text(encoding="utf-8"))
            self.assertEqual(report["result"], "CANCELLED")
            self.assertTrue(all(p["tx"] is None for p in master.points.values()))


if __name__ == "__main__":
    unittest.main()
