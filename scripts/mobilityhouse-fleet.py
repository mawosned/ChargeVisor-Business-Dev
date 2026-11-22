"""Independent OCPP 1.6J virtual charger using The Mobility House Python ocpp library.
Run OUTSIDE the ChargeVisor server with credentials for TEST-ONLY stations.
Environment: CV_SIM_WSS_BASE, CV_SIM_STATIONS_JSON; optional CV_SIM_DURATION_SECONDS.
See docs/mobilityhouse-simulator.md for deployment and security.
"""
import asyncio
import base64
import json
import logging
import os
import random
import signal
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

from ocpp.v16 import ChargePoint, call
from websockets.asyncio.client import connect

logging.basicConfig(level=logging.INFO, format="%(message)s")

def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def event(kind, **data):
    logging.info(json.dumps({"time": timestamp(), "event": kind, **data}))

def positive_env(key, default, minimum=0):
    value=float(os.getenv(key,default))
    if value < minimum: raise ValueError(key+" must be >= "+str(minimum))
    return value

def configuration():
    base=os.environ["CV_SIM_WSS_BASE"].rstrip("/")
    url=urlsplit(base)
    if not url.hostname or not url.path.endswith("/ocpp") or (
        url.scheme!="wss" and not (url.scheme=="ws" and url.hostname in ("localhost","127.0.0.1"))):
        raise ValueError("Use a valid wss:// endpoint ending in /ocpp; ws:// only localhost")
    if os.getenv("CV_ALLOW_CI_SEED")=="1" and os.getenv("CV_SIM_STATIONS_JSON") is None:
        stations=[{"id":os.getenv("CV_CI_ID","cvci000001"),"password":os.getenv("CV_CI_PASSWORD","K7M4R8T2V9H3P6WA"),"connectors":2}]
    else:
        stations=json.loads(os.environ["CV_SIM_STATIONS_JSON"])
    if not isinstance(stations,list) or not 1<=len(stations)<=50:
        raise ValueError("Supply 1-50 virtual stations")
    for station in stations:
        station_id=station["id"]
        if not isinstance(station_id,str) or not 1<len(station_id)<=120 or "/" in station_id or ":" in station_id:
            raise ValueError("Invalid station ID")
        if not isinstance(station["password"],str) or not station["password"]:
            raise ValueError("Missing test station password")
        if not 1<=int(station.get("connectors",1))<=16:
            raise ValueError("Connector count must be 1-16")
    if len({s["id"] for s in stations})!=len(stations):
        raise ValueError("Duplicate station identities")
    return base,stations

class VirtualWallbox:
    def __init__(self,base,config,stop,deadline):
        self.base,self.config,self.stop,self.deadline=base,config,stop,deadline
        self.id=config["id"];self.password=config["password"]
        self.connectors=int(config.get("connectors",1))
        self.idle=positive_env("CV_SIM_IDLE_SECONDS",25)
        self.charge=positive_env("CV_SIM_CHARGE_SECONDS",90,1)
        self.meter=positive_env("CV_SIM_METER_SECONDS",15,.1)
        self.heartbeat_seconds=positive_env("CV_SIM_HEARTBEAT_SECONDS",30,.5)
        self.reconnect_seconds=positive_env("CV_SIM_RECONNECT_SECONDS",5,.1)
        self.fault_every=int(os.getenv("CV_SIM_FAULT_EVERY","4"))
        self.energy={i:1000+i*100 for i in range(1,self.connectors+1)}
        self.active_transaction=None
        self.cycles=0;self.heartbeats=0;self.reconnects=0;self.errors=0

    def ending(self):
        return self.stop.is_set() or (self.deadline is not None and time.monotonic()>=self.deadline)

    async def pause(self,seconds):
        # A duration deadline must NOT interrupt an active transaction. Complete
        # StopTransaction first and stop between cycles, otherwise tests leave
        # orphaned charging sessions in the backend.
        if self.stop.is_set(): raise asyncio.CancelledError()
        try:
            await asyncio.wait_for(self.stop.wait(),timeout=seconds)
            raise asyncio.CancelledError()
        except TimeoutError:
            if self.stop.is_set():raise asyncio.CancelledError()

    async def request(self,cp,body,description):
        try:
            return await asyncio.wait_for(cp.call(body,suppress=False),timeout=15)
        except Exception as exc:
            raise RuntimeError(description+" failed: "+str(exc)) from exc

    async def status(self,cp,connector,status,error="NoError"):
        await self.request(cp,call.StatusNotification(
            connector_id=connector,status=status,error_code=error),"StatusNotification")
        event("status",station=self.id,connector=connector,status=status)

    async def heartbeats_loop(self,cp):
        while not self.ending():
            await self.pause(self.heartbeat_seconds)
            r=await self.request(cp,call.Heartbeat(),"Heartbeat")
            if not r.current_time:raise RuntimeError("Heartbeat returned no currentTime")
            self.heartbeats+=1
            event("heartbeat",station=self.id,count=self.heartbeats)

    async def stop_transaction(self,cp,reason):
        connector,transaction_id=self.active_transaction
        await self.request(cp,call.StopTransaction(
            transaction_id=transaction_id,meter_stop=self.energy[connector],
            timestamp=timestamp(),reason=reason,id_tag="CV-SIM-TEST"),"StopTransaction")
        self.active_transaction=None

    async def cycle(self,cp,connector):
        await self.status(cp,connector,"Available")
        await self.pause(self.idle)
        await self.status(cp,connector,"Preparing")
        auth=await self.request(cp,call.Authorize(id_tag="CV-SIM-TEST"),"Authorize")
        info=auth.id_tag_info
        if (info.get("status") if isinstance(info,dict) else info.status)!="Accepted":
            raise RuntimeError("Test-only authorization was rejected")
        start=self.energy[connector]
        tx=await self.request(cp,call.StartTransaction(
            connector_id=connector,id_tag="CV-SIM-TEST",meter_start=start,
            timestamp=timestamp()),"StartTransaction")
        inf=tx.id_tag_info
        if (inf.get("status") if isinstance(inf,dict) else inf.status)!="Accepted":
            raise RuntimeError("StartTransaction not accepted")
        if not isinstance(tx.transaction_id,int) or tx.transaction_id<=0:
            raise RuntimeError("Invalid transaction ID")
        self.active_transaction=(connector,tx.transaction_id)
        await self.status(cp,connector,"Charging")
        periods=max(1,round(self.charge/self.meter))
        for i in range(periods):
            await self.pause(self.charge/periods)
            self.energy[connector]+=max(1,round(11040*self.charge/periods/3600))
            await self.request(cp,call.MeterValues(
                connector_id=connector,transaction_id=tx.transaction_id,
                meter_value=[{"timestamp":timestamp(),"sampledValue":[
                    {"value":str(self.energy[connector]),"measurand":"Energy.Active.Import.Register","unit":"Wh"},
                    {"value":"11040","measurand":"Power.Active.Import","unit":"W"}]}]
            ),"MeterValues")
        await self.stop_transaction(cp,"Local")
        await self.status(cp,connector,"Finishing")
        await self.status(cp,connector,"Available")
        self.cycles+=1
        event("charging_complete",station=self.id,connector=connector,
              cycle=self.cycles,energy_wh=self.energy[connector]-start)
        if self.fault_every>0 and self.cycles%self.fault_every==0:
            await self.status(cp,connector,"Faulted","InternalError")
            await self.pause(2)
            await self.status(cp,connector,"Available")

    async def run(self):
        while not self.ending():
            token=base64.b64encode((self.id+":"+self.password).encode()).decode()
            url=self.base+"/"+quote(self.id,safe="")
            try:
                async with connect(url,subprotocols=["ocpp1.6"],
                    additional_headers={"Authorization":"Basic "+token},
                    open_timeout=15,close_timeout=5,ping_interval=20,ping_timeout=20) as websocket:
                    cp=ChargePoint(self.id,websocket)
                    receiver=asyncio.create_task(cp.start())
                    heartbeat=None
                    try:
                        boot=await self.request(cp,call.BootNotification(
                            charge_point_vendor="The Mobility House",
                            charge_point_model="ChargeVisor Virtual",
                            firmware_version="tmh-1.0"),"BootNotification")
                        if boot.status!="Accepted":raise RuntimeError("BootNotification rejected")
                        event("connected",station=self.id,connectors=self.connectors,
                              backend=urlsplit(self.base).hostname)
                        if self.active_transaction is not None:
                            connector,_=self.active_transaction
                            await self.stop_transaction(cp,"Other")
                            await self.status(cp,connector,"Available")
                        heartbeat=asyncio.create_task(self.heartbeats_loop(cp))
                        while not self.ending():
                            for connector in range(1,self.connectors+1):
                                if receiver.done(): raise RuntimeError("Connection closed")
                                if heartbeat.done(): await heartbeat
                                await self.cycle(cp,connector)
                                if self.ending():break
                    finally:
                        if heartbeat:
                            heartbeat.cancel()
                            await asyncio.gather(heartbeat,return_exceptions=True)
                        receiver.cancel()
                        await asyncio.gather(receiver,return_exceptions=True)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.errors+=1
                event("error",station=self.id,error_type=type(exc).__name__,
                      detail=str(exc)[:170],errors=self.errors)
            if not self.ending():
                self.reconnects+=1
                event("reconnecting",station=self.id,attempt=self.reconnects)
                try:await self.pause(self.reconnect_seconds+random.random())
                except asyncio.CancelledError:break
        result={"station":self.id,"cycles":self.cycles,"heartbeats":self.heartbeats,
                "reconnects":self.reconnects,"errors":self.errors}
        event("station_finished",**result)
        return result

async def main():
    base,stations=configuration()
    duration=positive_env("CV_SIM_DURATION_SECONDS",0)
    stop=asyncio.Event()
    loop=asyncio.get_running_loop()
    for name in ("SIGTERM","SIGINT"):
        s=getattr(signal,name,None)
        if s is not None:
            try:loop.add_signal_handler(s,stop.set)
            except NotImplementedError:pass
    deadline=time.monotonic()+duration if duration>0 else None
    event("fleet_start",station_count=len(stations),target=urlsplit(base).hostname,
          duration_seconds=duration)
    results=await asyncio.gather(*(
        VirtualWallbox(base,item,stop,deadline).run() for item in stations))
    event("fleet_finished",results=results)
    if duration and any(r["cycles"]==0 or r["heartbeats"]==0 or r["errors"]>0 for r in results):
        raise SystemExit(1)

if __name__=="__main__":
    asyncio.run(main())
