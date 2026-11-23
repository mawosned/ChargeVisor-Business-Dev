"""Additional firmware *PROTOCOL* simulation for the existing Windows GUI.

This code DOES NOT download binaries, flash hardware, verify signatures,
or prove that a real device would survive a failed update.
It intentionally simulates the OCPP 1.6 status lifecycle and later
BootNotification so ChargeVisor can be independently exercised.
"""
import asyncio
from urllib.parse import urlsplit

from ocpp.v16 import call


STAGES = ("Downloading", "Downloaded", "Installing", "Installed")
TARGET_VERSION = "cv-sim-firmware-2.0"


def approved_test_location(location):
    """Avoid treating a remote command's arbitrary URL as trusted input."""
    try:
        parts = urlsplit(location)
    except (ValueError, TypeError):
        return False
    return (parts.scheme == "https" and bool(parts.hostname)
            and not parts.username and not parts.password and not parts.fragment)


class FirmwareLifecycle:
    def __init__(self, send, log, *, stage_pause=0.1, target_version=TARGET_VERSION):
        self.send = send
        self.log = log
        self.stage_pause = stage_pause
        self.target_version = target_version
        self.task = None

    def queue(self, location, *, can_run=True):
        if self.task is not None and not self.task.done():
            return False
        if not approved_test_location(location) or not can_run:
            return False
        self.task = asyncio.create_task(self.run())
        return True

    async def run(self):
        # No file access or network fetch of the supplied firmware URL.
        for stage in STAGES:
            await asyncio.sleep(self.stage_pause)
            await self.send(call.FirmwareStatusNotification(status=stage))
            self.log("SIMULATED firmware " + stage + "; no binary flashed")
        await asyncio.sleep(self.stage_pause)
        await self.send(call.BootNotification(
            charge_point_vendor="Walectra",
            charge_point_model="CV Chain Sim",
            firmware_version=self.target_version
        ))
        self.log("SIMULATED firmware BootNotification " + self.target_version)
