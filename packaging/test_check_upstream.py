#!/usr/bin/env python3
"""
Unit tests for check-upstream.py.
"""

import importlib.util
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

script_path = os.path.join(os.path.dirname(__file__), "check-upstream.py")
spec = importlib.util.spec_from_file_location("check_upstream", script_path)
check_upstream = importlib.util.module_from_spec(spec)
sys.modules["check_upstream"] = check_upstream
spec.loader.exec_module(check_upstream)

parse_published_versions = check_upstream.parse_published_versions
parse_upstream_versions = check_upstream.parse_upstream_versions
select_version = check_upstream.select_version
version_key = check_upstream.version_key


def upstream_refs(*versions):
    return [f"deadbeef\trefs/tags/v{version}" for version in versions]


def published_refs(*versions, iteration=1):
    return [f"deadbeef\trefs/tags/v{version}-{iteration}" for version in versions]


class TestVersionOrdering(unittest.TestCase):
    def assert_before(self, first, second):
        self.assertLess(version_key(first), version_key(second))

    def test_prerelease_sorts_below_ga(self):
        self.assert_before("2.17.0-rc1", "2.17.0-rc2")
        self.assert_before("2.17.0-rc2", "2.17.0")

    def test_triplets_compare_numerically(self):
        self.assert_before("2.9.0", "2.16.0")
        self.assert_before("2.16.0", "2.17.0-rc1")
        self.assert_before("2.17.0", "2.18.0-rc1")
        self.assert_before("2.10.1", "2.11.0")

    def test_prerelease_numbers_compare_numerically(self):
        self.assert_before("2.17.0-rc1", "2.17.0-rc10")
        self.assert_before("2.17.0-rc2", "2.17.0-rc10")
        self.assert_before("2.17.0-rc.1", "2.17.0-rc.2")

    def test_equal_versions(self):
        self.assertEqual(version_key("2.17.0"), version_key("2.17.0"))
        self.assertEqual(version_key("2.17.0-rc1"), version_key("2.17.0-rc1"))


class TestTagParsing(unittest.TestCase):
    def test_upstream_parsing_ignores_peels_and_non_version_tags(self):
        lines = upstream_refs("2.17.0", "2.17.0-rc1", "2.17.0-rc2") + [
            "deadbeef\trefs/tags/v2.17.0-rc2^{}",
            "deadbeef\trefs/tags/weekly-2024-01-01",
            "deadbeef\trefs/tags/v2.5",
            "deadbeef\trefs/heads/unstable",
        ]
        self.assertEqual(parse_upstream_versions(lines), ["2.17.0-rc1", "2.17.0-rc2", "2.17.0"])

    def test_published_parsing_strips_iteration(self):
        lines = published_refs("2.17.0-rc2", "2.17.0", iteration=3) + [
            "deadbeef\trefs/tags/v2.17.0-rc2-1^{}",
            "deadbeef\trefs/tags/some-manual-tag",
        ]
        self.assertEqual(parse_published_versions(lines), ["2.17.0-rc2", "2.17.0"])

    def test_published_parsing_rejects_zero_iteration(self):
        self.assertEqual(parse_published_versions(["deadbeef\trefs/tags/v2.17.0-0"]), [])


class TestSelectVersion(unittest.TestCase):
    def test_picks_oldest_newer_version(self):
        upstream = ["2.17.0", "2.17.0-rc2", "2.18.0-rc1", "2.18.0-rc2", "2.18.0"]
        self.assertEqual(select_version(upstream, ["2.17.0", "2.17.0-rc2"]), "2.18.0-rc1")

    def test_picks_ga_when_only_ga_is_new(self):
        self.assertEqual(select_version(["2.17.0", "2.18.0"], ["2.17.0"]), "2.18.0")

    def test_returns_none_when_everything_published(self):
        upstream = ["2.17.0-rc1", "2.17.0-rc2", "2.17.0"]
        self.assertIsNone(select_version(upstream, ["2.17.0", "2.17.0-rc2"]))

    def test_skipped_rc_is_not_backfilled(self):
        self.assertIsNone(select_version(["2.17.0-rc1", "2.17.0"], ["2.17.0"]))

    def test_fresh_repository_aligns_with_newest(self):
        upstream = ["2.16.0", "2.17.0-rc1", "2.17.0", "2.18.0-rc1", "2.18.0"]
        self.assertEqual(select_version(upstream, []), "2.18.0")

    def test_empty_upstream_raises(self):
        with self.assertRaises(ValueError):
            select_version([], ["2.17.0"])


class TestMain(unittest.TestCase):
    def run_main(self, upstream_lines, published_lines):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = os.path.join(temp_dir, "outputs")
            with patch.object(
                check_upstream, "ls_remote_tags", side_effect=[upstream_lines, published_lines]
            ), patch.dict(os.environ, {"GITHUB_OUTPUT": output}), patch.object(
                sys, "argv", ["check-upstream.py"]
            ):
                code = check_upstream.main()
            with open(output, encoding="utf-8") as f:
                content = f.read()
        return code, content

    def test_main_reports_new_version(self):
        code, content = self.run_main(
            upstream_refs("2.17.0", "2.18.0-rc1"), published_refs("2.17.0")
        )
        self.assertEqual(code, 0)
        self.assertIn("should_build=true", content)
        self.assertIn("version=2.18.0-rc1", content)

    def test_main_reports_nothing_new(self):
        code, content = self.run_main(
            upstream_refs("2.17.0-rc1", "2.17.0"), published_refs("2.17.0-rc1", "2.17.0")
        )
        self.assertEqual(code, 0)
        self.assertIn("should_build=false", content)

    def test_main_fails_without_upstream(self):
        with patch.object(check_upstream, "ls_remote_tags", return_value=[]), patch.object(
            sys, "argv", ["check-upstream.py"]
        ):
            self.assertEqual(check_upstream.main(), 1)


if __name__ == "__main__":
    unittest.main()
