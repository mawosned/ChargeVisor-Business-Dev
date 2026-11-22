"""No-server, no-Render regression checks for realistic load limits."""
import unittest

from smart_charging import ChargingProfileModel


def profile(profile_id, purpose="TxDefaultProfile", limit=8, unit="A",
            kind="Relative", transaction_id=None):
    item = {
        "id": profile_id, "stack_level": 0,
        "charging_profile_purpose": purpose,
        "charging_profile_kind": kind,
        "charging_schedule": {
            "charging_rate_unit": unit,
            "charging_schedule_period": [{"start_period": 0, "limit": limit,
                                          "number_phases": 3}],
        },
    }
    if transaction_id is not None:
        item["transaction_id"] = transaction_id
    return item


class SmartChargingTests(unittest.TestCase):
    def setUp(self):
        self.model = ChargingProfileModel(10)

    def test_local_master_power_budget_is_shared_across_connectors(self):
        active = {i: 100 + i for i in range(1, 11)}
        self.model.local_limit(30)
        watts = [self.model.effective(i, active) for i in active]
        self.assertEqual(sum(1 for x in watts if x > 0), 7)
        self.assertEqual(sum(1 for x in watts if x == 0), 3)
        self.assertTrue(all(x >= 4140 for x in watts if x > 0))
        self.assertLessEqual(sum(watts), 30000)

    def test_charging_profile_max_is_station_wide_not_per_connector(self):
        active = {i: 100 + i for i in range(1, 5)}
        self.assertEqual(self.model.set_profile(
            0, profile(1, "ChargePointMaxProfile", 11000, "W"), active), "Accepted")
        watts = [self.model.effective(i, active) for i in active]
        self.assertEqual(sum(1 for w in watts if w > 0), 2)
        self.assertTrue(all(w >= 4140 for w in watts if w > 0))
        self.assertLessEqual(sum(watts), 11000)
        self.assertEqual(self.model.set_profile(
            2, profile(2, "ChargePointMaxProfile", 11000, "W"), active), "Rejected")

    def test_connector_default_profile_and_clear(self):
        self.assertEqual(self.model.set_profile(
            2, profile(3, "TxDefaultProfile", 6, "A"), {}), "Accepted")
        self.assertEqual(self.model.effective(2, {1: 101, 2: 102}), 4140)
        self.assertEqual(self.model.effective(1, {1: 101, 2: 102}), 11040)
        self.assertEqual(self.model.clear(profile_id=3), "Accepted")
        self.assertEqual(self.model.effective(2, {1: 101, 2: 102}), 11040)

    def test_tx_profile_requires_matching_live_transaction(self):
        p = profile(4, "TxProfile", 5, "A", transaction_id=102)
        self.assertEqual(self.model.set_profile(2, p, {}), "Rejected")
        self.assertEqual(self.model.set_profile(2, p, {2: 999}), "Rejected")
        self.assertEqual(self.model.set_profile(2, p, {2: 102}), "Accepted")
        self.assertEqual(self.model.effective(2, {2: 102}), 3450)
        self.assertEqual(self.model.effective(2, {}), 11040)

    def test_invalid_or_unsupported_profile_is_rejected(self):
        self.assertEqual(self.model.set_profile(0, profile(
            5, "TxDefaultProfile", 8, "A", kind="Recurring"), {}), "NotSupported")
        invalid = profile(6)
        invalid["charging_schedule"]["charging_schedule_period"][0]["limit"] = -1
        self.assertEqual(self.model.set_profile(1, invalid, {}), "Rejected")
        self.assertEqual(self.model.clear(profile_id=987654), "Unknown")

    def test_local_limit_zero_and_release(self):
        self.model.local_limit(0)
        self.assertEqual(self.model.effective(1, {1: 201}), 0)
        self.model.local_limit(None)
        self.assertEqual(self.model.effective(1, {1: 201}), 11040)


if __name__ == "__main__":
    unittest.main()
