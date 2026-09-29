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
});

test("resolveReleaseDownloadUrl - RPM packages", () => {
  // Standard x86_64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/x86_64/kvrocks-2.17.0-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.x86_64.rpm"
  );

  // Legacy x86_64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/x86_64/kvrocks-legacy-2.17.0-1.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-legacy-2.17.0-1.x86_64.rpm"
  );

  // Aarch64
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/aarch64/kvrocks-2.17.0-1.aarch64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1/kvrocks-2.17.0-1.aarch64.rpm"
  );

  // RPM with distro iteration (e.g. 1.el9)
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/x86_64/kvrocks-2.17.0-1.el9.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1.el9/kvrocks-2.17.0-1.el9.x86_64.rpm"
  );
  assert.equal(
    resolveReleaseDownloadUrl("/rpm/x86_64/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm"),
    "https://github.com/rawvoid/kvrocks-fpm/releases/download/v2.17.0-1.el9/kvrocks-legacy-2.17.0-1.el9.x86_64.rpm"
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
  assert.equal(resolveReleaseDownloadUrl("/rpm/x86_64/repodata/repomd.xml"), null);
  assert.equal(resolveReleaseDownloadUrl("/install.sh"), null);
  assert.equal(resolveReleaseDownloadUrl("/kvrocks.repo"), null);
  assert.equal(resolveReleaseDownloadUrl("/kvrocks.asc"), null);
  assert.equal(resolveReleaseDownloadUrl("/invalid_format.deb"), null);
  assert.equal(resolveReleaseDownloadUrl("/invalid_format.rpm"), null);
});

test("worker.fetch - Health check endpoint", async () => {
  const req = new Request("https://kvrocks-repo.example.com/healthz");
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.service, "kvrocks-package-repository-gateway");
  assert.equal(data.repository, DEFAULT_GITHUB_REPO);
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

test("worker.fetch - HEAD request support on health check", async () => {
  const req = new Request("https://kvrocks-repo.example.com/healthz", { method: "HEAD" });
  const res = await worker.fetch(req, {});

  assert.equal(res.status, 200);
});
