"""Local control panel for explicitly provisioned ChargeVisor test stations."""
import argparse
import asyncio
import base64
import json
import re
import threading
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from ocpp.v16 import ChargePoint, call
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus
from websockets.protocol import State


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label}: Ganze Zahl zwischen {minimum} und {maximum} eingeben.")
    return value


def tag_from(data):
    tag = data.get("tag", "CV-SIM-TEST")
    if not isinstance(tag, str) or not re.fullmatch(r"CV-SIM-TEST|SIM-[A-Z0-9_-]{1,16}", tag):
        raise ValueError("Testkarten-ID eingeben, zum Beispiel SIM-TEST01.")
    return tag


@dataclass
class Connector:
    status: str = "Available"
    wh: int = 1000
    transaction_id: int | None = None


class Wallbox:
    def __init__(self):
        self.identity = None
        self.url = None
        self.connectors = {}
        self.ws = None
        self.cp = None
        self.receiver = None
        self.heartbeat_task = None
        self.last_heartbeat = None
        self.lock = asyncio.Lock()

    def connected(self):
        return self.ws is not None and self.ws.state is State.OPEN

    def snapshot(self):
        return {
            "identity": self.identity,
            "connected": self.connected(),
            "lastHeartbeat": self.last_heartbeat,
            "connectors": [
                {"id": number, "status": point.status, "wh": point.wh,
                 "transactionId": point.transaction_id}
                for number, point in self.connectors.items()
            ],
        }

    async def request(self, payload):
        if not self.connected():
            raise ValueError("Test-Wallbox zuerst verbinden.")
        return await self.cp.call(payload, suppress=False)

    async def status(self, connector, status):
        error = "InternalError" if status == "Faulted" else "NoError"
        await self.request(call.StatusNotification(connector_id=connector, error_code=error, status=status))
        self.connectors[connector].status = status

    async def heartbeat(self):
        response = await self.request(call.Heartbeat())
        self.last_heartbeat = response.current_time
        return {"currentTime": self.last_heartbeat}

    async def keep_alive(self, interval):
        while self.connected():
            await asyncio.sleep(interval)
            async with self.lock:
                if self.connected():
                    try:
                        await self.heartbeat()
                    except Exception:
                        await self.ws.close()

    async def open(self, data):
        if self.connected():
            raise ValueError("Die Test-Wallbox ist bereits verbunden.")
        url, identity, password = (data.get(key) for key in ("url", "identity", "password"))
        if not all(isinstance(x, str) and x for x in (url, identity, password)):
            raise ValueError("OCPP-Adresse, ID und Passwort aus ChargeVisor eingeben.")
        endpoint = urlsplit(url)
        loopback = endpoint.hostname in ("127.0.0.1", "localhost", "::1")
        if (not endpoint.hostname or endpoint.username or endpoint.password or
                endpoint.query or endpoint.fragment or
                (endpoint.scheme != "wss" and not (endpoint.scheme == "ws" and loopback))):
            raise ValueError("Eine WSS-Adresse oder einen lokalen WS-Endpunkt eingeben.")
        if unquote(endpoint.path) != "/ocpp/" + identity or not re.fullmatch(r"[a-zA-Z0-9_.-]{2,120}", identity):
            raise ValueError("OCPP-Adresse und OCPP-ID müssen zur selben Test-Wallbox gehören.")
        count = integer(data.get("connectors", 1), 1, 16, "Connectoren")
        same_station = (self.identity, self.url, len(self.connectors)) == (identity, url, count)
        if not same_station and any(point.transaction_id is not None for point in self.connectors.values()):
            raise ValueError("Zum Beenden der offenen Ladevorgänge zuerst dieselbe Station erneut verbinden.")
        await self.close()
        token = base64.b64encode(f"{identity}:{password}".encode()).decode()
        try:
            self.ws = await connect(
                url, subprotocols=["ocpp1.6"], additional_headers={
                    "Authorization": f"Basic {token}",
                    "X-ChargeVisor-Test-Wallbox": "1",
                },
                open_timeout=6, close_timeout=2,
            )
        except InvalidStatus as exc:
            raise ValueError(f"OCPP-Verbindung abgelehnt (HTTP {exc.response.status_code}).") from exc
        try:
            if self.ws.subprotocol != "ocpp1.6":
                raise ValueError("Der Server hat OCPP 1.6J nicht ausgehandelt.")
            self.cp = ChargePoint(identity, self.ws, response_timeout=6)
            self.receiver = asyncio.create_task(self.cp.start())
            boot = await self.request(call.BootNotification(
                charge_point_vendor="The Mobility House", charge_point_model="ChargeVisor Virtual",
                firmware_version="interactive-1.0",
            ))
            if boot.status != "Accepted":
                raise ValueError(f"OCPP-Anmeldung: {boot.status}.")
            if not same_station:
                self.connectors = {number: Connector() for number in range(1, count + 1)}
            self.identity, self.url = identity, url
            for connector, point in self.connectors.items():
                if point.transaction_id is not None:
                    await self.stop(connector, "Other")
                else:
                    await self.status(connector, point.status)
            await self.heartbeat()
            self.heartbeat_task = asyncio.create_task(self.keep_alive(max(1, boot.interval)))
            return {"status": boot.status}
        except BaseException:
            await self.close()
            raise

    async def close(self):
        tasks = [task for task in (self.heartbeat_task, self.receiver) if task is not None]
        for task in tasks:
            task.cancel()
        if self.ws is not None:
            await self.ws.close()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.heartbeat_task = self.receiver = self.ws = self.cp = None

    async def authorize(self, tag):
        reply = await self.request(call.Authorize(id_tag=tag))
        return {"status": reply.id_tag_info["status"]}

    async def start(self, connector, tag):
        point = self.connectors[connector]
        if point.status != "Available" or point.transaction_id is not None:
            raise ValueError("Connector ist nicht zum Laden bereit.")
        auth = await self.authorize(tag)
        if auth["status"] != "Accepted":
            return auth
        await self.status(connector, "Preparing")
        reply = await self.request(call.StartTransaction(
            connector_id=connector, id_tag=tag, meter_start=point.wh, timestamp=timestamp(),
        ))
        status = reply.id_tag_info["status"]
        if status != "Accepted":
            await self.status(connector, "Available")
            return {"status": status}
        point.transaction_id = reply.transaction_id
        await self.status(connector, "Charging")
        return {"status": status, "transactionId": reply.transaction_id}

    async def meter(self, connector, wh):
        point = self.connectors[connector]
        if point.transaction_id is None:
            raise ValueError("Für Messwerte zuerst einen Ladevorgang starten.")
        value = integer(wh, point.wh, 2_147_483_647, "Zählerstand (Wh)")
        await self.request(call.MeterValues(
            connector_id=connector, transaction_id=point.transaction_id,
            meter_value=[{"timestamp": timestamp(), "sampledValue": [
                {"value": str(value), "measurand": "Energy.Active.Import.Register", "unit": "Wh"},
                {"value": "7200", "measurand": "Power.Active.Import", "unit": "W"},
            ]}],
        ))
        point.wh = value

    async def stop(self, connector, reason="Local"):
        point = self.connectors[connector]
        if point.transaction_id is None:
            raise ValueError("An diesem Connector ist kein Ladevorgang aktiv.")
        await self.request(call.StopTransaction(
            transaction_id=point.transaction_id, meter_stop=point.wh,
            timestamp=timestamp(), reason=reason,
        ))
        point.transaction_id = None
        await self.status(connector, "Finishing")
        await self.status(connector, "Available")

    async def command(self, data):
        if self.lock.locked():
            raise ValueError("Eine OCPP-Anfrage läuft bereits. Bitte erneut versuchen.")
        async with self.lock:
            action = data.get("action")
            if action == "connect":
                return await self.open(data)
            if action == "disconnect":
                return await self.close()
            if action == "heartbeat":
                return await self.heartbeat()
            if action == "authorize":
                return await self.authorize(tag_from(data))
            if not self.connected():
                raise ValueError("Test-Wallbox zuerst verbinden.")
            connector = data.get("connector")
            if type(connector) is not int or connector not in self.connectors:
                raise ValueError("Einen vorhandenen Connector auswählen.")
            if action == "start":
                return await self.start(connector, tag_from(data))
            if action == "meter":
                return await self.meter(connector, data.get("wh"))
            if action == "stop":
                return await self.stop(connector)
            if action == "fault":
                if self.connectors[connector].transaction_id is not None:
                    await self.stop(connector, "Other")
                return await self.status(connector, "Faulted")
            if action == "recover":
                if self.connectors[connector].status != "Faulted":
                    raise ValueError("Dieser Connector meldet keine Störung.")
                return await self.status(connector, "Available")
            raise ValueError("Unbekannte Aktion.")


def handler_for(loop, box, html, port):
    host = f"127.0.0.1:{port}"

    class PanelHandler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(5)
            super().setup()

        def log_message(self, *_):
            pass

        def respond(self, status, content, content_type="application/json"):
            body = content if isinstance(content, bytes) else json.dumps(content).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; "
                             "script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.headers.get("Host") != host:
                return self.respond(403, {"error": "Das Panel ist lokal auf 127.0.0.1 verfügbar."})
            if self.path == "/":
                return self.respond(200, html, "text/html; charset=utf-8")
            if self.path == "/api/state":
                state = asyncio.run_coroutine_threadsafe(self.state(), loop).result()
                return self.respond(200, {"state": state})
            self.respond(404, {"error": "Unbekannter Pfad."})

        async def state(self):
            return box.snapshot()

        async def execute(self, data):
            result = await box.command(data)
            return {"result": result, "state": box.snapshot()}

        def do_POST(self):
            if self.path != "/api/command":
                return self.respond(404, {"error": "Unbekannter Pfad."})
            if (self.headers.get("Host") != host or self.headers.get("Origin") != f"http://{host}" or
                    self.headers.get_content_type() != "application/json"):
                return self.respond(403, {"error": "Ungültige Herkunft oder Anfrage."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 8192:
                    raise ValueError("Ungültige Anfragegröße.")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("JSON-Objekt erwartet.")
                future = asyncio.run_coroutine_threadsafe(self.execute(data), loop)
                response = future.result()
            except ValueError as exc:
                return self.respond(400, {"error": str(exc)[:180]})
            except Exception as exc:
                return self.respond(502, {"error": f"OCPP-Anfrage fehlgeschlagen ({type(exc).__name__})."})
            self.respond(200, response)

    return PanelHandler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765, help="Lokaler Port des Bedienpanels")
    port = parser.parse_args().port
    if not 1 <= port <= 65535:
        parser.error("--port muss zwischen 1 und 65535 liegen")
    html = Path(__file__).with_suffix(".html").read_bytes()
    loop = asyncio.new_event_loop()
    box = Wallbox()
    with ThreadingHTTPServer(("127.0.0.1", port), handler_for(loop, box, html, port)) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"OCPP-Test-Wallbox auf http://127.0.0.1:{port}", flush=True)
        try:
            loop.run_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.shutdown()
            with suppress(Exception):
                loop.run_until_complete(box.close())
            loop.close()


if __name__ == "__main__":
    main()
