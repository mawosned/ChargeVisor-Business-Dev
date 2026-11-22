import asyncio
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from backend_verifier import BackendVerifier, BackendEvidenceError


IDENTITY = "DEV-ONLY-CP-1"
TOKEN = "test-only-" + "A" * 50
URL = "https://test.example.com"
SAMPLE = {
    "identity": IDENTITY,
    "observed_at": "2026-11-22T19:00:00Z",
    "live": {"connected": True, "status": "Charging"},
    "connectors": [
        {"connector_id": 1, "status": "Charging", "error_code": "NoError", "power_w": 11040},
        {"connector_id": 2, "status": "Faulted", "error_code": "OverVoltage", "power_w": 0}
    ],
    "sessions": [
        {"id": 52, "connector_id": 1, "stopped_at": None},
        {"id": 42, "connector_id": 2, "stopped_at": "2026-11-22T19:00:00Z"}
    ],
    "events": []
}


class Response:
    def __init__(self, value):
        self.io = io.BytesIO(json.dumps(value).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.io.close()

    def read(self, count=-1):
        return self.io.read(count)


class TestVerifier(unittest.TestCase):
    def test_configuration_is_opt_in_and_accepts_private_token_file(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(BackendVerifier.from_environment(IDENTITY))
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "verifier-secret.txt"
            file.write_text(TOKEN, encoding="utf-8")
            with patch.dict(os.environ, {
                "CV_VERIFIER_URL": URL,
                "CV_VERIFIER_TOKEN_FILE": str(file)
            }, clear=True):
                v = BackendVerifier.from_environment(IDENTITY)
                self.assertEqual(v.token, TOKEN)
        with self.assertRaises(ValueError):
            BackendVerifier("http://untrusted.example.com", IDENTITY, TOKEN)

    def test_snapshot_scopes_identity_and_never_puts_token_in_url(self):
        def respond(req, timeout):
            self.assertEqual(req.method, "GET")
            self.assertEqual(req.get_header("Authorization"), "Bearer " + TOKEN)
            self.assertIn("identity=" + IDENTITY, req.full_url)
            self.assertNotIn(TOKEN, req.full_url)
            self.assertEqual(timeout, 10)
            return Response(SAMPLE)
        with patch("backend_verifier.urlopen", side_effect=respond):
            result = BackendVerifier(URL, IDENTITY, TOKEN).snapshot()
        self.assertEqual(result["connectors"][0]["power_w"], 11040)

    def test_http_failure_does_not_expose_secret(self):
        def fail(req, timeout):
            raise HTTPError(URL, 401, "Bad credentials", {}, None)
        with patch("backend_verifier.urlopen", side_effect=fail):
            with self.assertRaises(BackendEvidenceError) as ctx:
                BackendVerifier(URL, IDENTITY, TOKEN).snapshot()
        self.assertIn("401", str(ctx.exception))
        self.assertNotIn(TOKEN, str(ctx.exception))

    def test_status_fault_and_transaction_checks(self):
        self.assertTrue(BackendVerifier.matching(
            SAMPLE, 1, status="Charging", session_active=True, transaction_id=52,
            power_w=11040, power_tolerance=1))
        self.assertTrue(BackendVerifier.matching(
            SAMPLE, 2, status="Faulted", error_code="OverVoltage",
            session_active=False, transaction_id=42))
        self.assertFalse(BackendVerifier.matching(SAMPLE, 1, status="Available"))
        self.assertFalse(BackendVerifier.matching(SAMPLE, 2, session_active=True))
        self.assertFalse(BackendVerifier.matching(SAMPLE, 1, power_w=7200))
        self.assertFalse(BackendVerifier.matching(SAMPLE, 1, transaction_id=99))

    def test_async_wait_only_passes_with_matching_backend_evidence(self):
        verifier = BackendVerifier(URL, IDENTITY, TOKEN)
        with patch.object(verifier, "snapshot", return_value=SAMPLE):
            result = asyncio.run(verifier.wait_for(
                1, timeout_seconds=0.01, status="Charging", session_active=True))
        self.assertEqual(result["identity"], IDENTITY)
        with patch.object(verifier, "snapshot", return_value=SAMPLE):
            with self.assertRaises(BackendEvidenceError):
                asyncio.run(verifier.wait_for(
                    1, timeout_seconds=0.01, status="Available"))


if __name__ == "__main__":
    unittest.main()
