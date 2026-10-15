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
from unittest.mock import patch

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
        # Description is multiline; its continuation lines are not fields
        key = extract_stanza_key(f"package: kvrocks\nDescription: text\n Version: not-a-field\nversion: 1.0-1\narchitecture: arm64\nsha256: {HASH_A}")
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
        key1 = extract_stanza_key(stanzas[0])
        self.assertEqual(key1, ("kvrocks", "amd64", "2.15.0-1"))
        key2 = extract_stanza_key(stanzas[1])
        self.assertEqual(key2, ("kvrocks-legacy", "amd64", "2.15.0-1"))

    def test_merge_initial_new_only(self):
        new_content = f"""Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
Size: 123
SHA256: {HASH_A}
"""
        new_file = self.write("Packages.new", new_content)
        target_file = self.path("Packages")

        merge_packages(new_file, target_file)

        result = self.read("Packages")
        stanzas = parse_stanzas(result)
        self.assertEqual(len(stanzas), 1)
        self.assertEqual(extract_stanza_key(stanzas[0]), ("kvrocks", "amd64", "2.15.0-1"))

    def test_merge_append_new_version(self):
        old_content = f"""Package: kvrocks
Version: 2.15.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.15.0-1_amd64.deb
SHA256: {HASH_A}
"""
        new_content = f"""Package: kvrocks
Version: 2.16.0-1
Architecture: amd64
Filename: pool/main/kvrocks_2.16.0-1_amd64.deb
SHA256: {HASH_B}
"""
        target_file = self.write("Packages", old_content)
        new_file = self.write("Packages.new", new_content)

        merge_packages(new_file, target_file)

        result = self.read("Packages")
        stanzas = parse_stanzas(result)
        self.assertEqual(len(stanzas), 2)
        keys = [extract_stanza_key(s) for s in stanzas]
        self.assertEqual(keys, [("kvrocks", "amd64", "2.15.0-1"), ("kvrocks", "amd64", "2.16.0-1")])
        self.assertEqual(result, old_content + "\n" + new_content)

    def test_merge_refuses_to_overwrite_indexed_version(self):
        target_file = self.write("Packages", stanza("kvrocks", "2.15.0-1", SHA256=HASH_A))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1", SHA256=HASH_B))

        with self.assertRaises(ValueError):
            merge_packages(new_file, target_file)
        self.assertEqual(self.read("Packages"), stanza("kvrocks", "2.15.0-1", SHA256=HASH_A))

    def test_merge_in_place_keeps_history(self):
        target_file = self.write("Packages", stanza("kvrocks", "2.15.0-1"))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.16.0-1"))

        merge_packages(new_file, target_file)

        keys = [extract_stanza_key(s) for s in parse_stanzas(self.read("Packages"))]
        self.assertEqual(keys, [("kvrocks", "amd64", "2.15.0-1"), ("kvrocks", "amd64", "2.16.0-1")])

    def test_merge_output_preserves_history_and_is_world_readable(self):
        target_file = self.write("Packages", stanza("kvrocks-legacy", "2.15.0-1"))
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))

        merge_packages(new_file, target_file)

        packages = [extract_stanza_key(s)[0] for s in parse_stanzas(self.read("Packages"))]
        self.assertEqual(packages, ["kvrocks-legacy", "kvrocks"])
        self.assertEqual(stat.S_IMODE(os.stat(target_file).st_mode), 0o644)
        self.assertEqual(set(os.listdir(self.temp_dir.name)), {"Packages.new", "Packages"})

    def test_atomic_replace_failure_keeps_output_and_cleans_temp(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))
        initial_content = stanza("kvrocks-existing", "1.0.0")
        target_file = self.write("Packages", initial_content)

        with patch.object(merge_deb_packages.Path, "replace", side_effect=OSError("replace failed")):
            with self.assertRaises(OSError):
                merge_packages(new_file, target_file)

        self.assertEqual(self.read("Packages"), initial_content)
        self.assertEqual(set(os.listdir(self.temp_dir.name)), {"Packages.new", "Packages"})

    def test_malformed_existing_stanza_raises_error(self):
        target_file = self.write("Packages", "Package: kvrocks\nVersion: 2.15.0-1\n")
        new_file = self.write("Packages.new", stanza("kvrocks", "2.16.0-1"))

        with self.assertRaises(ValueError):
            merge_packages(new_file, target_file)

    def test_duplicate_stanza_within_one_file_raises_error(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1") + "\n" + stanza("kvrocks", "2.15.0-1"))
        target_file = self.path("Packages")

        with self.assertRaises(ValueError):
            merge_packages(new_file, target_file)

    def test_undecodable_content_raises_error(self):
        new_file = self.path("Packages.new")
        with open(new_file, "wb") as f:
            f.write(b"Package: kvrocks\nVersion: 2.15.0-1\nArchitecture: amd64\nDescription: \xff\n")

        with self.assertRaises(UnicodeDecodeError):
            merge_packages(new_file, self.path("Packages"))

    def test_merge_missing_new_file_raises_error(self):
        nonexistent_file = os.path.join(self.temp_dir.name, "nonexistent.Packages")
        target_file = os.path.join(self.temp_dir.name, "Packages")
        with self.assertRaises(FileNotFoundError):
            merge_packages(nonexistent_file, target_file)

    def test_merge_empty_new_file_raises_error(self):
        empty_file = self.write("empty.Packages", "\n   \n\n")
        target_file = self.path("Packages")
        with self.assertRaises(ValueError):
            merge_packages(empty_file, target_file)

    def test_merge_invalid_stanza_raises_error(self):
        invalid_file = self.write("invalid.Packages", "Package: kvrocks\n# Missing Architecture and Version\n")
        target_file = self.path("Packages")
        with self.assertRaises(ValueError):
            merge_packages(invalid_file, target_file)

    def test_merge_creates_target_file_if_not_exists(self):
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))
        target_file = self.path("Packages")
        self.assertFalse(os.path.exists(target_file))

        merge_packages(new_file, target_file)
        self.assertTrue(os.path.exists(target_file))
        self.assertEqual(self.read("Packages"), stanza("kvrocks", "2.15.0-1"))

    def test_merge_identical_package_is_idempotent(self):
        old_content = stanza("kvrocks", "2.15.0-1", SHA256=HASH_A, Description="Published metadata")
        target_file = self.write("Packages", old_content)
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1", SHA256=HASH_A, Description="Retry metadata"))

        merge_packages(new_file, target_file)

        stanzas = parse_stanzas(self.read("Packages"))
        self.assertEqual(len(stanzas), 1)
        self.assertEqual(extract_stanza_key(stanzas[0]), ("kvrocks", "amd64", "2.15.0-1"))
        self.assertEqual(self.read("Packages"), old_content)

    def test_merge_crlf_normalized_to_unix_lf(self):
        crlf_content = stanza("kvrocks", "2.15.0-1").replace("\n", "\r\n") + "\r\n"
        new_file = self.write("Packages.new", crlf_content)
        target_file = self.path("Packages")

        merge_packages(new_file, target_file)

        with open(target_file, "rb") as f:
            raw = f.read().decode("utf-8")
        self.assertNotIn("\r", raw)
        self.assertEqual(raw, stanza("kvrocks", "2.15.0-1"))

    def test_duplicate_field_in_stanza_raises_error(self):
        with self.assertRaises(ValueError):
            extract_stanza_key(f"Package: kvrocks\nVersion: 1.0\nversion: 2.0\nArchitecture: amd64\nSHA256: {HASH_A}\n")

    def test_whitespace_before_colon_raises_error(self):
        with self.assertRaises(ValueError):
            extract_stanza_key(f"Package : kvrocks\nVersion: 1.0\nArchitecture: amd64\nSHA256: {HASH_A}\n")

    def test_single_line_field_continuation_raises_error(self):
        for name, value in (("Package", "kvrocks"), ("Version", "1.0-1"), ("Architecture", "amd64"), ("SHA256", HASH_A)):
            with self.subTest(field=name):
                content = stanza("kvrocks", "1.0-1").replace(f"{name}: {value}\n", f"{name}: {value}\n  illegal-folding\n")
                with self.assertRaises(ValueError):
                    extract_stanza_key(content)

    def test_orphaned_continuation_line_raises_error(self):
        with self.assertRaises(ValueError):
            extract_stanza_key(f"  orphaned\nPackage: kvrocks\nVersion: 1.0\nArchitecture: amd64\nSHA256: {HASH_A}\n")

    def test_merge_rejects_indented_first_field_without_changing_output(self):
        initial_content = stanza("kvrocks-existing", "1.0.0")
        target_file = self.write("Packages", initial_content)
        for prefix in (" ", "\t"):
            with self.subTest(prefix=prefix):
                new_file = self.write("Packages.new", prefix + stanza("kvrocks", "2.15.0-1"))
                with self.assertRaisesRegex(ValueError, "Orphaned continuation"):
                    merge_packages(new_file, target_file)
                self.assertEqual(self.read("Packages"), initial_content)

    def test_merge_preserves_multiline_fields(self):
        content = stanza(
            "kvrocks", "2.15.0-1",
            Description="First line\n Second line\n .\n Last line ",
            Depends="libc6,\n libstdc++6",
            **{"X.Meta": "extension"},
        )
        new_file = self.write("Packages.new", "\n \t\n" + content + "\n \t\n")
        target_file = self.path("Packages")

        merge_packages(new_file, target_file)

        self.assertEqual(self.read("Packages"), content)

    def test_merge_requires_nonempty_identity_and_checksum_fields(self):
        initial_content = stanza("kvrocks-existing", "1.0.0")
        target_file = self.write("Packages", initial_content)
        for name, value in (("Package", "kvrocks"), ("Version", "2.15.0-1"), ("Architecture", "amd64"), ("SHA256", HASH_A)):
            for replacement in ("", f"{name}: \n"):
                with self.subTest(field=name, replacement=replacement):
                    content = stanza("kvrocks", "2.15.0-1").replace(f"{name}: {value}\n", replacement)
                    new_file = self.write("Packages.new", content)
                    with self.assertRaisesRegex(ValueError, "missing required field"):
                        merge_packages(new_file, target_file)
                    self.assertEqual(self.read("Packages"), initial_content)

    def test_empty_target_file_raises_error(self):
        empty_target = self.write("Packages", "\n   \n")
        new_file = self.write("Packages.new", stanza("kvrocks", "2.15.0-1"))

        with self.assertRaises(ValueError):
            merge_packages(new_file, empty_target)
        self.assertEqual(self.read("Packages"), "\n   \n")


if __name__ == "__main__":
    unittest.main()
