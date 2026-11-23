"""Automated OCPP power-cut/reconnect test for an ISOLATED simulator station.

Reproduces abrupt TCP loss while charging, persisted open transaction,
reconnect with a new ChargePoint instance, and PowerLoss StopTransaction.
No real mains voltage is switched. Requires the independently configured
simulator-only, read-only backend verifier before connecting.
"""
import argparse
import asyncio
import base64
import contextlib
import os

from websockets.asyncio.client import connect
from ocpp.v16 import call

from backend_verifier import BackendVerifier
from chain_simulator import ChainMaster,require,timestamp,validate_url,value_of


async def run_scenario(url,identity,password,id_tag,connector,verifier,
                       remote_test_station=False):
    validate_url(url,identity,remote_test_station)
    require(bool(password) and 1<=len(id_tag)<=20,"Missing test-only credentials or RFID")
    require(isinstance(connector,int) and 1<=connector<=20,"Invalid test connector")
    require(verifier is not None and verifier.identity==identity,
            "Independent scoped simulator-only verifier required")
    basic=base64.b64encode((identity+":"+password).encode()).decode("ascii")
    options=dict(subprotocols=["ocpp1.6"],
      additional_headers={"Authorization":"Basic "+basic},
      open_timeout=15,ping_interval=20,close_timeout=3)

    meter_start=8000+100*connector
    tx_id=None
    async with connect(url,**options) as ws:
        cp=ChainMaster(identity,ws)
        recv=asyncio.create_task(cp.start())
        try:
            await cp.boot()
            await cp.set_status(connector,"Available")
            await cp.set_status(connector,"Preparing")
            auth=await cp.call(call.Authorize(id_tag=id_tag))
            require(value_of(auth.id_tag_info["status"])=="Accepted",
                    "Test RFID was not accepted")
            start=await cp.call(call.StartTransaction(
                connector_id=connector,id_tag=id_tag,meter_start=meter_start,
                timestamp=timestamp()))
            require(value_of(start.id_tag_info["status"])=="Accepted" and
                    isinstance(start.transaction_id,int) and start.transaction_id>0,
                    "Test transaction failed")
            tx_id=start.transaction_id
            await cp.set_status(connector,"Charging")
            await cp.call(call.MeterValues(
                connector_id=connector,transaction_id=tx_id,
                meter_value=[{"timestamp":timestamp(),"sampledValue":[
                    {"value":str(meter_start+75),
                     "measurand":"Energy.Active.Import.Register","unit":"Wh"},
                    {"value":"11040","measurand":"Power.Active.Import","unit":"W"}
                ]}]))
            await verifier.wait_for(connector,session_active=True,
                                    transaction_id=tx_id,timeout_seconds=15)
            # Abort TCP rather than a clean OCPP StopTransaction.
            ws.transport.abort()
            await asyncio.sleep(0.1)
        finally:
            recv.cancel()
            with contextlib.suppress(asyncio.CancelledError,Exception):
                await recv
    # Device firmware must remember tx_id; test process preserves it.
    # Absence of StopTransaction is an UNCONFIRMED, not billable session.
    await verifier.wait_for(connector,session_active=True,
                            transaction_id=tx_id,timeout_seconds=15)

    async with connect(url,**options) as ws:
        cp=ChainMaster(identity,ws)
        recv=asyncio.create_task(cp.start())
        try:
            await cp.boot()
            await cp.call(call.StopTransaction(
                transaction_id=tx_id,meter_stop=meter_start+150,
                timestamp=timestamp(),reason="PowerLoss"))
            await cp.set_status(connector,"Available")
            await verifier.wait_for(connector,status="Available",
                                    session_active=False,transaction_id=tx_id,
                                    timeout_seconds=15)
        finally:
            recv.cancel()
            with contextlib.suppress(asyncio.CancelledError,Exception):
                await recv
    return {"result":"PASS","connector":connector,
      "stop_reason":"PowerLoss","backend_evidence":True,
      "limitations":"TCP/power-cut protocol only; physical device restart not proved"}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url",default=os.environ.get("CV_SIM_URL"))
    parser.add_argument("--identity",default=os.environ.get("CV_SIM_ID"))
    parser.add_argument("--connector",type=int,default=1)
    parser.add_argument("--id-tag",default=os.environ.get("CV_SIM_ID_TAG"))
    parser.add_argument("--remote-test-station",action="store_true")
    args=parser.parse_args()
    if os.environ.get("CV_ALLOW_SIMULATED_POWER_CUT")!="1":
        parser.error("CV_ALLOW_SIMULATED_POWER_CUT=1 required to use an isolated test station")
    if not args.url or not args.identity or not args.id_tag:
        parser.error("CV_SIM_URL, CV_SIM_ID and CV_SIM_ID_TAG are required")
    verifier=BackendVerifier.from_environment(args.identity)
    if verifier is None:
        parser.error("Set the permanent read-only test-only backend verifier token first")
    try:
        result=asyncio.run(run_scenario(
            args.url,args.identity,os.environ.get("CV_SIM_PASSWORD",""),
            args.id_tag,args.connector,verifier,args.remote_test_station))
        print(result)
    except Exception as exc:
        parser.exit(1,"FAIL simulated power cycle: "+type(exc).__name__+
                    ": "+str(exc)[:150]+"\n")


if __name__=="__main__":
    main()
