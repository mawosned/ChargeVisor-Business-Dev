"""Safe preflight for the independent simulated TCP power-cut scenario."""
import unittest

from power_cycle_scenario import run_scenario


class PowerCyclePreflightTests(unittest.IsolatedAsyncioTestCase):
    async def test_requires_a_scoped_backend_verifier_before_connecting(self):
        with self.assertRaisesRegex(RuntimeError, "verifier required"):
            await run_scenario(
                "ws://127.0.0.1:10000/ocpp/CV-TEST",
                "CV-TEST","do-not-use","VALIDTAG",1,None)
    async def test_does_not_accept_insecure_remote_url(self):
        with self.assertRaisesRegex(RuntimeError, "Remote targets require WSS"):
            await run_scenario(
                "ws://unsafe.example/ocpp/CV-TEST",
                "CV-TEST","do-not-use","VALIDTAG",1,
                type("Verifier",(),{"identity":"CV-TEST"})(),
                remote_test_station=True)
    async def test_validates_connector_range_without_network_calls(self):
        with self.assertRaisesRegex(RuntimeError, "Invalid test connector"):
            await run_scenario(
                "ws://127.0.0.1:10000/ocpp/CV-TEST",
                "CV-TEST","do-not-use","VALIDTAG",0,
                type("Verifier",(),{"identity":"CV-TEST"})())


if __name__=="__main__":
    unittest.main()
