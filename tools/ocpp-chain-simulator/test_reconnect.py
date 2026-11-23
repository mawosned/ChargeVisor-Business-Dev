"""Offline regression tests for OCPP desktop reconnection and sanitized diagnostics.

These tests do not connect to Render or write ChargeVisor production data.
"""
import asyncio
import ast
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_simulator import SimulatorApp


class FakeSimulator:
    def __init__(self):
        self.manual_disconnect = False
        self.connection_settings = ("wss://example.test/ocpp/CV-TEST", "CV-TEST", "PRIVATE_PASSWORD", 2, 16)
        self.calls = 0
        self.events = []

    def _notify(self, *message):
        self.events.append(message)

    def _transport_diagnostic(self, phase, detail=""):
        self.events.append(("diagnostic", phase, detail))

    async def _connect(self, *config):
        self.calls += 1
        if self.calls < 2:
            raise ConnectionError("temporary network failure")


class ReconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_connection_retries_and_recovers(self):
        fake = FakeSimulator()
        delays = []

        async def no_delay(seconds):
            delays.append(seconds)

        with patch("desktop_simulator.asyncio.sleep", no_delay):
            await SimulatorApp._retry_connection(fake)

        self.assertEqual(fake.calls, 2)
        self.assertEqual(delays, [2, 4])
        self.assertTrue(any(e[1] == "RECONNECT_ERROR" for e in fake.events
                            if e[0] == "diagnostic"))
        self.assertTrue(any(e[1] == "RECONNECT_SUCCESS" for e in fake.events
                            if e[0] == "diagnostic"))

    async def test_manual_disconnect_does_not_retry(self):
        fake = FakeSimulator()
        fake.manual_disconnect = True
        await SimulatorApp._retry_connection(fake)
        self.assertEqual(fake.calls, 0)


class TransportLogTests(unittest.TestCase):
    def test_transport_log_redacts_basic_auth_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            class Minimal:
                connection_settings = ("wss://example.test", "CV-TEST",
                                       "PRIVATE_PASSWORD", 2, 16)
                events = []
                def _notify(self, *event):
                    self.events.append(event)

            fake = Minimal()
            with patch("desktop_simulator.Path.home", return_value=Path(tmp)):
                SimulatorApp._transport_diagnostic(fake, "DISCONNECT",
                                                    "reason=PRIVATE_PASSWORD")
            log = (Path(tmp) / "ChargeVisor" / "ocpp-test-results" /
                   "simulator-transport.log").read_text(encoding="utf-8")
            self.assertIn("[REDACTED]", log)
            self.assertNotIn("PRIVATE_PASSWORD", log)

class StandardOcppHandshakeTests(unittest.TestCase):
    def test_handshake_uses_standard_ocpp_headers_only(self):
        """Real charging station identity must not require a special simulator flag."""
        source = (Path(__file__).resolve().parent /
                  "desktop_simulator.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        app = next(node for node in tree.body
                   if isinstance(node, ast.ClassDef) and node.name == "SimulatorApp")
        method = next(node for node in app.body
                      if isinstance(node, ast.AsyncFunctionDef) and node.name == "_connect")
        handshake = ast.get_source_segment(source, method)
        self.assertIn('extra_headers={"Authorization": "Basic " + auth}', handshake)
        self.assertIn('subprotocols=["ocpp1.6"]', handshake)
        self.assertNotIn("X-ChargeVisor-Test-Wallbox", handshake)
        self.assertNotIn("is_simulator", handshake)




if __name__ == "__main__":
    unittest.main()
