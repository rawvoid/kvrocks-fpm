#!/usr/bin/env python3
"""
Unit tests for patch-config.py.
"""

import importlib.util
import os
import sys
import tempfile
import unittest

# Import patch-config.py dynamically due to hyphen in filename
script_path = os.path.join(os.path.dirname(__file__), "patch-config.py")
spec = importlib.util.spec_from_file_location("patch_config", script_path)
patch_config_module = importlib.util.module_from_spec(spec)
sys.modules["patch_config"] = patch_config_module
spec.loader.exec_module(patch_config_module)

patch_config = patch_config_module.patch_config
patch_directive = patch_config_module.patch_directive


class TestPatchConfig(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.conf_path = os.path.join(self.temp_dir.name, "kvrocks.conf")

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_conf(self, content: str):
        with open(self.conf_path, "w", encoding="utf-8") as f:
            f.write(content)

    def _read_conf(self) -> str:
        with open(self.conf_path, "r", encoding="utf-8") as f:
            return f.read()

    def test_replace_active_directive(self):
        self._write_conf("daemonize yes\ndir /tmp/old\n")
        patch_config(self.conf_path, {"daemonize": "no", "dir": "/var/lib/kvrocks"})
        content = self._read_conf()
        self.assertIn("daemonize no\n", content)
        self.assertIn("dir /var/lib/kvrocks\n", content)
        self.assertNotIn("daemonize yes", content)
        self.assertNotIn("/tmp/old", content)

    def test_insert_below_commented_directive(self):
        self._write_conf("# log-dir /tmp/kvrocks,stdout\n# supervised no\n")
        patch_config(self.conf_path, {
            "log-dir": "/var/log/kvrocks",
            "supervised": "systemd",
        })
        content = self._read_conf()
        self.assertIn("# log-dir /tmp/kvrocks,stdout\nlog-dir /var/log/kvrocks\n", content)
        self.assertIn("# supervised no\nsupervised systemd\n", content)

    def test_append_missing_directive(self):
        self._write_conf("port 6666\n")
        patch_config(self.conf_path, {"dir": "/var/lib/kvrocks"})
        content = self._read_conf()
        self.assertTrue(content.endswith("dir /var/lib/kvrocks\n"))
        self.assertIn("port 6666\n", content)

    def test_idempotency(self):
        initial = (
            "daemonize yes\n"
            "# log-dir /tmp/kvrocks,stdout\n"
            "dir /tmp/data\n"
            "# supervised no\n"
        )
        self._write_conf(initial)
        patches = {
            "dir": "/var/lib/kvrocks",
            "log-dir": "/var/log/kvrocks",
            "daemonize": "no",
            "supervised": "systemd",
        }
        patch_config(self.conf_path, patches)
        first_result = self._read_conf()

        # Running a second time should produce identical output
        patch_config(self.conf_path, patches)
        second_result = self._read_conf()
        self.assertEqual(first_result, second_result)

    def test_patch_directive_wrapper(self):
        self._write_conf("daemonize yes\n")
        patch_directive(self.conf_path, "daemonize", "no")
        self.assertIn("daemonize no\n", self._read_conf())

    def test_production_patches(self):
        initial = (
            "dir /tmp/kvrocks\n"
            "# log-dir /tmp/kvrocks,stdout\n"
            "log-retention-days -1\n"
            "daemonize yes\n"
            "# supervised no\n"
        )
        self._write_conf(initial)
        patches = {
            "dir": "/var/lib/kvrocks",
            "log-dir": "/var/log/kvrocks",
            "log-retention-days": "30",
            "daemonize": "no",
            "supervised": "systemd",
        }
        patch_config(self.conf_path, patches)
        content = self._read_conf()
        self.assertIn("dir /var/lib/kvrocks\n", content)
        self.assertIn("log-dir /var/log/kvrocks\n", content)
        self.assertIn("log-retention-days 30\n", content)
        self.assertIn("daemonize no\n", content)
        self.assertIn("supervised systemd\n", content)

    def test_nonexistent_file_exits(self):
        import io
        from contextlib import redirect_stderr
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as cm:
                patch_config("/nonexistent/path/kvrocks.conf", {"dir": "/var/lib/kvrocks"})
            self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
