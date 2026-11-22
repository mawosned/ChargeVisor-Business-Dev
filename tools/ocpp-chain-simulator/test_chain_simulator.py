"""Real OCPP-over-WebSocket protocol self-test; no Render or database required.

This verifies the simulator itself against an independent Mobility House CSMS.
It does NOT claim to test the ChargeVisor backend until a provisioned test
station is used with chain_simulator.py against ChargeVisor.
"""
import asyncio
import contextlib
import unittest
from datetime import datetime, timezone

import websockets
from websockets.legacy.server import serve
from ocpp.routing import on
from ocpp.v16 import ChargePoint as CentralChargePoint, call_result
from ocpp.v16.enums import Action

from chain_simulator import ChainMaster, run_chain, validate_url


class FakeCentralSystem(CentralChargePoint):
    def __init__(self, identity, connection):
        super().__init__(identity, connection)
        self.starts = {}
        self.meters = []
        self.stops = []
        self.statuses = []
        self.next_tx = 100

    @on(Action.boot_notification)
    def boot(self, charge_point_vendor, charge_point_model, **kwargs):
        # OCPP 1.6J BootNotification schema limits both identifiers to 20 chars.
        assert len(charge_point_vendor) <= 20
        assert len(charge_point_model) <= 20
        return call_result.BootNotification(
            current_time=datetime.now(timezone.utc).isoformat(),
            interval=60, status="Accepted"
        )

    @on(Action.heartbeat)
    def heartbeat(self):
        return call_result.Heartbeat(
            current_time=datetime.now(timezone.utc).isoformat()
        )

    @on(Action.status_notification)
    def status(self, connector_id, error_code, status, **kwargs):
        self.statuses.append((connector_id, status))
        return call_result.StatusNotification()

    @on(Action.authorize)
    def authorize(self, id_tag):
        return call_result.Authorize(
            id_tag_info={"status": "Accepted" if id_tag == "CV-SIM-TEST" else "Invalid"}
        )

    @on(Action.start_transaction)
    def start_tx(self, connector_id, id_tag, meter_start, timestamp, **kwargs):
        self.next_tx += 1
        self.starts[self.next_tx] = (connector_id, meter_start)
        return call_result.StartTransaction(
            transaction_id=self.next_tx, id_tag_info={"status": "Accepted"}
        )

    @on(Action.meter_values)
    def meter_values(self, connector_id, meter_value, transaction_id=None, **kwargs):
        if transaction_id not in self.starts:
            raise ValueError("Unknown transaction")
        if self.starts[transaction_id][0] != connector_id:
            raise ValueError("Cross-connector meter leak")
        self.meters.append((connector_id, transaction_id))
        return call_result.MeterValues()

    @on(Action.stop_transaction)
    def stop_tx(self, transaction_id, meter_stop, timestamp, **kwargs):
        if transaction_id not in self.starts:
            raise ValueError("Unknown transaction")
        self.stops.append((transaction_id, meter_stop))
        return call_result.StopTransaction(id_tag_info={"status": "Accepted"})


class TestChain(unittest.IsolatedAsyncioTestCase):
    async def test_one_websocket_six_connectors_two_cycles(self):
        sessions = []

        async def handler(websocket, path):
            central = FakeCentralSystem("CV-CHAIN-TEST", websocket)
            sessions.append(central)
            await central.start()

        async with serve(handler, "127.0.0.1", 0, subprotocols=["ocpp1.6"]) as server:
            port = server.sockets[0].getsockname()[1]
            async with websockets.connect(
                f"ws://127.0.0.1:{port}/ocpp/CV-CHAIN-TEST",
                subprotocols=["ocpp1.6"],
            ) as socket:
                master = ChainMaster("CV-CHAIN-TEST", socket)
                receiver = asyncio.create_task(master.start())
                try:
                    result = await run_chain(
                        master, connectors=6, rounds=2, steps=2,
                        interval=0, id_tag="CV-SIM-TEST"
                    )
                    self.assertEqual(result["transactions"], 12)
                finally:
                    receiver.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await receiver

        self.assertEqual(len(sessions), 1, "Master must use only one WebSocket")
        csms = sessions[0]
        self.assertEqual(len(csms.starts), 12)
        self.assertEqual(len(csms.stops), 12)
        self.assertEqual(len(csms.meters), 24)
        self.assertEqual(set(cid for cid, _ in csms.starts.values()), set(range(1, 7)))
        self.assertEqual(set(tx for tx, _ in csms.stops), set(csms.starts))
        for connector in range(1, 7):
            self.assertIn((connector, "Charging"), csms.statuses)
            self.assertIn((connector, "Available"), csms.statuses)

    def test_remote_requires_explicit_opt_in_and_tls(self):
        for url, opt_in in [
            ("ws://example.com/ocpp/TEST", False),
            ("ws://example.com/ocpp/TEST", True),
            ("wss://example.com/ocpp/WRONG", True),
        ]:
            with self.assertRaises(RuntimeError):
                validate_url(url, "TEST", opt_in)
        validate_url("wss://example.com/ocpp/TEST", "TEST", True)
        validate_url("ws://localhost:10000/ocpp/TEST", "TEST", False)


if __name__ == "__main__":
    unittest.main()
