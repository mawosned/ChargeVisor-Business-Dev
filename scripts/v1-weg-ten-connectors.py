"""Real OCPP 1.6J WEG V1 regression: one master and ten connectors.

Independent The Mobility House WebSocket implementation ↔ ChargeVisor ↔
disposable PostgreSQL ↔ independent read-only backend verifier.

11.04 kW is the nominal THREE-PHASE wallbox capability, not the allocated
power. For the 30 kW test budget, six connectors report 5 kW each while four
are SuspendedEVSE. The simulator (not the ChargeVisor backend) assigns power:
this test must NEVER claim backend dynamic load balancing is proven.

Regular CI intentionally compresses waits to keep regressions fast; manually
dispatch the 60-second paced workflow to run the same transitions at realistic
spacing. Both modes use exactly the same actual OCPP WebSocket frames.
"""
import asyncio
import base64
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from ocpp.v16 import ChargePoint, call
from websockets.asyncio.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "ocpp-chain-simulator"))
from backend_verifier import BackendVerifier  # noqa: E402

ID = os.environ.get("CV_CI_ID", "cvci000001")
PASSWORD = os.environ.get("CV_CI_PASSWORD", "K7M4R8T2V9H3P6WA")
URL = os.environ.get("CV_SIM_WSS_BASE", "ws://127.0.0.1:10000/ocpp").rstrip("/") + "/" + ID

CONNECTORS = 10
NOMINAL_PER_WALLBOX_W = 11040
SITE_BUDGET_W = 30000
ALLOCATED_CHARGING_W = 5000
MAX_CHARGING_CONNECTORS = 6
PAUSE = int(os.environ.get("CV_V1_STEP_PAUSE_SECONDS", "0"))

if PAUSE not in (0, 60):
    raise ValueError("CV_V1_STEP_PAUSE_SECONDS must be 0 for fast CI or 60 for paced acceptance")
if os.environ.get("CV_ALLOW_CI_SEED") != "1":
    raise RuntimeError("Refusing to run outside disposable CI test environment")


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def status_of(response):
    info = response.id_tag_info
    return info.get("status") if isinstance(info, dict) else info.status


async def request(cp, payload, description):
    return await asyncio.wait_for(cp.call(payload, suppress=False), timeout=15)


async def status(cp, connector, value, error="NoError"):
    await request(cp, call.StatusNotification(
        connector_id=connector, status=value, error_code=error), "status")


async def meter(cp, connector, transaction, start, watts):
    await request(cp, call.MeterValues(
        connector_id=connector, transaction_id=transaction,
        meter_value=[{"timestamp": timestamp(), "sampledValue": [
            {"value":str(start + (10 if watts else 0)),
             "measurand":"Energy.Active.Import.Register", "unit":"Wh"},
            {"value":str(watts),"measurand":"Power.Active.Import","unit":"W"}
        ]}]),"meter")


def inspect_snapshot(data, transactions, charging, suspended, *, stopped=False):
    assert data["identity"] == ID
    points = {int(x["connector_id"]): x for x in data["connectors"]}
    sessions = {int(x["connector_id"]): x for x in data["sessions"]}
    assert len(points) >= CONNECTORS, "Not all ten connector states stored"
    assert len(sessions) == CONNECTORS, "Every connector must have its own transaction"
    assert len({str(x["id"]) for x in sessions.values()}) == CONNECTORS, "Duplicate transaction IDs"
    for connector, tx in transactions.items():
        sess = sessions[connector]
        assert str(sess["id"]) == str(tx), f"Connector {connector} transaction mismatch"
        assert (sess["stopped_at"] is not None) == stopped, f"Connector {connector} closure mismatch"
        if stopped:
            assert points[connector]["status"] == "Available", f"Connector {connector} not ready"
            continue
        expected = "Charging" if connector in charging else "SuspendedEVSE"
        assert points[connector]["status"] == expected, f"Connector {connector} status mismatch"
        assert int(points[connector]["power_w"] or 0) == (
            ALLOCATED_CHARGING_W if connector in charging else 0), (
            f"Connector {connector} power mismatch")
    if not stopped:
        assert len(charging) == MAX_CHARGING_CONNECTORS
        assert len(suspended) == CONNECTORS - MAX_CHARGING_CONNECTORS
        total = sum(int(points[c]["power_w"] or 0) for c in range(1, CONNECTORS + 1))
        assert total == SITE_BUDGET_W, f"Simulated total {total} W does not match 30 kW cap"


async def main():
    verifier = BackendVerifier.from_environment(ID)
    if verifier is None:
        raise RuntimeError("Independent backend verifier credentials are required")
    basic = base64.b64encode(f"{ID}:{PASSWORD}".encode()).decode("ascii")
    transactions = {}
    starts = {c:1000+c*100 for c in range(1,CONNECTORS+1)}
    charging = set()
    suspended = set()

    async with connect(URL, subprotocols=["ocpp1.6"],
                       additional_headers={"Authorization":"Basic "+basic},
                       open_timeout=15,close_timeout=5) as websocket:
        cp = ChargePoint(ID, websocket)
        receiver = asyncio.create_task(cp.start())
        async def transition_pause():
            if PAUSE:
                await asyncio.sleep(PAUSE)
        try:
            boot = await request(cp,call.BootNotification(
                charge_point_vendor="WEG CI Test",
                charge_point_model="WEG-10CP-11KW"),"boot")
            assert boot.status == "Accepted"
            await request(cp,call.Heartbeat(),"heartbeat")
            # Ramp up ten separate transactions one connector at a time.
            for connector in range(1,CONNECTORS+1):
                await status(cp,connector,"Available")
                await status(cp,connector,"Preparing")
                auth = await request(cp,call.Authorize(id_tag="CV-SIM-TEST"),"auth")
                assert status_of(auth) == "Accepted"
                start = await request(cp,call.StartTransaction(
                    connector_id=connector,id_tag="CV-SIM-TEST",
                    meter_start=starts[connector],timestamp=timestamp()),"start")
                assert status_of(start) == "Accepted"
                tx = start.transaction_id
                assert isinstance(tx,int) and tx > 0 and tx not in transactions.values()
                transactions[connector] = tx
                if connector <= MAX_CHARGING_CONNECTORS:
                    charging.add(connector)
                    state,watts="Charging",ALLOCATED_CHARGING_W
                else:
                    suspended.add(connector)
                    state,watts="SuspendedEVSE",0
                await status(cp,connector,state)
                await meter(cp,connector,tx,starts[connector],watts)
                await transition_pause()
            data = await asyncio.to_thread(verifier.snapshot)
            inspect_snapshot(data,transactions,charging,suspended)
            print("PASS: 10 independent active transactions, 6 charging, 4 SuspendedEVSE, total 30 kW reported")

            # Four places complete; previously suspended places resume.
            for outgoing,incoming in zip(range(1,5),range(7,11)):
                tx = transactions[outgoing]
                await request(cp,call.StopTransaction(
                    transaction_id=tx,meter_stop=starts[outgoing]+100,
                    timestamp=timestamp(),reason="Local"),"stop")
                await status(cp,outgoing,"Finishing")
                await status(cp,outgoing,"Available")
                charging.remove(outgoing)
                suspended.remove(incoming)
                charging.add(incoming)
                await status(cp,incoming,"Charging")
                await meter(cp,incoming,transactions[incoming],
                            starts[incoming],ALLOCATED_CHARGING_W)
                await transition_pause()
            data = await asyncio.to_thread(verifier.snapshot)
            points = {int(x["connector_id"]):x for x in data["connectors"]}
            assert charging == set(range(5,11))
            assert sum(int(points[c]["power_w"] or 0)
                       for c in charging) == SITE_BUDGET_W
            for c in range(1,5):
                closed = next(x for x in data["sessions"] if int(x["connector_id"])==c)
                assert closed["stopped_at"] is not None
            print("PASS: 4 suspended connectors resumed while site cap remains 30 kW")

            for connector in range(5,CONNECTORS+1):
                await request(cp,call.StopTransaction(
                    transaction_id=transactions[connector],
                    meter_stop=starts[connector]+100,
                    timestamp=timestamp(),reason="Local"),"stop")
                await status(cp,connector,"Finishing")
                await status(cp,connector,"Available")
                await transition_pause()
            snapshot = await asyncio.to_thread(verifier.snapshot)
            inspect_snapshot(snapshot,transactions,set(),set(),stopped=True)
            print("PASS: all ten independent charging sessions closed and backend persisted")

            await status(cp,4,"Faulted","OverCurrentFailure")
            await verifier.wait_for(4,status="Faulted",error_code="OverCurrentFailure",
                                    timeout_seconds=15)
            await transition_pause()
            await status(cp,4,"Available")
            await verifier.wait_for(4,status="Available",error_code="NoError",
                                    timeout_seconds=15)
            print("PASS: fault and recovery correctly persisted for one connector")
            print("NOTE: device-side 30 kW allocation ONLY; no CSMS DLM or legal billing claimed")
        finally:
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass


if __name__=="__main__":
    asyncio.run(main())
