"""Tests of audit semantics; no network, no desktop, no Render required."""
import csv
import json
import tempfile
import unittest
from pathlib import Path

from ocpp_coverage import AuditStore, CATALOG, code_assessment


class CoverageTests(unittest.TestCase):
    def test_catalog_covers_16j_states_faults_and_smart_charging(self):
        required = [
            "CP.BootNotification", "CP.Authorize", "CP.StartTransaction",
            "CP.MeterValues", "CP.StopTransaction", "CSMS.SetChargingProfile",
            "CSMS.ClearChargingProfile", "CSMS.Reset", "CSMS.GetDiagnostics",
            "CSMS.ReserveNow", "STATUS.SuspendedEV", "STATUS.SuspendedEVSE",
            "STATUS.Faulted", "ERROR.OverCurrentFailure",
            "ERROR.HighTemperature", "ERROR.GroundFailure",
            "SCENARIO.Load.TenWallboxes", "SCENARIO.Load.SetPoint",
        ]
        self.assertGreaterEqual(len(CATALOG), 70)
        for case in required:
            self.assertIn(case, CATALOG)
            self.assertTrue(CATALOG[case]["expected"])

    def test_source_review_does_not_claim_full_load_balancing(self):
        self.assertIn("Teilweise", code_assessment("CSMS.SetChargingProfile"))
        self.assertIn("nicht gefunden", code_assessment("CSMS.ReserveNow").lower())
        self.assertIn("Backend", code_assessment("CP.MeterValues"))

    def test_protocol_ack_is_not_a_pass_and_result_persists(self):
        with tempfile.TemporaryDirectory() as temp:
            a = AuditStore("UNIQUE-ID-01", base_dir=temp)
            self.assertEqual(a.status("STATUS.Faulted"), "NOT_TESTED")
            a.mark("STATUS.Faulted", "PROTOCOL_OK",
                   "StatusNotification Faulted/HighTemperature ACK", 2)
            self.assertEqual(a.summary()["PASS"], 0)
            self.assertEqual(a.summary()["PROTOCOL_OK"], 1)
            self.assertEqual(AuditStore("UNIQUE-ID-01", base_dir=temp).
                             status("STATUS.Faulted"), "PROTOCOL_OK")
            a.mark("STATUS.Faulted", "PASS", "Frontend fault visible", 2,
                   "Ladepunkt 2 Faulted/HighTemperature im Dashboard bestätigt", "Reviewer")
            self.assertEqual(a.summary()["PASS"], 1)
            self.assertEqual(a.summary()["PROTOCOL_OK"], 0)

    def test_pass_requires_explicit_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            a = AuditStore("x", base_dir=temp)
            with self.assertRaises(ValueError):
                a.mark("CP.Heartbeat", "PASS", "ACK")
            with self.assertRaises(ValueError):
                a.mark("UNKNOWN", "NOT_TESTED", "none")
            with self.assertRaises(ValueError):
                a.mark("CP.Heartbeat", "FAKE", "ACK")

    def test_export_json_csv_contains_coverage_and_no_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            a = AuditStore("MY-TEST-CHARGER", base_dir=temp)
            a.mark("CP.Heartbeat", "PROTOCOL_OK", "Heartbeat ACK", 1)
            file_json = a.export("json", Path(temp) / "result.json")
            parsed = json.loads(file_json.read_text(encoding="utf-8"))
            self.assertEqual(parsed["summary"]["PROTOCOL_OK"], 1)
            self.assertTrue(any(item["id"] == "CP.Heartbeat" for item in parsed["cases"]))
            file_csv = a.export("csv", Path(temp) / "result.csv")
            with file_csv.open(encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle, delimiter=";"))
            self.assertEqual(len(rows), len(CATALOG))
            self.assertIn("code_assessment", rows[0])
            self.assertNotIn("MY-TEST-CHARGER", file_json.read_text(encoding="utf-8"))
            self.assertNotIn("MY-TEST-CHARGER", file_csv.read_text(encoding="utf-8-sig"))


if __name__ == "__main__":
    unittest.main()
