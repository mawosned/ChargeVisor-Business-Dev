"""Deterministic, paced OCPP endurance plan.

Each entry is a scenario transition, not every internal OCPP frame:
Boot/Authorize/Status/Start may produce multiple legitimate OCPP calls
inside one scenario. The caller holds at least 60 real seconds before the
next transition. Only one connector is *changed* per transition; concurrent
charging is deliberately tested by ramping one connector per minute.
"""
STANDARD_STATUSES = (
    "Available", "Preparing", "Finishing", "Reserved", "Unavailable",
)
STANDARD_ERRORS = (
    "ConnectorLockFailure", "EVCommunicationError", "GroundFailure",
    "HighTemperature", "InternalError", "LocalListConflict", "NoError",
    "OtherError", "OverCurrentFailure", "OverVoltage", "PowerMeterFailure",
    "PowerSwitchFailure", "ReaderFailure", "ResetFailure", "UnderVoltage",
    "WeakSignal",
)

MIN_REAL_STEP_SECONDS = 60


def build_plan(connector_count):
    if not 1 <= connector_count <= 20:
        raise ValueError("Connector count must be 1..20")

    def step(kind, connector=None, value=None):
        return {"kind": kind, "connector": connector, "value": value}

    plan = [
        step("RFID_KNOWN", 1),
        step("START", 1),
        step("SUSPEND_EV", 1),
        step("SUSPEND_EVSE", 1),
        step("STOP", 1),
        step("RFID_UNKNOWN", 1),
        step("HEARTBEAT", 1),
    ]
    # Ramp up one charger every minute; this is NOT an instantaneous ten-point
    # state change. The single master OCPP connection stays open throughout.
    for connector in range(1, connector_count + 1):
        plan.append(step("START", connector))
    plan.extend([step("LIMIT_ON"), step("METER", 1), step("LIMIT_OFF")])
    for connector in range(connector_count, 0, -1):
        plan.append(step("STOP", connector))

    # One status *or* one error per minute. Rotate physical connector mapping;
    # dedicated RESET_STATUS steps clear faults before later tests.
    number = 0
    for status in STANDARD_STATUSES:
        connector = number % connector_count + 1
        plan.append(step("STATUS", connector, status))
        if status in ("Reserved", "Unavailable"):
            plan.append(step("RESTORE", connector))
        number += 1

    for error in STANDARD_ERRORS:
        connector = number % connector_count + 1
        plan.append(step("ERROR", connector, error))
        plan.append(step("RESTORE", connector))
        number += 1

    # A sequential charging lifecycle for each connector after status tests.
    for connector in range(1, connector_count + 1):
        plan.append(step("START", connector))
        plan.append(step("STOP", connector))
    for action in ("DataTransfer", "DiagnosticsStatusNotification",
                   "FirmwareStatusNotification"):
        plan.append(step("OPTIONAL_PROBE", 1, action))
    plan.append(step("HEARTBEAT"))
    return plan
