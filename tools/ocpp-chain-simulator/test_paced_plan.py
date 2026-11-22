"""Static checks for realistic 60-second scenario pacing and connector isolation."""
import unittest

from paced_plan import build_plan, MIN_REAL_STEP_SECONDS, STANDARD_ERRORS
from smart_charging import ChargingProfileModel
from ocpp_soak import SoakRunner


class PacedPlanTests(unittest.TestCase):
    def test_minimum_pause_is_full_minute(self):
        self.assertGreaterEqual(MIN_REAL_STEP_SECONDS, 60)

    def test_first_five_minute_steps_are_one_connector_lifecycle(self):
        first = build_plan(10)[:5]
        self.assertEqual([x["kind"] for x in first],
                         ["RFID_KNOWN", "START", "SUSPEND_EV",
                          "SUSPEND_EVSE", "STOP"])
        self.assertEqual([x["connector"] for x in first], [1] * 5)

    def test_one_connector_state_change_per_step(self):
        plan = build_plan(10)
        self.assertGreater(len(plan), 75)
        self.assertTrue(all(isinstance(p["connector"], int) or
                            p["connector"] is None for p in plan))
        ramp_start = next(i for i, p in enumerate(plan)
                          if p["kind"] == "START" and p["connector"] == 1
                          and i > 5)
        self.assertEqual([p["connector"] for p in
                          plan[ramp_start:ramp_start + 10]], list(range(1, 11)))
        self.assertEqual([p["kind"] for p in
                          plan[ramp_start:ramp_start + 10]], ["START"] * 10)
        self.assertIn("LIMIT_ON", [p["kind"] for p in plan])
        self.assertIn("LIMIT_OFF", [p["kind"] for p in plan])
        self.assertEqual(len([p for p in plan if p["kind"] == "ERROR"]),
                         len(STANDARD_ERRORS))

    def test_default_11kw_three_phase_and_22kw_option(self):
        model = ChargingProfileModel(10)
        self.assertEqual(model.nominal_w, 11040)
        self.assertEqual(model.effective(1, {1: 111}), 11040)
        higher = ChargingProfileModel(10, nominal_w=230 * 3 * 32)
        self.assertEqual(higher.effective(1, {1: 111}), 22080)

    def test_single_charger_plan(self):
        plan = build_plan(1)
        self.assertTrue(all(p["connector"] in (None, 1) for p in plan))
        with self.assertRaises(ValueError):
            build_plan(0)
        with self.assertRaises(ValueError):
            build_plan(21)


if __name__ == "__main__":
    unittest.main()
