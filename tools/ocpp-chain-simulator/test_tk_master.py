"""Regression test: Tkinter reserves .master for widget ancestry.

Do not overload tk.Tk.master with the active OCPP charge point. If we do,
Tkinter's callback exception reporter itself fails with an AttributeError:
'InteractiveMaster' object has no attribute 'master'.
"""
import ast
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent


class TkMasterCollisionTests(unittest.TestCase):
    def test_simulator_app_never_overrides_widget_master(self):
        tree = ast.parse((HERE / "desktop_simulator.py").read_text(encoding="utf-8"))
        app = next(node for node in tree.body
                   if isinstance(node, ast.ClassDef) and node.name == "SimulatorApp")
        self.assertFalse(any(
            isinstance(node, ast.Attribute) and
            isinstance(node.value, ast.Name) and node.value.id == "self" and
            node.attr == "master"
            for node in ast.walk(app)
        ), "SimulatorApp must never override Tkinter .master")
        self.assertTrue(any(
            isinstance(node, ast.Attribute) and
            isinstance(node.value, ast.Name) and node.value.id == "self" and
            node.attr == "ocpp_master" for node in ast.walk(app)
        ))

    def test_coverage_ui_references_correct_charge_point(self):
        source = (HERE / "ocpp_test_console.py").read_text(encoding="utf-8")
        self.assertNotIn("self.app.master", source)
        self.assertIn("self.app.ocpp_master", source)

    def test_connection_gets_nominal_amp_from_ui_thread(self):
        source = (HERE / "desktop_simulator.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        app = next(node for node in tree.body
                   if isinstance(node, ast.ClassDef) and node.name == "SimulatorApp")
        async_connect = next(node for node in app.body
                             if isinstance(node, ast.AsyncFunctionDef)
                             and node.name == "_connect")
        self.assertIn("nominal_amp", [arg.arg for arg in async_connect.args.args])
        self.assertNotIn("self.nominal_power_var.get()", ast.get_source_segment(
            source, async_connect))


if __name__ == "__main__":
    unittest.main()
