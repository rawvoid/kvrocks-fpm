import test from "node:test";
import assert from "node:assert/strict";
import worker, { resolveReleaseDownloadUrl, DEFAULT_GITHUB_REPO } from "./worker.js";

test("resolveReleaseDownloadUrl - Debian packages", () => {
  // Standard amd64
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_amd64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb"
  );

  // Legacy amd64
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks-legacy_2.17.0-1_amd64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-legacy_2.17.0-1_amd64.deb"
  );

  // Arm64
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_arm64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks_2.17.0-1_arm64.deb"
  );

  // Multi-digit iteration
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.10.1-10_amd64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.10.1-10/kvrocks_2.10.1-10_amd64.deb"
  );

  // Alphanumeric revision / distribution tag
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1ubuntu1_amd64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1ubuntu1/kvrocks_2.17.0-1ubuntu1_amd64.deb"
  );

  // Pre-release package (RC / testing)
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.15.0-rc1-1_amd64.deb"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.15.0-rc1-1/kvrocks_2.15.0-rc1-1_amd64.deb"
  );
});

test("resolveReleaseDownloadUrl - RPM packages", () => {
  // Stable channel x86_64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/stable/x86_64/kvrocks-2.17.0-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.x86_64.rpm"
  );

  // Stable channel Legacy x86_64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/stable/x86_64/kvrocks-legacy-2.17.0-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-legacy-2.17.0-1.x86_64.rpm"
  );

  // Stable channel Aarch64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/stable/aarch64/kvrocks-2.17.0-1.aarch64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.aarch64.rpm"
  );

  // RPM with distro iteration (e.g. 1.el9)
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/stable/x86_64/kvrocks-2.17.0-1.el9.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1.el9/kvrocks-2.17.0-1.el9.x86_64.rpm"
  );
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/stable/x86_64/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1.el9/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm"
  );

  // Testing channel RPM packages
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/testing/x86_64/kvrocks-2.17.0-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.x86_64.rpm"
  );
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/testing/aarch64/kvrocks-2.17.0-1.aarch64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.aarch64.rpm"
  );

  // Pre-release package in testing channel (e.g. rc1)
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/testing/x86_64/kvrocks-2.15.0-rc1-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.15.0-rc1-1/kvrocks-2.15.0-rc1-1.x86_64.rpm"
  );
});

test("resolveReleaseDownloadUrl - Custom repository slug", () => {
  assert.equal(
    resolveReleaseDownloadUrl("/pool/main/kvrocks_2.17.0-1_amd64.deb", "myorg/custom-kvrocks"),
    "https://github.com/myorg/custom-kvrocks/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb"
  );
});

test("resolveReleaseDownloadUrl - Non-package files return null", () => {
  assert.equal(resolveReleaseDownloadUrl("/dists/stable/InRelease"), null);
  assert.equal(resolveReleaseDownloadUrl("/dists/testing/InRelease"), null);
  assert.equal(resolveReleaseDownloadUrl("/rpm/stable/x86_64/repodata/repomd.xml"), null);
  assert.equal(resolveReleaseDownloadUrl("/rpm/testing/x86_64/repodata/repomd.xml"), null);
  assert.equal(resolveReleaseDownloadUrl("/install.sh"), null);
  assert.equal(resolveReleaseDownloadUrl("/kvrocks.repo"), null);
  assert.equal(resolveReleaseDownloadUrl("/kvrocks.asc"), null);
  assert.equal(resolveReleaseDownloadUrl("/invalid_format.deb"), null);
  assert.equal(resolveReleaseDownloadUrl("/invalid_format.rpm"), null);
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
    const res = await worker.fetch(req, { METADATA_ORIGIN: "https://rawvoid.github.io/kvrocks-fpm" });

    assert.equal(res.status, 200);
    assert.equal(proxiedUrl, "https://rawvoid.github.io/kvrocks-fpm/index.html");
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
    const res = await worker.fetch(req, { METADATA_ORIGIN: "https://rawvoid.github.io/kvrocks-fpm" });

    assert.equal(res.status, 200);
    assert.equal(proxiedUrl, "https://rawvoid.github.io/kvrocks-fpm/install.sh");
    assert.equal(res.headers.get("cache-control"), "public, max-age=600, s-maxage=600");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker.fetch - Redirect mode (?redirect=1)", async () => {
  const req = new Request("https://kvrocks-repo.example.com/pool/main/kvrocks_2.17.0-1_amd64.deb?redirect=1");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get("location"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb"
  );
});

test("worker.fetch - Invalid package naming returns 404", async () => {
  const req = new Request("https://kvrocks-repo.example.com/pool/main/badname.deb");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 404);
});
