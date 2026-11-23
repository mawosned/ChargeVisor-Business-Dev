"""Firmware transport tests: genuine OCPP 1.6J WebSocket, no physical flash."""
import asyncio
import contextlib
import unittest
from datetime import datetime,timezone

import websockets
from websockets.legacy.server import serve
from ocpp.routing import on
from ocpp.v16 import ChargePoint,call,call_result
from ocpp.v16.enums import Action

from firmware_lifecycle import FirmwareLifecycle,approved_test_location,STAGES
from desktop_simulator import InteractiveMaster


class FirmwareCentral(ChargePoint):
    def __init__(self, identity, websocket):
        super().__init__(identity,websocket)
        self.statuses=[]
        self.versions=[]

    @on(Action.boot_notification)
    def boot(self,charge_point_vendor,charge_point_model,firmware_version=None,**kwargs):
        self.versions.append(firmware_version)
        return call_result.BootNotification(
            current_time=datetime.now(timezone.utc).isoformat(),
            interval=60,status="Accepted")

    @on(Action.firmware_status_notification)
    def firmware_status(self,status,**kwargs):
        self.statuses.append(status)
        return call_result.FirmwareStatusNotification()


class FirmwareSimulationTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_binary_fetch_and_invalid_location_or_active_job_fails(self):
        for url in ('file:///etc/passwd','http://host.invalid/fw.bin',
                    'https://x:y@host.invalid/fw.bin','https://host.invalid/fw.bin#secret'):
            self.assertFalse(approved_test_location(url))
        sent=[]
        emulator=FirmwareLifecycle(
            lambda req: sent.append(type(req).__name__),
            lambda msg: None,stage_pause=0.0)
        self.assertFalse(emulator.queue("https://example.invalid/fw.bin",can_run=False))
        self.assertFalse(emulator.queue("file:///etc/passwd"))
        self.assertEqual(sent,[])
        async def record(req):
            sent.append(type(req).__name__)
            return None
        emulator.send=record
        self.assertTrue(emulator.queue("https://example.invalid/fw.bin"))
        self.assertFalse(emulator.queue("https://example.invalid/second.bin"))
        await emulator.task
        self.assertEqual(sent,["FirmwareStatusNotification"]*4+["BootNotification"])

    async def test_independent_ocpp_socket_update_firmware_emits_full_status_and_new_boot(self):
        ready=asyncio.get_running_loop().create_future()
        events=[]
        async def handler(ws,path):
            central=FirmwareCentral("CV-FW-SIM-01",ws)
            ready.set_result(central)
            await central.start()
        async with serve(handler,"127.0.0.1",0,subprotocols=["ocpp1.6"]) as server:
            port=server.sockets[0].getsockname()[1]
            async with websockets.connect(
                f"ws://127.0.0.1:{port}/ocpp/CV-FW-SIM-01",
                subprotocols=["ocpp1.6"]) as ws:
                device=InteractiveMaster("CV-FW-SIM-01",ws,2,
                    lambda *args:events.append(args))
                receiver=asyncio.create_task(device.start())
                try:
                    central=await asyncio.wait_for(ready,3)
                    request=call.UpdateFirmware(
                        location="https://firmware.example.invalid/pilot.bin",
                        retrieve_date=datetime.now(timezone.utc).isoformat())
                    response=await asyncio.wait_for(central.call(request),5)
                    self.assertIsInstance(response,call_result.UpdateFirmware)
                    for _ in range(100):
                        if central.versions:break
                        await asyncio.sleep(0.05)
                    self.assertEqual(central.statuses,list(STAGES))
                    self.assertEqual(central.versions,["cv-sim-firmware-2.0"])
                    self.assertTrue(any("no binary flashed" in str(event)
                        for event in events))
                finally:
                    receiver.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await receiver

if __name__=="__main__":
    unittest.main()
