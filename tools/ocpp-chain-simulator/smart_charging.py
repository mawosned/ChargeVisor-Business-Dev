"""Deterministic OCPP 1.6J charging profile and local circuit-limit model.

The model is deliberately explicit: it supports the current active schedule
period for Relative/Absolute profiles, ChargePointMaxProfile, TxDefaultProfile,
and TxProfile. Recurring profiles are rejected, not silently ignored. Local
site limits model a charger-controlled power budget, NOT the real CAN bus.
"""
from datetime import datetime, timezone
from math import isfinite
from time import monotonic


def _date(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


class ChargingProfileModel:
    def __init__(self, connector_count, voltage=230, phases=3, nominal_w=11040):
        self.count = connector_count
        self.voltage = voltage
        self.phases = phases
        self.nominal_w = nominal_w
        self.site_limit_kw = None
        self.profiles = {}
        self.events = []
        self.started = monotonic()
        self.transaction_starts = {}

    def transaction_started(self, connector):
        self.transaction_starts[connector] = monotonic()

    def transaction_stopped(self, connector):
        self.transaction_starts.pop(connector, None)

    def local_limit(self, kw):
        if kw is None:
            self.site_limit_kw = None
        else:
            number = float(kw)
            if not isfinite(number) or number < 0 or number > 500:
                raise ValueError("Limit must be between 0 and 500 kW")
            self.site_limit_kw = number

    def set_profile(self, connector_id, profile, active):
        if not isinstance(profile, dict) or not 0 <= connector_id <= self.count:
            return "Rejected"
        purpose = profile.get("charging_profile_purpose")
        kind = profile.get("charging_profile_kind")
        schedule = profile.get("charging_schedule") or {}
        unit = schedule.get("charging_rate_unit")
        periods = schedule.get("charging_schedule_period") or []
        if purpose not in ("ChargePointMaxProfile", "TxDefaultProfile", "TxProfile"):
            return "NotSupported"
        if kind not in ("Relative", "Absolute") or unit not in ("A", "W"):
            return "NotSupported"
        if purpose == "ChargePointMaxProfile" and connector_id != 0:
            return "Rejected"
        if purpose == "TxProfile" and (connector_id == 0 or connector_id not in active):
            return "Rejected"
        if not isinstance(periods, list) or not periods or len(periods) > 32:
            return "Rejected"
        if kind == "Absolute" and _date(schedule.get("start_schedule")) is None:
            return "Rejected"
        prev = -1
        for period in periods:
            if not isinstance(period, dict):
                return "Rejected"
            offset, limit = period.get("start_period"), period.get("limit")
            if (not isinstance(offset, int) or offset < 0 or offset <= prev or
                not isinstance(limit, (float, int)) or not isfinite(limit) or limit < 0):
                return "Rejected"
            prev = offset
        if periods[0]["start_period"] != 0:
            return "Rejected"
        # Mobility House OCPP 1.6 converts chargingProfileId to charging_profile_id.
        # Existing local model tests also use "id", so accept both forms.
        profile_id = profile.get("charging_profile_id", profile.get("id"))
        if not isinstance(profile_id, int) or profile_id < 0:
            return "Rejected"
        tx_id = profile.get("transaction_id")
        if purpose == "TxProfile" and tx_id is not None and active.get(connector_id) != tx_id:
            return "Rejected"
        # An incoming profile with the same ID replaces the previous version.
        self.profiles[profile_id] = {"connector": connector_id,
                                     "profile": profile,
                                     "received": monotonic()}
        return "Accepted"

    def clear(self, profile_id=None, connector_id=None, charging_profile_purpose=None,
              stack_level=None):
        removed = []
        for key, record in self.profiles.items():
            p = record["profile"]
            if profile_id is not None and profile_id != key:
                continue
            if connector_id is not None and connector_id != record["connector"]:
                continue
            if charging_profile_purpose is not None and charging_profile_purpose != p.get("charging_profile_purpose"):
                continue
            if stack_level is not None and stack_level != p.get("stack_level"):
                continue
            removed.append(key)
        for key in removed:
            del self.profiles[key]
        return "Accepted" if removed else "Unknown"

    def _value_w(self, record, elapsed_s, connector):
        p = record["profile"]
        schedule = p["charging_schedule"]
        now_epoch = datetime.now(timezone.utc).timestamp()
        valid_from, valid_to = _date(p.get("valid_from")), _date(p.get("valid_to"))
        if (valid_from is not None and now_epoch < valid_from) or (
            valid_to is not None and now_epoch > valid_to):
            return None
        if p["charging_profile_kind"] == "Absolute":
            start = _date(schedule.get("start_schedule"))
            offset = datetime.now(timezone.utc).timestamp() - start
        else:
            purpose = p.get("charging_profile_purpose")
            if purpose in ("TxDefaultProfile", "TxProfile"):
                anchor = self.transaction_starts.get(connector, record["received"])
            else:
                anchor = record["received"]
            offset = monotonic() - anchor if elapsed_s is None else elapsed_s
        if offset < 0:
            return None
        duration = schedule.get("duration")
        if isinstance(duration, int) and duration > 0 and offset > duration:
            return None
        periods = schedule["charging_schedule_period"]
        current = None
        for period in periods:
            if offset >= period["start_period"]:
                current = period
            else:
                break
        if current is None:
            return None
        limit = float(current["limit"])
        if schedule["charging_rate_unit"] == "A":
            limit *= self.voltage * current.get("number_phases", self.phases)
        return limit

    def effective(self, connector, active_transactions, elapsed=None):
        """Watts for an active connector; ChargePointMax is shared, not per-point."""
        if not 1 <= connector <= self.count:
            raise ValueError("Invalid connector")
        connected = max(1, len(active_transactions))
        point_limits = [float(self.nominal_w)]
        shared_limits = []
        if self.site_limit_kw is not None:
            shared_limits.append(self.site_limit_kw * 1000)
        per_purpose = {}
        for record in self.profiles.values():
            p = record["profile"]
            purpose = p["charging_profile_purpose"]
            target = record["connector"]
            if purpose == "ChargePointMaxProfile":
                possible = True
            elif target in (0, connector) and purpose == "TxDefaultProfile":
                possible = True
            elif target == connector and purpose == "TxProfile" and connector in active_transactions:
                possible = (p.get("transaction_id") is None or
                            p["transaction_id"] == active_transactions[connector])
            else:
                possible = False
            if not possible:
                continue
            value = self._value_w(record, elapsed, connector)
            if value is None:
                continue
            if purpose == "ChargePointMaxProfile":
                shared_limits.append(value)
            else:
                precedence = (purpose, target)
                old = per_purpose.get(precedence)
                if old is None or p.get("stack_level", 0) >= old[0]:
                    per_purpose[precedence] = (p.get("stack_level", 0), value)
        # TxProfile overrides TxDefaultProfile; neither can override global limits.
        profile_values = [value for (purpose, _), (_, value) in per_purpose.items()
                          if purpose == "TxProfile"]
        if not profile_values:
            profile_values = [value for (purpose, _), (_, value) in per_purpose.items()
                              if purpose == "TxDefaultProfile"]
        if profile_values:
            point_limits.append(min(profile_values))
        if shared_limits:
            total_cap = min(shared_limits)
            # Below 6 A per active connector, suspend a subset instead of
            # reducing EVERY connector below its minimum EV charge current.
            minimum_w = 6 * self.voltage * self.phases
            active_ids = sorted(active_transactions)
            if len(active_ids) > 1 and total_cap < minimum_w * len(active_ids):
                slots = min(len(active_ids), int(total_cap // minimum_w))
                if slots == 0:
                    point_limits.append(0)
                else:
                    # Deliberately slow 120-second round robin for readable
                    # testing; actual hardware load control may use faster cycles.
                    shift = int(monotonic() // 120) % len(active_ids)
                    group = {active_ids[(shift + i) % len(active_ids)]
                             for i in range(slots)}
                    point_limits.append(total_cap / slots if connector in group else 0)
            else:
                point_limits.append(total_cap / connected)
        return round(max(0.0, min(point_limits)), 1)

    def describe(self):
        return [{"id":key, "connector":v["connector"],
                 "purpose":v["profile"]["charging_profile_purpose"]}
                for key, v in sorted(self.profiles.items())]
