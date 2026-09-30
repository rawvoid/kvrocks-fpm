#!/usr/bin/env python3
"""
Unit tests for merge-deb-packages.py.
"""

import importlib.util
import os
import stat
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


def stanza(package, version, arch="amd64", **fields):
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

    def test_extract_stanza_key_is_case_insensitive_and_ignores_continuations(self):
        key = extract_stanza_key("package: kvrocks\nDescription: text\n Version: not-a-field\nVERSION: 1.0-1\narchitecture: arm64")
        self.assertEqual(key, ("kvrocks", "arm64", "1.0-1"))

    def test_parse_stanzas(self):
        content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Description: First line
 Second line with indentation

Package: kvrocks-legacy
Version: 2.15.0-1
Architecture: amd64
Description: Legacy package
"""
        stanzas = parse_stanzas(content)
        self.assertEqual(len(stanzas), 2)
        key1 = extract_stanza_key(stanzas[0])
        self.assertEqual(key1, ("kvrocks", "amd64", "2.15.0-1"))
        key2 = extract_stanza_key(stanzas[1])
        self.assertEqual(key2, ("kvrocks-legacy", "amd64", "2.15.0-1"))

    def test_merge_initial_new_only(self):
        new_content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
"""
        new_file = os.path.join(self.temp_dir.name, "Packages.new")
        out_file = os.path.join(self.temp_dir.name, "Packages")
        with open(new_file, "w", encoding="utf-8") as f:
            f.write(new_content)

        merge_packages(None, new_file, out_file)

        with open(out_file, "r", encoding="utf-8") as f:
            result = f.read()

        stanzas = parse_stanzas(result)
        self.assertEqual(len(stanzas), 1)
        self.assertEqual(extract_stanza_key(stanzas[0]), ("kvrocks", "amd64", "2.15.0-1"))

    def test_merge_append_new_version(self):
        old_content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
"""
        new_content = """Package: kvrocks
Version: 2.16.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.16.0-1_amd64.deb
"""
        old_file = os.path.join(self.temp_dir.name, "Packages.old")
        new_file = os.path.join(self.temp_dir.name, "Packages.new")
        out_file = os.path.join(self.temp_dir.name, "Packages")

        with open(old_file, "w", encoding="utf-8") as f:
            f.write(old_content)
        with open(new_file, "w", encoding="utf-8") as f:
            f.write(new_content)

        merge_packages(old_file, new_file, out_file)

        with open(out_file, "r", encoding="utf-8") as f:
            result = f.read()

        stanzas = parse_stanzas(result)
        self.assertEqual(len(stanzas), 2)
        keys = [extract_stanza_key(s) for s in stanzas]
        self.assertIn(("kvrocks", "amd64", "2.15.0-1"), keys)
        self.assertIn(("kvrocks", "amd64", "2.16.0-1"), keys)

    def test_merge_refuses_to_overwrite_indexed_version(self):
        old_file = self.write("Packages.old", stanza("kvrocks", "2.15.0-1", SHA256="oldhash"))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1", SHA256="newhash"))
        out_file = self.path("Packages")

        with self.assertRaises(ValueError):
            merge_packages(old_file, new_file, out_file)
        self.assertFalse(os.path.exists(out_file))

    def test_merge_in_place_keeps_history(self):
        index = self.write("Packages", stanza("kvrocks", "2.15.0-1"))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.16.0-1"))

        merge_packages(index, new_file, index)

        keys = [extract_stanza_key(s) for s in parse_stanzas(self.read("Packages"))]
        self.assertEqual(keys, [("kvrocks", "amd64", "2.15.0-1"), ("kvrocks", "amd64", "2.16.0-1")])

    def test_merge_output_is_sorted_and_world_readable(self):
        old_file = self.write("Packages.old", stanza("kvrocks-legacy", "2.15.0-1"))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))
        out_file = self.path("Packages")

        merge_packages(old_file, new_file, out_file)

        packages = [extract_stanza_key(s)[0] for s in parse_stanzas(self.read("Packages"))]
        self.assertEqual(packages, ["kvrocks", "kvrocks-legacy"])
        self.assertEqual(stat.S_IMODE(os.stat(out_file).st_mode), 0o644)
        self.assertFalse(os.path.exists(out_file + ".tmp"))

    def test_malformed_existing_stanza_raises_error(self):
        old_file = self.write("Packages.old", "Package: kvrocks\nVersion: 2.15.0-1\n")
        new_file = self.write("Packages.new", stanza("kvrocks", "2.16.0-1"))

        with self.assertRaises(ValueError):
            merge_packages(old_file, new_file, self.path("Packages"))

    def test_duplicate_stanza_within_one_file_raises_error(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1") + "\n" + stanza("kvrocks", "2.15.0-1"))

        with self.assertRaises(ValueError):
            merge_packages(None, new_file, self.path("Packages"))

    def test_undecodable_content_raises_error(self):
        new_file = self.path("Packages.new")
        with open(new_file, "wb") as f:
            f.write(b"Package: kvrocks\nVersion: 2.15.0-1\nArchitecture: amd64\nDescription: \xff\n")

        with self.assertRaises(UnicodeDecodeError):
            merge_packages(None, new_file, self.path("Packages"))

    def test_merge_missing_new_file_raises_error(self):
        nonexistent_file = os.path.join(self.temp_dir.name, "nonexistent.Packages")
        out_file = os.path.join(self.temp_dir.name, "Packages")
        with self.assertRaises(FileNotFoundError):
            merge_packages(None, nonexistent_file, out_file)

    def test_merge_empty_new_file_raises_error(self):
        empty_file = os.path.join(self.temp_dir.name, "empty.Packages")
        with open(empty_file, "w", encoding="utf-8") as f:
            f.write("\n   \n\n")
        out_file = os.path.join(self.temp_dir.name, "Packages")
        with self.assertRaises(ValueError):
            merge_packages(None, empty_file, out_file)

    def test_merge_invalid_stanza_raises_error(self):
        invalid_file = os.path.join(self.temp_dir.name, "invalid.Packages")
        with open(invalid_file, "w", encoding="utf-8") as f:
            f.write("Package: kvrocks\n# Missing Architecture and Version\n")
        out_file = os.path.join(self.temp_dir.name, "Packages")
        with self.assertRaises(ValueError):
            merge_packages(None, invalid_file, out_file)

    def test_merge_nonexistent_old_file_raises_error(self):
        new_content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
"""
        new_file = os.path.join(self.temp_dir.name, "Packages.new")
        with open(new_file, "w", encoding="utf-8") as f:
            f.write(new_content)
        out_file = os.path.join(self.temp_dir.name, "Packages")

        with self.assertRaises(FileNotFoundError):
            merge_packages("/nonexistent/path/Packages", new_file, out_file)


if __name__ == "__main__":
    unittest.main()
