"""Independent, third-party OCPP 1.6J client: The Mobility House 'ocpp' library.
Runs against a real Node/PG ChargeVisor server in GitHub Actions.
No production credentials or real customer devices are touched.
"""
import asyncio
import base64
import os
from datetime import datetime, timezone

from ocpp.v16 import ChargePoint
from ocpp.v16 import call
from websockets.asyncio.client import connect

ID = os.getenv("CV_CI_ID", "cvci000001")
PASSWORD = os.getenv("CV_CI_PASSWORD", "K7M4R8T2V9H3P6WA")
URL = os.getenv("CV_CI_WSS", f"ws://127.0.0.1:10000/ocpp/{ID}")


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def assert_status(response, expected, action):
    actual = getattr(response, "status", None)
    if actual != expected:
        raise AssertionError(f"{action} returned {actual}, expected {expected}")


async def main():
    token = base64.b64encode(f"{ID}:{PASSWORD}".encode()).decode()
    async with connect(
        URL,
        subprotocols=["ocpp1.6"],
        additional_headers={"Authorization": f"Basic {token}"},
        open_timeout=10,
        close_timeout=5,
    ) as websocket:
        cp = ChargePoint(ID, websocket)
        receiver = asyncio.create_task(cp.start())
        try:
            boot = await asyncio.wait_for(
                cp.call(call.BootNotification(
                    charge_point_vendor="Independent CI",
                    charge_point_model="OCPP Virtual Device",
                    firmware_version="python-1.0",
                )),
                timeout=10,
            )
            assert_status(boot, "Accepted", "BootNotification")
            await cp.call(call.Heartbeat())
            # Independent slave connector shares the same OCPP charge box identity.
            await cp.call(call.StatusNotification(
                connector_id=2, status="Available", error_code="NoError"))
            await cp.call(call.StatusNotification(
                connector_id=2, status="Faulted", error_code="InternalError"))
            await cp.call(call.StatusNotification(
                connector_id=2, status="Available", error_code="NoError"))
            for cycle in range(2):
                await cp.call(call.StatusNotification(
                    connector_id=1, status="Available", error_code="NoError"))
                await cp.call(call.StatusNotification(
                    connector_id=1, status="Preparing", error_code="NoError"))
                auth = await cp.call(call.Authorize(id_tag="CV-SIM-TEST"))
                auth_info = auth.id_tag_info
                assert (auth_info.get("status") if isinstance(auth_info, dict)
                        else auth_info.status) == "Accepted", "Simulation authorization rejected"
                meter_start = 1000 + cycle * 100
                started = await cp.call(call.StartTransaction(
                    connector_id=1, id_tag="CV-SIM-TEST", meter_start=meter_start,
                    timestamp=timestamp()))
                info = started.id_tag_info
                assert (info.get("status") if isinstance(info, dict) else info.status) == "Accepted"
                assert isinstance(started.transaction_id, int) and started.transaction_id > 0
                await cp.call(call.StatusNotification(
                    connector_id=1, status="Charging", error_code="NoError"))
                await cp.call(call.MeterValues(
                    connector_id=1,
                    transaction_id=started.transaction_id,
                    meter_value=[{
                        "timestamp": timestamp(),
                        "sampledValue": [
                            {"value": str(meter_start + 50), "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                            {"value": "7200", "measurand": "Power.Active.Import", "unit": "W"},
                        ],
                    }],
                ))
                await cp.call(call.Heartbeat())
                stop = call.StopTransaction(
                    transaction_id=started.transaction_id,
                    meter_stop=meter_start + 50,
                    timestamp=timestamp(),
                    reason="Local",
                    id_tag="CV-SIM-TEST",
                )
                await cp.call(stop, suppress=False)
                if cycle == 0:
                    # A lost response must allow an identical stop to be retried.
                    await cp.call(stop, suppress=False)
                await cp.call(call.StatusNotification(
                    connector_id=1, status="Finishing", error_code="NoError"))
                await cp.call(call.StatusNotification(
                    connector_id=1, status="Available", error_code="NoError"))
                print(f"Independent OCPP library completed charging session {cycle + 1}/2.")
            await cp.call(call.Heartbeat())
            print("Independent external simulator: 2 charging cycles over one authenticated WebSocket, all OCPP calls accepted.")
        finally:
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass


if __name__ == "__main__":
    asyncio.run(main())
