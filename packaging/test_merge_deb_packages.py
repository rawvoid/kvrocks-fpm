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


class TestMergeDebPackages(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.temp_dir.cleanup()

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

    def test_merge_overwrite_duplicate_version(self):
        old_content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
SHA256: oldhash
"""
        new_content = """Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
SHA256: newhash
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
        self.assertEqual(len(stanzas), 1)
        self.assertIn("SHA256: newhash", stanzas[0])
        self.assertNotIn("SHA256: oldhash", stanzas[0])


if __name__ == "__main__":
    unittest.main()
