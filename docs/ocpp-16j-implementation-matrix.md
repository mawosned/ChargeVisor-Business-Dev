# ChargeVisor: OCPP 1.6J complete command inventory (22 Nov 2026)

**Authority:** This table describes **the implementation in this repository**,
not advertised device hardware capabilities and not the result of a completed
end-to-end acceptance test.

**Code baseline:** public dev initial snapshot \`bdab26cc89505218519d9dd6f7a98c92e064a583\`
derived from private production \`b541e5c34006dd3697037bf2ebcdd254a4cd0398\`.

**Status rules**
- **Handled**: actual inbound dispatch and reply implemented. Does **not**
  imply full OCPP specification conformance or verified storage/UI effects.
- **Sent**: CSMS constructs and sends the command in some code path. It does
  **not** imply that arbitrary hardware supports or accepts it, or that an
  independent device has been tested.
- **Missing**: no matching handler or sender was found in the inspected
  backend code. A missing action must not silently become "PASS".
- **Partially implemented**: code supports a narrow product-specific use or
  command response but not full generic configuration, persistence, permissions,
  lifecycle or corresponding test coverage.

## Charge Point → Central System (10 OCPP 1.6 standard actions)

| Action | Observed backend status | Code evidence / functional gap |
|---|---|---|
| Authorize | Handled | \`backend/ocpp.mjs\`: authorization and test/physical paths |
| BootNotification | Handled | Vendor/model validated; updates live state |
| DataTransfer | Missing | No inbound handler; vendor-specific extensions unhandled |
| DiagnosticsStatusNotification | Missing | No inbound status handler |
| FirmwareStatusNotification | Missing | No inbound status handler |
| Heartbeat | Handled | Replies with current time |
| MeterValues | Handled | Energy/power parsing and connector state updates; still verify persistence, units, phase edge cases |
| StartTransaction | Handled | Separate physical and simulator paths; verify authorization, race/replay, user association and history |
| StatusNotification | Handled | Nine statuses, connector errors and info |
| StopTransaction | Handled | Physical and simulator closure; verify retries, meter readings and billing history |

**Count:** 7 actions dispatched; 3 unimplemented. No claim of full feature
coverage from this count.

## Central System → Charge Point (19 OCPP 1.6 standard actions)

| Action | Observed CSMS status | Code evidence / functional gap |
|---|---|---|
| CancelReservation | Missing | No sender or reservation lifecycle |
| ChangeAvailability | Missing | Distinguish station/connector availability and physical behavior |
| ChangeConfiguration | Partially implemented | \`backend/freecharge.mjs\`: two Enelion Lumina-specific keys only, not generic configuration |
| ClearCache | Missing | No CSMS command path |
| ClearChargingProfile | Partially implemented | \`backend/ocpp.mjs\`: resume of previously paused session only |
| DataTransfer | Missing | No CSMS command path |
| GetCompositeSchedule | Missing | No CSMS command path |
| GetConfiguration | Missing | No generic retrieval |
| GetDiagnostics | Missing | No diagnostics download lifecycle |
| GetLocalListVersion | Missing | No local list version lifecycle |
| RemoteStartTransaction | Partially implemented | \`backend/ocpp.mjs\` user action; physical hardware, timeout and subsequent transaction must be validated end-to-end |
| RemoteStopTransaction | Partially implemented | \`backend/ocpp.mjs\` user action; must observe ensuing StopTransaction |
| ReserveNow | Missing | No reservation lifecycle |
| Reset | Partially implemented | \`backend/ocpp.mjs\` Soft reset only; no complete reset/reconnect verification |
| SendLocalList | Missing | No on-device authorization-list provisioning |
| SetChargingProfile | Partially implemented | \`backend/ocpp.mjs\` pause profile only; no generic current/power scheduling |
| TriggerMessage | Missing | No CSMS command path |
| UnlockConnector | Missing | No CSMS command path |
| UpdateFirmware | Missing | No update workflow; do not assume every device allows OTA |

**Count:** 6 actions with a specific sending code path
(including Lumina-specific ChangeConfiguration); **13 missing**.
All six require deeper tests before claiming full standard support.

## Read-only evidence already available

Existing testable API routes:

- \`GET /api/ocpp/live\`: state, connector, active transaction, energy and errors
- \`GET /api/ocpp/sessions\`: persisted physical charging history
- \`GET /api/structure/overview\`: tenants/sites/stations/points
- \`GET /api/ocpp/test-sessions\`: isolated simulator sessions (superadmin)
- \`POST /api/ocpp/control\`: current start/stop/pause/reset restricted by role
- \`POST /api/ocpp/freecharge-configuration\`: Lumina-specific configuration

There are existing 62 passing local backend tests and six successful CI
jobs for the initial public snapshot (22 Nov 2026).
This is **not** a full end-to-end proof for the 29 actions above.

## Required testing layers for every command

1. **Request contract:** OCPP 1.6J schemas, message order, response and error
   including malformed input and boundary cases.
2. **Correct protocol direction:** actual WebSocket device ↔ ChargeVisor
   with independent library, not a mock reply invented by ChargeVisor.
3. **CSMS business semantics:** user/role/tenant, supported capability,
   conflict handling, timeout, retry, disconnect and reconnect.
4. **Backend observed state:** isolated test DB and authenticated read-only
   API; compare expected and actual connector, transaction and event data.
5. **Frontend observed state:** customer-specific status, fault, history,
   power/energy data; browser regression where the feature is exposed.
6. **Hardware check:** real target firmware response, supported/not supported
   behavior and effect; **NotSupported from the station is not a CSMS bug**
   if the platform correctly handles and displays that outcome.

**PASS** needs the evidence appropriate to the feature. \`PROTOCOL_OK\`
does not mean the recorded session, authorization or frontend is correct.
A feature not executed is \`NOT_TESTED\`; lack of implementation is
\`NOT_IMPLEMENTED\`, not automatically \`FAIL\`.

## Safety and production protection

- Production private repo \`mawosned/ChargeVisor-Business\` remains on Render,
  branch \`main\`, commit \`b541e5...\`. **No development changes merged there.**
- Public dev repo has a separate new Git history and its own Actions.
- Future behavior changes should happen only in a new public-dev feature branch
  and PR, with green backend, browser and independent Python OCPP checks.
- Tests must only use a **disposable** database and explicitly test-labeled
  stations/tenants. No production customer data or credentials in CI.
- Do not remove/rename already working endpoints, dashboard display structures,
  OCPP identity handling, RFID and history fields without explicit
  backwards-compatible contracts and regression tests.
- No automatic sync or deployment from public dev into private production.
  Promotion later requires an explicit review, a matching test suite and a
  controlled private-branch deployment. Keep a rollback commit available.

## Implementation order (small independent PRs)

1. Strengthen existing outbound-command E2E checks:
   RemoteStart/Stop; Soft Reset; pause/resume profiles;
   Lumina ChangeConfiguration; unauthorized user, offline and timeout cases.
2. Integrate the **permanently configured**, least-privilege, test-only
   backend state verifier. Use a revocable credential; never put it in Git.
3. Implement and test diagnostics + availability/configuration commands:
   ChangeAvailability, GetConfiguration, ChangeConfiguration generic,
   TriggerMessage, ClearCache, DataTransfer.
4. Implement full Smart Charging semantics:
   profiles, clearing, composite schedules, multiple connectors,
   current/power constraints and local load balancing interaction.
5. Implement reservation/unlock/local-list flows:
   ReserveNow, CancelReservation, UnlockConnector,
   SendLocalList, GetLocalListVersion.
6. Implement firmware and diagnostic flows:
   UpdateFirmware, GetDiagnostics,
   FirmwareStatusNotification, DiagnosticsStatusNotification.
7. Verify remaining error/reconnect/authorization cases and run the whole
   protocol matrix + front-end + hardware acceptance without regressions.

**Do not** implement everything in one large rewrite. Increment by feature
with explicit test evidence and fail the merge gate on regressions.

## Beyond base OCPP 1.6J

Optional OCPP Security Extensions (including certificate-based authentication),
signed firmware, Plug & Charge / ISO 15118, and proprietary vehicle/charger
messages are **not** automatically guaranteed by implementing the 29 base
OCPP 1.6J commands. They require their own scope, security design and tests.
