"""Protocol test of advanced charge point handlers over one real OCPP 1.6J socket.

Requires ocpp and websockets from requirements.txt, but no Render/database/GUI
display. Tests protocol behavior, not ChargeVisor server functionality.
"""
import asyncio
import contextlib
import unittest
from datetime import datetime, timezone

import websockets
from websockets.legacy.server import serve
from ocpp.routing import on
from ocpp.v16 import ChargePoint as Central, call, call_result
from ocpp.v16.enums import Action

from desktop_simulator import InteractiveMaster


class MockCentral(Central):
    @on(Action.boot_notification)
    def boot(self, charge_point_vendor, charge_point_model, **kwargs):
        return call_result.BootNotification(
            current_time=datetime.now(timezone.utc).isoformat(),
            interval=30, status="Accepted")

    @on(Action.heartbeat)
    def heartbeat(self):
        return call_result.Heartbeat(current_time=datetime.now(timezone.utc).isoformat())

    @on(Action.status_notification)
    def status(self, connector_id, error_code, status, **kwargs):
        return call_result.StatusNotification()

    @on(Action.authorize)
    def authorize(self, id_tag):
        return call_result.Authorize(
            id_tag_info={"status": "Accepted" if id_tag == "A1B2C3D4" else "Invalid"})

    @on(Action.start_transaction)
    def start_transaction(self, connector_id, id_tag, meter_start, timestamp, **kwargs):
        return call_result.StartTransaction(
            transaction_id=100 + connector_id,
            id_tag_info={"status": "Accepted"})

    @on(Action.meter_values)
    def meter(self, connector_id, meter_value, **kwargs):
        return call_result.MeterValues()

    @on(Action.stop_transaction)
    def stop_transaction(self, transaction_id, meter_stop, timestamp, **kwargs):
        return call_result.StopTransaction()


class AdvancedOcppTests(unittest.IsolatedAsyncioTestCase):
    async def test_smart_charging_and_fault_status_over_socket(self):
        central_ready = asyncio.get_running_loop().create_future()
        events = []

        async def handler(ws, path):
            csms = MockCentral("CV-ADVANCED-01", ws)
            central_ready.set_result(csms)
            await csms.start()

        async with serve(handler, "127.0.0.1", 0, subprotocols=["ocpp1.6"]) as server:
            port = server.sockets[0].getsockname()[1]
            async with websockets.connect(
                f"ws://127.0.0.1:{port}/ocpp/CV-ADVANCED-01",
                subprotocols=["ocpp1.6"],
            ) as ws:
                master = InteractiveMaster("CV-ADVANCED-01", ws, 3,
                                           lambda *args: events.append(args))
                receiver = asyncio.create_task(master.start())
                try:
                    await master.boot()
                    csms = await asyncio.wait_for(central_ready, timeout=5)
                    for i in master.points:
                        await master.set_status(i, "Available")
                    response = await csms.call(call.SetChargingProfile(
                        connector_id=0,
                        cs_charging_profiles={
                            "charging_profile_id": 8, "stack_level": 0,
                            "charging_profile_purpose": "ChargePointMaxProfile",
                            "charging_profile_kind": "Relative",
                            "charging_schedule": {
                                "charging_rate_unit": "W",
                                "charging_schedule_period": [
                                    {"start_period": 0, "limit": 12000}
                                ],
                            },
                        }))
                    self.assertEqual(response.status, "Accepted")
                    active = {1: 101, 2: 102, 3: 103}
                    limits = [master.limits.effective(i, active) for i in active]
                    self.assertEqual(sum(x > 0 for x in limits), 2)
                    self.assertLessEqual(sum(limits), 12000)
                    response = await csms.call(call.GetCompositeSchedule(
                        connector_id=1, duration=120, charging_rate_unit="W"))
                    self.assertEqual(response.status, "Accepted")
                    self.assertEqual(response.charging_schedule["charging_schedule_period"][0]["limit"],
                                     11040)
                    # Above composite represents current active transactions:
                    # none have been started yet, so nominal 11.04 kW is correct.
                    response = await csms.call(call.ChangeConfiguration(
                        key="HeartbeatInterval", value="45"))
                    self.assertEqual(response.status, "Accepted")
                    response = await csms.call(call.GetConfiguration(
                        key=["HeartbeatInterval"]))
                    self.assertEqual(response.configuration_key[0]["value"], "45")
                    response = await csms.call(call.ClearChargingProfile(id=8))
                    self.assertEqual(response.status, "Accepted")
                    response = await csms.call(call.Reset(type="Soft"))
                    self.assertEqual(response.status, "Rejected")
                    await master.inject_status(2, "SuspendedEV", "NoError")
                    await master.inject_status(3, "Faulted", "HighTemperature")
                    self.assertIn(("point", 2, "SuspendedEV", False), events)
                    self.assertIn(("point", 3, "Faulted", False), events)
                finally:
                    receiver.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await receiver


if __name__ == "__main__":
    unittest.main()
