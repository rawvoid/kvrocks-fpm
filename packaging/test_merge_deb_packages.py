#!/usr/bin/env python3
"""
Unit tests for merge-deb-packages.py.
"""

import importlib.util
import os
import sys
import tempfile
import unittest

script_path = os.path.join(os.path.dirname(__file__), "merge-deb-packages.py")
spec = importlib.util.spec_from_file_location("merge_deb_packages", script_path)
merge_deb_packages = importlib.util.module_from_spec(spec)
sys.modules["merge_deb_packages"] = merge_deb_packages
spec.loader.exec_module(merge_deb_packages)

extract_stanza_key = merge_deb_packages.extract_stanza_key
merge_packages = merge_deb_packages.merge_packages
parse_stanzas = merge_deb_packages.parse_stanzas

HASH_A = "a" * 64
HASH_B = "b" * 64


def stanza(package, version, arch="amd64", **fields):
    fields = {"Size": "123", "SHA256": HASH_A, **fields}
    lines = [f"Package: {package}", f"Version: {version}", f"Architecture: {arch}"]
    lines += [f"{name}: {value}" for name, value in fields.items()]
    return "\n".join(lines) + "\n"


class TestMergeDebPackages(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp_dir.cleanup()

    def path(self, name):
        return os.path.join(self.temp_dir.name, name)

    def write(self, name, content):
        with open(self.path(name), "w", encoding="utf-8") as f:
            f.write(content)
        return self.path(name)

    def read(self, name):
        with open(self.path(name), "r", encoding="utf-8") as f:
            return f.read()

    def test_extract_stanza_key_is_case_insensitive_and_ignores_multiline_continuations(self):
        key = extract_stanza_key(
            f"package: kvrocks\nDescription: text\n Version: not-a-field\nversion: 1.0-1\narchitecture: arm64\nsha256: {HASH_A}"
        )
        self.assertEqual(key, ("kvrocks", "arm64", "1.0-1"))

    def test_parse_stanzas(self):
        content = f"""Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
SHA256: {HASH_A}
Description: First line
 Second line with indentation

Package: kvrocks-legacy
Version: 2.15.0-1
Architecture: amd64
SHA256: {HASH_A}
Description: Legacy package
"""
        stanzas = parse_stanzas(content)
        self.assertEqual(len(stanzas), 2)
        self.assertEqual(extract_stanza_key(stanzas[0]), ("kvrocks", "amd64", "2.15.0-1"))
        self.assertEqual(extract_stanza_key(stanzas[1]), ("kvrocks-legacy", "amd64", "2.15.0-1"))

    def test_merge_creates_target_file_on_first_release(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))
        target_file = self.path("Packages")

        merge_packages(new_file, target_file)

        self.assertEqual(self.read("Packages"), stanza("kvrocks", "2.15.0-1"))

    def test_merge_appends_new_version_and_preserves_history(self):
        old_content = stanza("kvrocks", "2.15.0-1", SHA256=HASH_A)
        new_content = stanza("kvrocks", "2.16.0-1", SHA256=HASH_B)
        target_file = self.write("Packages", old_content)
        new_file = self.write("Packages.new", new_content)

        merge_packages(new_file, target_file)

        self.assertEqual(self.read("Packages"), old_content + "\n" + new_content)

    def test_merge_identical_package_is_idempotent(self):
        old_content = stanza("kvrocks", "2.15.0-1", SHA256=HASH_A, Description="Published metadata")
        target_file = self.write("Packages", old_content)
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1", SHA256=HASH_A, Description="Retry metadata"))

        merge_packages(new_file, target_file)

        self.assertEqual(self.read("Packages"), old_content)

    def test_merge_refuses_to_overwrite_indexed_version_with_different_sha256(self):
        target_file = self.write("Packages", stanza("kvrocks", "2.15.0-1", SHA256=HASH_A))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1", SHA256=HASH_B))

        with self.assertRaises(ValueError):
            merge_packages(new_file, target_file)
        self.assertEqual(self.read("Packages"), stanza("kvrocks", "2.15.0-1", SHA256=HASH_A))

    def test_duplicate_stanza_within_one_file_raises_error(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1") + "\n" + stanza("kvrocks", "2.15.0-1"))

        with self.assertRaises(ValueError):
            merge_packages(new_file, self.path("Packages"))

    def test_missing_required_fields_raises_error(self):
        for field in ("Package", "Version", "Architecture", "SHA256"):
            with self.subTest(field=field):
                lines = [
                    line for line in stanza("kvrocks", "2.15.0-1").splitlines()
                    if not line.startswith(f"{field}:")
                ]
                new_file = self.write("Packages.new", "\n".join(lines) + "\n")
                with self.assertRaisesRegex(ValueError, "missing required field"):
                    merge_packages(new_file, self.path("Packages"))

    def test_empty_files_raise_error(self):
        empty_new = self.write("empty.Packages", "\n   \n\n")
        with self.assertRaises(ValueError):
            merge_packages(empty_new, self.path("Packages"))

        empty_target = self.write("Packages", "\n   \n")
        valid_new = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))
        with self.assertRaises(ValueError):
            merge_packages(valid_new, empty_target)


if __name__ == "__main__":
    unittest.main()
