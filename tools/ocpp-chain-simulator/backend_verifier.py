"""Independent, permanently configured read-only ChargeVisor state checker.

Use ONLY with a test-only ChargeVisor tenant and an explicitly simulated station.
The REST token is read from the process environment or a private local file,
never embedded in source control, URLs or exported reports.
"""
import asyncio
import json
import os
from pathlib import Path
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class BackendEvidenceError(RuntimeError):
    pass


class BackendVerifier:
    def __init__(self, url, identity, token, timeout=10):
        if not url.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
            raise ValueError("Verifier URL must use HTTPS, or loopback for tests")
        if not identity or not token or len(token) < 40:
            raise ValueError("Verifier identity and long bearer token are required")
        self.url = url.rstrip("/")
        self.identity = identity
        self.token = token.strip()
        self.timeout = timeout

    @classmethod
    def from_environment(cls, identity):
        url = os.environ.get("CV_VERIFIER_URL", "").strip()
        token = os.environ.get("CV_VERIFIER_TOKEN", "").strip()
        token_path = os.environ.get("CV_VERIFIER_TOKEN_FILE", "").strip()
        if token_path and not token:
            token = Path(token_path).read_text(encoding="utf-8").strip()
        if not url and not token:
            return None
        if not url or not token:
            raise ValueError("Set both CV_VERIFIER_URL and CV_VERIFIER_TOKEN or TOKEN_FILE")
        return cls(url, identity, token)

    def snapshot(self):
        path = (self.url + "/api/ocpp/test-verification?" +
                urlencode({"identity": self.identity, "limit": 100}))
        request = Request(path, headers={
            "Authorization": "Bearer " + self.token,
            "Accept": "application/json"
        }, method="GET")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read(256 * 1024).decode("utf-8"))
        except HTTPError as exc:
            raise BackendEvidenceError("Verifier HTTP " + str(exc.code)) from None
        except (URLError, TimeoutError) as exc:
            raise BackendEvidenceError("Verifier HTTP not reachable: " +
                                       type(exc).__name__) from None
        except (ValueError, UnicodeError) as exc:
            raise BackendEvidenceError("Verifier returned invalid JSON") from exc
        if data.get("identity") != self.identity:
            raise BackendEvidenceError("Verifier returned data for another OCPP identity")
        if not isinstance(data.get("connectors"), list) or not isinstance(data.get("sessions"), list):
            raise BackendEvidenceError("Verifier response missing connector/session evidence")
        return data

    @staticmethod
    def matching(data, connector, *, status=None, error_code=None,
                 session_active=None, transaction_id=None, power_w=None, power_tolerance=1):
        point = next((p for p in data["connectors"]
                      if int(p.get("connector_id") or 0) == connector), None)
        if status is not None and (point is None or point.get("status") != status):
            return False
        if error_code is not None and (point is None or point.get("error_code") != error_code):
            return False
        if power_w is not None and (
                point is None or point.get("power_w") is None or
                abs(float(point["power_w"]) - power_w) > power_tolerance):
            return False
        if session_active is not None or transaction_id is not None:
            sessions = [x for x in data["sessions"]
                        if int(x.get("connector_id") or 0) == connector]
            if transaction_id is not None:
                sessions = [x for x in sessions if str(x.get("id")) == str(transaction_id)]
            if session_active is True and not any(x.get("stopped_at") is None for x in sessions):
                return False
            if session_active is False:
                if transaction_id is not None:
                    if not sessions or not all(x.get("stopped_at") is not None for x in sessions):
                        return False
                elif any(x.get("stopped_at") is None for x in sessions):
                    return False
            if transaction_id is not None and not sessions:
                return False
        return True

    async def wait_for(self, connector, *, timeout_seconds=15, **expected):
        deadline = monotonic() + timeout_seconds
        last = None
        while True:
            last = await asyncio.to_thread(self.snapshot)
            if self.matching(last, connector, **expected):
                return last
            if monotonic() >= deadline:
                raise BackendEvidenceError(
                    "Backend result did not match expected status/session/power " +
                    "after " + str(timeout_seconds) + "s for connector " + str(connector))
            await asyncio.sleep(min(1.0, max(0.0, deadline - monotonic())))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Verify ChargeVisor simulator-only backend state")
    parser.add_argument("--identity", required=True, help="Provisioned test OCPP identity")
    parser.add_argument("--connector", required=True, type=int, help="Connector number")
    parser.add_argument("--status", help="Expected OCPP connector status")
    parser.add_argument("--error-code", help="Expected OCPP error code")
    args = parser.parse_args()
    verifier = BackendVerifier.from_environment(args.identity)
    if verifier is None:
        parser.error("Set CV_VERIFIER_URL and CV_VERIFIER_TOKEN / CV_VERIFIER_TOKEN_FILE")
    async def main():
        result = await verifier.wait_for(
            args.connector, status=args.status, error_code=args.error_code)
        print(json.dumps({
            "verdict": "PASS", "identity": result["identity"],
            "connector": args.connector, "observed_at": result["observed_at"]
        }, ensure_ascii=False))
    asyncio.run(main())
