"""Auditable OCPP 1.6J Soll/Ist coverage matrix for a normal charge-point connection.

A successful send or protocol ACK is only PROTOCOL_OK; PASS requires a
separate backend/UI verification confirmed by the tester. No credentials,
RFID UIDs, or frame payloads are persisted.
"""
import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


VERDICTS = ("NOT_TESTED", "PROTOCOL_OK", "PASS", "FAIL", "NOT_IMPLEMENTED")
SIDES = {"CP": "Wallbox → ChargeVisor", "CSMS": "ChargeVisor → Wallbox", "SCENARIO": "End-to-end"}


def entry(key, group, direction, expected, verify, auto=False):
    return {
        "id": key, "group": group, "direction": direction,
        "expected": expected, "verify": verify, "auto": bool(auto),
    }


def coverage():
    cases = []
    cp = [
        ("BootNotification", "Verbindung wird angenommen; Hersteller/Modell/Firmware gespeichert", True),
        ("Heartbeat", "Server liefert Zeit; lastSeen wird aktualisiert", True),
        ("Authorize", "bekannte RFID wird angenommen, unbekannte abgewiesen; keine Klartext-UID im Log", True),
        ("StatusNotification", "Status des korrekten Connectors wird gespeichert und im Frontend gezeigt", True),
        ("StartTransaction", "gültige RFID + Connector erzeugt eigene Transaktion und Benutzerzuordnung", True),
        ("MeterValues", "Wh/W/A werden zum korrekten Connector und zur laufenden Transaktion gespeichert", True),
        ("StopTransaction", "Ende, Verbrauch, Grund und Ladehistorie werden korrekt gespeichert", True),
        ("DataTransfer", "proprietäre Nachricht wird erkannt oder nach OCPP sauber abgewiesen", True),
        ("DiagnosticsStatusNotification", "Diagnosestatus wird protokolliert oder sauber als nicht unterstützt gemeldet", True),
        ("FirmwareStatusNotification", "Firmwarestatus wird protokolliert oder sauber als nicht unterstützt gemeldet", True),
        ("SecurityEventNotification", "Security-Profile-Message (Extension) wird nach unterstützter Version behandelt", False),
        ("LogStatusNotification", "Security-Extension Status wird korrekt behandelt", False),
        ("SignedFirmwareStatusNotification", "signierte Firmware-Extension wird behandelt", False),
        ("SignCertificate", "Security-Extension Zertifikatsanfrage wird verarbeitet", False),
    ]
    csms = [
        ("RemoteStartTransaction", "CSMS startet am richtigen Connector; gültiger idTag erforderlich"),
        ("RemoteStopTransaction", "CSMS beendet nur die angegebene Transaktion"),
        ("Reset", "Soft/Hard Reset wird bestätigt und tatsächlicher Reconnect geprüft"),
        ("UnlockConnector", "Befehl wird am richtigen Ladepunkt bestätigt"),
        ("ChangeAvailability", "Operative/Inoperative aktualisiert betroffene Connectoren"),
        ("ChangeConfiguration", "Konfigurationswert wird akzeptiert oder begründet abgewiesen"),
        ("GetConfiguration", "Server kann Konfigurationswerte auslesen"),
        ("ClearCache", "Autorisierungs-Cache wird gelöscht bzw. NotSupported gemeldet"),
        ("SendLocalList", "lokale RFID-Freigabeliste wird synchronisiert"),
        ("GetLocalListVersion", "Version der lokalen RFID-Liste ist auslesbar"),
        ("ReserveNow", "Reservierung wird für Connector+ID angewendet"),
        ("CancelReservation", "Reservierung kann aufgehoben werden"),
        ("UpdateFirmware", "Firmware-Download/-Installation nachvollziehbar ausgelöst"),
        ("GetDiagnostics", "Diagnosearchiv bereitgestellt oder NotSupported"),
        ("SetChargingProfile", "Ladegrenze wird an richtiger Stelle angewendet, reale W/A sinken"),
        ("ClearChargingProfile", "Ladegrenze wird aufgehoben, Leistung passt sich an"),
        ("GetCompositeSchedule", "wirksamer Ladeschedule wird korrekt zurückgegeben"),
        ("TriggerMessage", "gewünschte Benachrichtigung wird unmittelbar gesendet"),
        ("DataTransfer", "proprietäre Nachricht wird beantwortet oder sauber abgelehnt"),
        ("GetInstalledCertificateIds", "Security-Extension Liste installiertes Zertifikat"),
        ("InstallCertificate", "Security-Extension Zertifikat wird eingespielt"),
        ("DeleteCertificate", "Security-Extension Zertifikat wird gelöscht"),
        ("GetLog", "Security-Extension Logtransfer wird verarbeitet"),
        ("SignedUpdateFirmware", "signierte Firmware-Extension wird verarbeitet"),
        ("CertificateSigned", "Security-Extension signiertes Zertifikat wird akzeptiert"),
        ("ExtendedTriggerMessage", "Security-Extension TriggerMessage wird behandelt"),
    ]
    for action, expected, automated in cp:
        group = "Protokoll / Wallbox → Backend" if "Certificate" not in action and "Security" not in action and "Signed" not in action and "Log" not in action else "OCPP 1.6 Security Extensions"
        cases.append(entry("CP."+action, group, "CP", expected, "OCPP-Antwort + Datenbank/Frontend-Nachweis", automated))
    for action, expected in csms:
        group = "Protokoll / Backend → Wallbox" if action not in ("GetInstalledCertificateIds", "InstallCertificate", "DeleteCertificate", "GetLog", "SignedUpdateFirmware", "CertificateSigned", "ExtendedTriggerMessage") else "OCPP 1.6 Security Extensions"
        cases.append(entry("CSMS."+action, group, "CSMS", expected,
                           "Backend-Befehl tatsächlich empfangen, geantwortet und Auswirkung beobachtet"))
    statuses = [
        "Available", "Preparing", "Charging", "SuspendedEV", "SuspendedEVSE",
        "Finishing", "Reserved", "Unavailable", "Faulted",
    ]
    for status in statuses:
        cases.append(entry("STATUS."+status, "StatusNotification", "CP",
                           f"StatusNotification {status} für richtigen Connector; Backend zeigt korrekten Zustand",
                           "OCPP-Antwort + Anzeige an genau diesem Ladepunkt", True))
    errors = [
        "ConnectorLockFailure", "EVCommunicationError", "GroundFailure",
        "HighTemperature", "InternalError", "LocalListConflict", "NoError",
        "OtherError", "OverCurrentFailure", "OverVoltage", "PowerMeterFailure",
        "PowerSwitchFailure", "ReaderFailure", "ResetFailure", "UnderVoltage",
        "WeakSignal",
    ]
    for code in errors:
        cases.append(entry("ERROR."+code, "Fehlercodes", "CP",
                           f"Faulted/{code} korrekt im Backend empfangen, protokolliert und angezeigt",
                           "OCPP-Antwort + Störungsanzeige + richtiger Ladepunkt", True))
    scenarios = [
        ("RFID.Unknown", "Unbekannter Tag abgewiesen und unter kürzlich erkannten Karten angezeigt"),
        ("RFID.Assigned", "Zugeordneter Tag akzeptiert und Nutzer-/Ladepunktfreigaben beachtet"),
        ("RFID.Disabled", "Gesperrter RFID-Tag bleibt abgewiesen"),
        ("Chain.OneSocket", "Master und bis zu 20 Connectoren verwenden eine WebSocket-Verbindung"),
        ("Chain.Parallel", "Mehrere parallele Transaktionen mit unterschiedlichen Transaktions-IDs"),
        ("Chain.Isolation", "MeterValues, Status, Stop und Nutzer korrekt pro Connector getrennt"),
        ("Offline.Disconnect", "WebSocket-Abbruch: Geräte werden nach Timeout offline"),
        ("Offline.Reconnect", "Reconnect mit gleicher OCPP-ID und Statuswiederherstellung"),
        ("Load.LocalBudget", "Lokales Master-Budget bleibt begrenzt, ohne Backend-Befehl"),
        ("Load.SetPoint", "CSMS sendet SetChargingProfile und Strom/Leistung folgen"),
        ("Load.Release", "CSMS hebt Ladeprofil auf, Strom steigt wieder"),
        ("Load.SuspendedEV", "EV-seitige Pause stoppt Leistung, Transaktion bleibt aktiv"),
        ("Load.SuspendedEVSE", "EVSE-seitige Pause stoppt Leistung, Transaktion bleibt aktiv"),
        ("Load.TenWallboxes", "10 unabhängige Ladepunkte mit gemeinsamer Leistung und Historie"),
        ("Remote.Reset", "Echter Soft/Hard-Reconnect nach Reset incl. Zustand"),
        ("Billing.History", "Start/Ende, Energie, Zuordnung, Preis und Export stimmen überein"),
        ("Status.Frontend", "Statusänderungen erreichen Frontend live; keine falsche Erfolgsmeldung"),
    ]
    for name, expected in scenarios:
        cases.append(entry("SCENARIO."+name, "End-to-end-Szenarien", "SCENARIO",
                           expected, "Backend/API/Frontend mit Screenshot oder Datenbankreferenz"))
    return cases


# Read-only assessment of the reviewed ChargeVisor repository source, NOT live proof.
# 'NOT FOUND' means no handler/sender in the reviewed code; other modules or
# deployed versions may differ. Always run a protocol test to establish truth.
BACKEND_CP_ACTIONS = {
    "BootNotification", "Heartbeat", "Authorize", "StatusNotification",
    "StartTransaction", "StopTransaction", "MeterValues",
}
BACKEND_CSMS_ACTIONS = {
    "RemoteStartTransaction", "RemoteStopTransaction", "Reset",
    "SetChargingProfile", "ClearChargingProfile", "ChangeConfiguration",
}


def code_assessment(case_id):
    if case_id.startswith("CP."):
        name = case_id.split(".", 1)[1]
        if name in BACKEND_CP_ACTIONS:
            return "Im Backend-Code"
        return "Im geprüften Backend-Code nicht gefunden"
    if case_id.startswith("CSMS."):
        name = case_id.split(".", 1)[1]
        if name in BACKEND_CSMS_ACTIONS:
            if name in ("SetChargingProfile", "ClearChargingProfile"):
                return "Teilweise: Pause/Fortsetzen, kein umfassendes DLM"
            if name == "ChangeConfiguration":
                return "Teilweise: Enelion-Freecharge-Konfiguration"
            return "Im Backend-Code"
        return "Im geprüften Backend-Code nicht gefunden"
    if case_id.startswith("STATUS."):
        return "Backend speichert OCPP-Status; Frontend-Nachweis offen"
    if case_id.startswith("ERROR."):
        return "Backend speichert errorCode; Frontend-Nachweis offen"
    return "Szenario: noch nicht end-to-end verifiziert"


CATALOG = {case["id"]: case for case in coverage()}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AuditStore:
    """Persist only nonsecret observations; never store OCPP credentials or RFID tags."""

    def __init__(self, identity="", base_dir=None):
        base = Path(base_dir) if base_dir else Path.home() / "ChargeVisor" / "ocpp-test-results"
        self.base_dir = base
        self.identity = identity or "unbound"
        token = hashlib.sha256(self.identity.encode("utf-8")).hexdigest()[:12]
        self.path = base / f"coverage-{token}.json"
        self.rows = {}
        self.history = []
        if self.path.is_file():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if loaded.get("schema") == 1 and isinstance(loaded.get("rows"), dict):
                    self.rows = {k: v for k, v in loaded["rows"].items() if k in CATALOG}
                    self.history = loaded.get("history", [])[-2000:]
            except (ValueError, OSError):
                pass

    def status(self, case_id):
        return self.rows.get(case_id, {}).get("verdict", "NOT_TESTED")

    def mark(self, case_id, verdict, observed, connector=None, evidence="", reviewer=""):
        if case_id not in CATALOG:
            raise ValueError("Unknown OCPP test case")
        if verdict not in VERDICTS:
            raise ValueError("Invalid verdict")
        if verdict == "PASS" and not evidence.strip():
            raise ValueError("PASS requires backend / frontend evidence or an explicit manual confirmation")
        record = {
            "id": case_id, "verdict": verdict, "expected": CATALOG[case_id]["expected"],
            "observed": str(observed)[:2000],
            "evidence": str(evidence)[:1200],
            "connector": connector, "reviewer": reviewer[:80],
            "timestamp": now(),
        }
        self.rows[case_id] = record
        self.history.append(record)
        self.history = self.history[-2000:]
        self._save()
        return record

    def _save(self):
        self.base_dir.mkdir(parents=True, exist_ok=True)
        data = {"schema": 1, "generated_at": now(), "identity_sha256": self.path.stem[9:],
                "rows": self.rows, "history": self.history}
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, self.path)

    def list_rows(self):
        return [{**case, "code_assessment": code_assessment(case["id"]),
                 **self.rows.get(case["id"], {}),
                 "verdict": self.status(case["id"])} for case in CATALOG.values()]

    def summary(self):
        counts = {status: 0 for status in VERDICTS}
        for case in CATALOG:
            counts[self.status(case)] += 1
        return counts

    def export(self, fmt, output_path):
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if fmt == "json":
            path.write_text(json.dumps({
                "schema": 1, "generated_at": now(), "summary": self.summary(),
                "cases": self.list_rows(),
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        elif fmt == "csv":
            fields = ["id", "group", "direction", "expected", "verify", "code_assessment", "verdict",
                      "observed", "evidence", "connector", "timestamp", "reviewer"]
            with path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", delimiter=";")
                writer.writeheader()
                writer.writerows(self.list_rows())
        else:
            raise ValueError("Export JSON/CSV only")
        return path
