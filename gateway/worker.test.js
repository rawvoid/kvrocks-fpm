import test from "node:test";
import assert from "node:assert/strict";
import worker, { resolveReleaseDownloadUrl } from "./worker.js";

// Test-only generic fixtures to ensure decoupling from production configuration
const TEST_REPO = "test-owner/test-repo";
const TEST_METADATA_ORIGIN = "https://test-pages.example.com";
const TEST_ENV = {
  GITHUB_REPO: TEST_REPO,
  METADATA_ORIGIN: TEST_METADATA_ORIGIN,
};

const resolve = (pathname) => resolveReleaseDownloadUrl(pathname, TEST_REPO);

test("resolveReleaseDownloadUrl - Debian packages", () => {
  // Standard amd64
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb`
  );

  // Legacy amd64
  assert.equal(
    resolve("/pool/main/kvrocks-legacy_2.17.0-1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-legacy_2.17.0-1_amd64.deb`
  );

  // Arm64
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1_arm64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks_2.17.0-1_arm64.deb`
  );

  // Multi-digit iteration
  assert.equal(
    resolve("/pool/main/kvrocks_2.10.1-10_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.10.1-10/kvrocks_2.10.1-10_amd64.deb`
  );

  // Alphanumeric revision / distribution tag
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1ubuntu1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1ubuntu1/kvrocks_2.17.0-1ubuntu1_amd64.deb`
  );

  // Debian backports special characters (~ and +)
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1~bpo11+1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1~bpo11+1/kvrocks_2.17.0-1~bpo11+1_amd64.deb`
  );

  // Pre-release package (RC / testing)
  assert.equal(
    resolve("/pool/main/kvrocks_2.15.0-rc1-1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.15.0-rc1-1/kvrocks_2.15.0-rc1-1_amd64.deb`
  );
});

test("resolveReleaseDownloadUrl - RPM packages", () => {
  // Stable channel x86_64
  assert.equal(
    resolve("/rpm/stable/x86_64/kvrocks-2.17.0-1.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-2.17.0-1.x86_64.rpm`
  );

  // Stable channel Legacy x86_64
  assert.equal(
    resolve("/rpm/stable/x86_64/kvrocks-legacy-2.17.0-1.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-legacy-2.17.0-1.x86_64.rpm`
  );

  // Stable channel Aarch64
  assert.equal(
    resolve("/rpm/stable/aarch64/kvrocks-2.17.0-1.aarch64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-2.17.0-1.aarch64.rpm`
  );

  // RPM with distro iteration (e.g. 1.el9, 1.el8)
  assert.equal(
    resolve("/rpm/stable/x86_64/kvrocks-2.17.0-1.el9.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1.el9/kvrocks-2.17.0-1.el9.x86_64.rpm`
  );
  assert.equal(
    resolve("/rpm/stable/x86_64/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1.el9/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm`
  );
  assert.equal(
    resolve("/rpm/stable/aarch64/kvrocks-2.17.0-1.el8.aarch64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1.el8/kvrocks-2.17.0-1.el8.aarch64.rpm`
  );

  // Testing channel RPM packages
  assert.equal(
    resolve("/rpm/testing/x86_64/kvrocks-2.17.0-1.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-2.17.0-1.x86_64.rpm`
  );
  assert.equal(
    resolve("/rpm/testing/aarch64/kvrocks-2.17.0-1.aarch64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks-2.17.0-1.aarch64.rpm`
  );

  // Pre-release package in testing channel (e.g. rc1)
  assert.equal(
    resolve("/rpm/testing/x86_64/kvrocks-2.15.0-rc1-1.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.15.0-rc1-1/kvrocks-2.15.0-rc1-1.x86_64.rpm`
  );
});

test("resolveReleaseDownloadUrl - Custom repository slug", () => {
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_amd64.deb", "myorg/custom-kvrocks"),
    "https://github.com/myorg/custom-kvrocks/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb"
  );
});

test("resolveReleaseDownloadUrl - Non-package files return null", () => {
  assert.equal(resolve("/dists/stable/InRelease"), null);
  assert.equal(resolve("/dists/testing/InRelease"), null);
  assert.equal(resolve("/rpm/stable/x86_64/repodata/repomd.xml"), null);
  assert.equal(resolve("/rpm/testing/x86_64/repodata/repomd.xml"), null);
  assert.equal(resolve("/install.sh"), null);
  assert.equal(resolve("/kvrocks.repo"), null);
  assert.equal(resolve("/kvrocks.asc"), null);
  assert.equal(resolve("/invalid_format.deb"), null);
  assert.equal(resolve("/invalid_format.rpm"), null);
});

test("resolveReleaseDownloadUrl - Missing arguments return null safely", () => {
  assert.equal(resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_amd64.deb", null), null);
  assert.equal(resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_amd64.deb", ""), null);
  assert.equal(resolveReleaseDownloadUrl(null, TEST_REPO), null);
  assert.equal(resolveReleaseDownloadUrl("", TEST_REPO), null);
});

test("worker.fetch - Root landing page proxies /index.html", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let proxiedUrl = null;
    globalThis.fetch = async (req) => {
      proxiedUrl = typeof req === "string" ? req : req.url;
      return new Response("<!DOCTYPE html><html><body>Kvrocks</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };

    const req = new Request("https://kvrocks-repo.example.com/");
    const res = await worker.fetch(req, TEST_ENV);

    assert.equal(res.status, 200);
    assert.equal(proxiedUrl, `${TEST_METADATA_ORIGIN}/index.html`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "public, max-age=600, s-maxage=600");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker.fetch - Static script /install.sh proxying", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let proxiedUrl = null;
    globalThis.fetch = async (req) => {
      proxiedUrl = typeof req === "string" ? req : req.url;
      return new Response("#!/bin/sh\necho install", {
        status: 200,
        headers: { "Content-Type": "text/x-shellscript; charset=utf-8" },
      });
    };

    const req = new Request("https://kvrocks-repo.example.com/install.sh");
    const res = await worker.fetch(req, TEST_ENV);

    assert.equal(res.status, 200);
    assert.equal(proxiedUrl, `${TEST_METADATA_ORIGIN}/install.sh`);
    assert.equal(res.headers.get("cache-control"), "public, max-age=600, s-maxage=600");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker.fetch - Invalid package naming returns 404", async () => {
  const req = new Request("https://kvrocks-repo.example.com/pool/main/badname.deb");
  const res = await worker.fetch(req, TEST_ENV);

  assert.equal(res.status, 404);
});

test("worker.fetch - Missing environment variables returns 500 (Fail-Fast)", async () => {
  const req = new Request("https://kvrocks-repo.example.com/pool/main/kvrocks_2.17.0-1_amd64.deb");

  // Empty env
  const resEmpty = await worker.fetch(req, {});
  assert.equal(resEmpty.status, 500);

  // Missing METADATA_ORIGIN
  const resMissingMeta = await worker.fetch(req, { GITHUB_REPO: TEST_REPO });
  assert.equal(resMissingMeta.status, 500);

  // Missing GITHUB_REPO
  const resMissingRepo = await worker.fetch(req, { METADATA_ORIGIN: TEST_METADATA_ORIGIN });
  assert.equal(resMissingRepo.status, 500);
});
