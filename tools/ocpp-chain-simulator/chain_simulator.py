"""Independent OCPP 1.6J master/slave chain simulator for ChargeVisor.

One WebSocket = one charge point identity; connectors 1..N model independent
wallboxes behind a master (CAN/Mesh is abstracted, not electrically emulated).
"""
import argparse
import asyncio
import base64
import contextlib
import os
from datetime import datetime, timezone
from urllib.parse import urlsplit

import websockets
from ocpp.v16 import ChargePoint as Ocpp16ChargePoint, call


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def value_of(status):
    return getattr(status, "value", status)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class ChainMaster(Ocpp16ChargePoint):
    """A single OCPP client advertising N independent connectors."""

    async def boot(self):
        reply = await self.call(call.BootNotification(
            charge_point_vendor="Walectra",
            charge_point_model="CV Chain Sim",
            firmware_version="chain-simulator-1.0",
        ))
        require(value_of(reply.status) == "Accepted", "BootNotification rejected")
        await self.call(call.Heartbeat())

    async def set_status(self, connector, status):
        await self.call(call.StatusNotification(
            connector_id=connector, status=status, error_code="NoError"
        ))

    async def charge(self, connector, meter_start, id_tag, steps, interval):
        await self.set_status(connector, "Preparing")
        authorization = await self.call(call.Authorize(id_tag=id_tag))
        require(value_of(authorization.id_tag_info["status"]) == "Accepted",
                f"Connector {connector}: RFID authorization rejected")
        started = await self.call(call.StartTransaction(
            connector_id=connector, id_tag=id_tag, meter_start=meter_start,
            timestamp=timestamp()
        ))
        require(value_of(started.id_tag_info["status"]) == "Accepted"
                and isinstance(started.transaction_id, int)
                and started.transaction_id > 0,
                f"Connector {connector}: StartTransaction rejected")
        tx_id = started.transaction_id
        await self.set_status(connector, "Charging")
        meter_end = meter_start
        for _ in range(steps):
            if interval:
                await asyncio.sleep(interval)
            meter_end += 50
            await self.call(call.MeterValues(
                connector_id=connector, transaction_id=tx_id,
                meter_value=[{"timestamp": timestamp(), "sampledValue": [
                    {"value": str(meter_end), "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                    {"value": "7200", "measurand": "Power.Active.Import", "unit": "W"},
                ]}]
            ))
        await self.call(call.StopTransaction(
            transaction_id=tx_id, meter_stop=meter_end,
            timestamp=timestamp(), reason="Local", id_tag=id_tag
        ))
        await self.set_status(connector, "Finishing")
        await self.set_status(connector, "Available")
        return tx_id, meter_end


async def run_chain(master, connectors=6, rounds=1, steps=2, interval=0, id_tag="CV-SIM-TEST"):
    """Verify simultaneous, independent sessions over a SINGLE connection."""
    require(1 <= connectors <= 128, "connectors must be 1..128")
    require(1 <= rounds <= 100 and 1 <= steps <= 100, "invalid rounds/steps")
    await master.boot()
    await asyncio.gather(*(master.set_status(i, "Available")
                           for i in range(1, connectors + 1)))
    meters = {i: i * 1000 for i in range(1, connectors + 1)}
    all_ids = set()
    for cycle in range(rounds):
        results = await asyncio.gather(*(
            master.charge(i, meters[i], id_tag, steps, interval)
            for i in range(1, connectors + 1)
        ))
        ids = [tx for tx, _ in results]
        require(len(set(ids)) == len(ids) and not any(i in all_ids for i in ids),
                "Transaction IDs are shared/reused across connectors")
        all_ids.update(ids)
        meters.update({i: result[1] for i, result in enumerate(results, start=1)})
        print(f"PASS cycle {cycle + 1}: {connectors} independent connectors, "
              f"{len(ids)} transactions, 1 OCPP connection", flush=True)
    return {"connectors": connectors, "rounds": rounds, "transactions": len(all_ids)}


def validate_url(url, identity, remote_test_station):
    p = urlsplit(url)
    require(p.scheme in ("ws", "wss") and p.hostname, "Expected ws:// or wss:// URL")
    require(p.path.rstrip("/").endswith("/" + identity),
            "URL must end in /ocpp/<your OCPP identity>")
    local = p.hostname.lower() in ("localhost", "127.0.0.1", "::1")
    require(local or (remote_test_station and p.scheme == "wss"),
            "Remote targets require WSS and --remote-test-station. NEVER use production.")
    return p


async def connect_and_run(args):
    validate_url(args.url, args.identity, args.remote_test_station)
    require(bool(args.password), "CV_SIM_PASSWORD must contain test-station password")
    token = base64.b64encode(f"{args.identity}:{args.password}".encode()).decode()
    async with websockets.connect(
        args.url, subprotocols=["ocpp1.6"],
        extra_headers={"Authorization": "Basic " + token},
        open_timeout=15, ping_interval=20, close_timeout=3,
    ) as websocket:
        require(websocket.subprotocol == "ocpp1.6", "Server did not negotiate ocpp1.6")
        master = ChainMaster(args.identity, websocket)
        receiver = asyncio.create_task(master.start())
        try:
            outcome = await run_chain(master, args.connectors, args.rounds,
                                      args.steps, args.interval, args.id_tag)
            require(not receiver.done(), "OCPP receiver unexpectedly stopped")
            return outcome
        finally:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.getenv("CV_SIM_URL"),
                        help="Full OCPP websocket URL ending in /<identity>")
    parser.add_argument("--identity", default=os.getenv("CV_SIM_ID"))
    parser.add_argument("--connectors", type=int, default=6)
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--steps", type=int, default=2)
    parser.add_argument("--interval", type=float, default=0.1)
    parser.add_argument("--id-tag", default=os.getenv("CV_SIM_ID_TAG"))
    parser.add_argument("--remote-test-station", action="store_true",
                        help="Explicitly allow WSS to a provisioned TEST station only")
    args = parser.parse_args()
    args.password = os.getenv("CV_SIM_PASSWORD")
    if not args.id_tag:
        parser.error("Provide --id-tag or CV_SIM_ID_TAG: assigned RFID UID or enabled CV-FREECHARGE")
    if not args.url or not args.identity:
        parser.error("CV_SIM_URL and CV_SIM_ID (or --url and --identity) are required")
    if args.interval < 0:
        parser.error("--interval cannot be negative")
    try:
        result = asyncio.run(connect_and_run(args))
        print("PASS chain complete:", result)
    except Exception as exc:
        parser.exit(1, f"FAIL chain: {exc}\n")


if __name__ == "__main__":
    main()
