import test from "node:test";
import assert from "node:assert/strict";
import worker, {
  compareVersions,
  parseUpstreamTagsAtom,
  resolveMetadataOrigin,
  resolveReleaseDownloadUrl,
  selectPendingReleaseVersions,
} from "../src/index.js";

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

  // Pre-release package with dots in version (e.g. rc.1)
  assert.equal(
    resolve("/rpm/testing/x86_64/kvrocks-2.15.0-rc.1-1.x86_64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.15.0-rc.1-1/kvrocks-2.15.0-rc.1-1.x86_64.rpm`
  );

  // Pre-release package with beta and distro iteration
  assert.equal(
    resolve("/rpm/testing/aarch64/kvrocks-2.15.0-beta.2-2.el9.aarch64.rpm"),
    `https://github.com/${TEST_REPO}/releases/download/v2.15.0-beta.2-2.el9/kvrocks-2.15.0-beta.2-2.el9.aarch64.rpm`
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

test("resolveReleaseDownloadUrl - Decodes percent-encoded filenames (%2b, %7e)", () => {
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1%2bdeb11_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1+deb11/kvrocks_2.17.0-1+deb11_amd64.deb`
  );
  assert.equal(
    resolve("/pool/main/kvrocks_2.17.0-1%7ebpo11+1_amd64.deb"),
    `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1~bpo11+1/kvrocks_2.17.0-1~bpo11+1_amd64.deb`
  );
});

test("resolveReleaseDownloadUrl - Rejects filenames with ?, # or /", () => {
  assert.equal(resolve("/pool/main/kvrocks_2.17.0%23inject-1_amd64.deb"), null);
  assert.equal(resolve("/pool/main/kvrocks_2.17.0%3fquery-1_amd64.deb"), null);
  assert.equal(resolve("/pool/main/kvrocks_2.17.0-1%2f..%2f..%2fother_amd64.deb"), null);
});

test("resolveReleaseDownloadUrl - Malformed percent-encoding returns null", () => {
  assert.equal(resolve("/pool/main/kvrocks_2.17.0-1%E0%A4%A_amd64.deb"), null);
});

// ---------------------------------------------------------------------------
// worker.fetch
// ---------------------------------------------------------------------------

const PKG_PATH = "/pool/main/kvrocks_2.17.0-1_amd64.deb";
const PKG_URL = `https://github.com/${TEST_REPO}/releases/download/v2.17.0-1/kvrocks_2.17.0-1_amd64.deb`;

function memoryCache(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    matchKeys: [],
    async match(request) {
      this.matchKeys.push(request);
      return store.get(request.url)?.clone();
    },
    async put(request, response) {
      store.set(request.url, response);
    },
  };
}

/**
 * Runs worker.fetch with stubbed global fetch/caches and returns the response together with the
 * upstream fetch calls. `upstream` is a function returning the stubbed upstream Response.
 */
async function call(
  path,
  { method = "GET", headers = {}, env = TEST_ENV, upstream = () => new Response("ok"), cache = memoryCache() } = {}
) {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const fetchCalls = [];
  const pending = [];

  globalThis.fetch = async (input, init) => {
    fetchCalls.push({ url: String(input), init });
    return upstream();
  };
  globalThis.caches = { default: cache };

  try {
    const request = new Request(`https://kvrocks-repo.example.com${path}`, { method, headers });
    const res = await worker.fetch(request, env, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    return { res, fetchCalls, cache };
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
}

test("worker.fetch - Only GET and HEAD are served", async () => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const { res, fetchCalls } = await call("/dists/stable/InRelease", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
    assert.equal(fetchCalls.length, 0);
  }
});

test("worker.fetch - Missing environment variables returns 500 (Fail-Fast)", async () => {
  for (const env of [{}, { METADATA_ORIGIN: TEST_METADATA_ORIGIN }]) {
    const { res, fetchCalls } = await call(PKG_PATH, { env });
    assert.equal(res.status, 500);
    assert.equal(fetchCalls.length, 0);
  }
});

test("resolveMetadataOrigin - Derived from GITHUB_REPO, overridden by METADATA_ORIGIN", () => {
  assert.equal(resolveMetadataOrigin({ GITHUB_REPO: TEST_REPO }), "https://test-owner.github.io/test-repo");
  assert.equal(
    resolveMetadataOrigin({ GITHUB_REPO: TEST_REPO, METADATA_ORIGIN: "https://pages.example.com" }),
    "https://pages.example.com"
  );
  assert.equal(resolveMetadataOrigin({}), null);
  assert.equal(resolveMetadataOrigin({ GITHUB_REPO: "no-slash" }), null);
});

test("worker.fetch - Invalid package naming returns 404 without contacting upstream", async () => {
  const { res, fetchCalls } = await call("/pool/main/badname.deb");
  assert.equal(res.status, 404);
  assert.equal(fetchCalls.length, 0);
});

test("worker.fetch - Package filenames outside /pool/ and /rpm/ are treated as metadata", async () => {
  for (const path of ["/other/kvrocks_2.17.0-1_amd64.deb", "/packages/kvrocks-2.17.0-1.x86_64.rpm"]) {
    const { fetchCalls } = await call(path);
    assert.equal(fetchCalls[0].url, `${TEST_METADATA_ORIGIN}${path}`);
  }
});

// --- Packages ---------------------------------------------------------------

test("worker.fetch - Package cache miss streams from GitHub, strips upstream headers and populates the cache", async () => {
  const upstream = () =>
    new Response("binary-data-stream", {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "18",
        "x-amz-request-id": "amz-12345",
        "x-github-request-id": "gh-67890",
        "set-cookie": "session=xyz",
      },
    });
  const { res, fetchCalls, cache } = await call(`${PKG_PATH}?cachebust=1`, { upstream });

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "binary-data-stream");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, PKG_URL);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-cache-status"), "MISS-FETCHED-FROM-GITHUB");
  for (const name of ["x-amz-request-id", "x-github-request-id", "set-cookie"]) {
    assert.equal(res.headers.has(name), false, name);
  }

  // Cached under the canonical GitHub URL, independent of the query string
  assert.deepEqual([...cache.store.keys()], [PKG_URL]);
});

test("worker.fetch - Package cache hit is served from cache under the canonical key", async () => {
  const cache = memoryCache({
    [PKG_URL]: new Response("cached-binary", { headers: { "Content-Type": "application/octet-stream" } }),
  });
  const { res, fetchCalls } = await call(`${PKG_PATH}?cachebust=random123`, { cache });

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "cached-binary");
  assert.equal(res.headers.get("x-cache-status"), "HIT-CLOUDFLARE-EDGE");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(fetchCalls.length, 0);
  assert.equal(cache.matchKeys[0].url, PKG_URL);
});

test("worker.fetch - Package HEAD cache hit cancels the cached body stream", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const cache = memoryCache();
  cache.match = async () => new Response(body, { headers: { "Content-Length": "123456" } });

  const { res } = await call(PKG_PATH, { method: "HEAD", cache });

  assert.equal(res.status, 200);
  assert.equal(res.body, null);
  assert.equal(res.headers.get("content-length"), "123456");
  assert.equal(res.headers.get("x-cache-status"), "HIT-CLOUDFLARE-EDGE");
  assert.equal(cancelled, true);
});

test("worker.fetch - Package HEAD miss uses GET upstream, returns no body and does not populate the cache", async () => {
  let cancelled = false;
  const upstream = () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Length": "12345678" } }
    );
  const { res, fetchCalls, cache } = await call(PKG_PATH, { method: "HEAD", upstream });

  assert.equal(res.status, 200);
  assert.equal(res.body, null);
  assert.equal(res.headers.get("content-length"), "12345678");
  assert.equal(fetchCalls[0].init.method ?? "GET", "GET");
  assert.equal(cancelled, true);
  assert.equal(cache.store.size, 0);
});

test("worker.fetch - Package Range miss forwards Range/If-Range, returns 206 and is not cached", async () => {
  const upstream = () =>
    new Response("partial-stream-chunk", {
      status: 206,
      headers: { "Content-Range": "bytes 100-119/1000", "Content-Length": "20" },
    });
  const { res, fetchCalls, cache } = await call(PKG_PATH, {
    headers: { Range: "bytes=100-", "If-Range": '"etag-val"' },
    upstream,
  });

  assert.equal(res.status, 206);
  assert.equal(await res.text(), "partial-stream-chunk");
  assert.equal(res.headers.get("content-range"), "bytes 100-119/1000");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(fetchCalls[0].init.headers["Range"], "bytes=100-");
  assert.equal(fetchCalls[0].init.headers["If-Range"], '"etag-val"');
  assert.equal(cache.store.size, 0);
});

test("worker.fetch - Package Range request is matched against the cache with its Range header", async () => {
  const cache = memoryCache();
  cache.match = async (request) => {
    cache.matchedRange = request.headers.get("Range");
    return new Response("chunk", { status: 206, headers: { "Content-Range": "bytes 0-4/1000" } });
  };
  const { res, fetchCalls } = await call(PKG_PATH, { headers: { Range: "bytes=0-4" }, cache });

  assert.equal(res.status, 206);
  assert.equal(res.headers.get("x-cache-status"), "HIT-CLOUDFLARE-EDGE");
  assert.equal(res.headers.get("content-range"), "bytes 0-4/1000");
  assert.equal(cache.matchedRange, "bytes=0-4");
  assert.equal(fetchCalls.length, 0);
});

test("worker.fetch - Package upstream errors are passed through, never cached", async () => {
  const { res, cache } = await call(PKG_PATH, {
    upstream: () => new Response("Not Found", { status: 404, statusText: "Not Found" }),
  });

  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(cache.store.size, 0);
});

test("worker.fetch - Package upstream network failure returns a plain-text 502, never cached", async () => {
  const { res, cache } = await call(PKG_PATH, {
    upstream: () => {
      throw new TypeError("fetch failed");
    },
  });

  assert.equal(res.status, 502);
  assert.equal(res.headers.get("content-type"), "text/plain");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /GitHub Releases/);
  assert.equal(cache.store.size, 0);
});

// --- Metadata ---------------------------------------------------------------

test("worker.fetch - Root path is proxied verbatim, without forwarding client headers or query string", async () => {
  const { res, fetchCalls } = await call("/?rand=42", {
    headers: { Cookie: "session=xyz", "User-Agent": "Custom-Agent", Range: "bytes=0-100" },
    upstream: () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
  });

  assert.equal(res.status, 200);
  assert.equal(fetchCalls[0].url, `${TEST_METADATA_ORIGIN}/`);
  assert.equal(fetchCalls[0].init.headers, undefined);
  assert.equal(res.headers.has("access-control-allow-origin"), false);
});

test("worker.fetch - Metadata target always stays on the configured origin", async () => {
  const { fetchCalls } = await call("//evil.example.net/x");
  assert.equal(fetchCalls[0].url, `${TEST_METADATA_ORIGIN}//evil.example.net/x`);

  const prefixed = { ...TEST_ENV, METADATA_ORIGIN: "https://pages.example.com/project/" };
  const { fetchCalls: prefixedCalls } = await call("/kvrocks.repo", { env: prefixed });
  assert.equal(prefixedCalls[0].url, "https://pages.example.com/project/kvrocks.repo");
});

test("worker.fetch - Metadata Cache-Control policy per resource type", async () => {
  const hash = "4a2b6e8f1234567890abcdef12345678";
  const expectations = {
    "public, max-age=60, s-maxage=60": [
      "/dists/stable/InRelease",
      "/dists/stable/Release",
      "/dists/stable/Release.gpg",
      "/dists/stable/main/binary-amd64/Packages",
      "/dists/stable/main/binary-amd64/Packages.gz",
      "/dists/stable/main/binary-amd64/Packages.xz",
      "/rpm/stable/x86_64/repodata/repomd.xml",
      "/rpm/stable/x86_64/repodata/repomd.xml.asc",
    ],
    "public, max-age=2592000, s-maxage=2592000, immutable": [
      `/rpm/stable/x86_64/repodata/${hash}-primary.xml.gz`,
      `/rpm/stable/x86_64/repodata/${hash}-filelists.xml.gz`,
      `/rpm/stable/x86_64/repodata/${hash}-primary.sqlite.bz2`,
      `/rpm/stable/x86_64/repodata/${hash}-modules.yaml.gz`,
    ],
    "public, max-age=86400, s-maxage=86400": ["/kvrocks.asc", "/kvrocks.gpg"],
    "public, max-age=600, s-maxage=600": [
      "/",
      "/kvrocks.repo",
      "/rpm/stable/x86_64/repodata/comps.xml",
      "/rpm/stable/x86_64/repodata/productid.xml.gz",
    ],
  };

  for (const [expected, paths] of Object.entries(expectations)) {
    for (const path of paths) {
      const { res } = await call(path);
      assert.equal(res.headers.get("cache-control"), expected, path);
    }
  }
});

test("worker.fetch - Metadata subrequest caches by status without pinning errors", async () => {
  const { fetchCalls } = await call("/dists/stable/InRelease");
  assert.deepEqual(fetchCalls[0].init.cf, {
    cacheEverything: true,
    cacheTtlByStatus: { "200-299": 60, "404": 30, "500-599": -1 },
  });
});

test("worker.fetch - Metadata errors never get a long Cache-Control", async () => {
  const hashed = "/rpm/stable/x86_64/repodata/4a2b6e8f1234567890abcdef12345678-primary.xml.gz";

  const notFound = await call(hashed, { upstream: () => new Response("Not Found", { status: 404 }) });
  assert.equal(notFound.res.status, 404);
  assert.equal(notFound.res.headers.get("cache-control"), "public, max-age=30");

  const badGateway = await call("/dists/stable/InRelease", { upstream: () => new Response("", { status: 502 }) });
  assert.equal(badGateway.res.status, 502);
  assert.equal(badGateway.res.headers.get("cache-control"), "no-store");
});

test("worker.fetch - Metadata upstream network failure returns a plain-text 502, never pinned", async () => {
  const { res } = await call("/dists/stable/InRelease", {
    upstream: () => {
      throw new TypeError("fetch failed");
    },
  });

  assert.equal(res.status, 502);
  assert.equal(res.headers.get("content-type"), "text/plain");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /metadata origin/);
});

test("worker.fetch - Metadata drops set-cookie and HEAD returns no body", async () => {
  const get = await call("/kvrocks.repo", {
    upstream: () => new Response("echo", { headers: { "Set-Cookie": "a=b", "Content-Type": "text/plain" } }),
  });
  assert.equal(get.res.headers.has("set-cookie"), false);
  assert.equal(get.res.headers.get("content-type"), "text/plain");
  assert.equal(await get.res.text(), "echo");

  const head = await call("/kvrocks.repo", { method: "HEAD", upstream: () => new Response("echo") });
  assert.equal(head.res.status, 200);
  assert.equal(head.res.body, null);
});

test("worker.fetch - Metadata conditional requests are answered with 304 by the Worker", async () => {
  const upstream = () =>
    new Response("repo-index-content", {
      headers: {
        ETag: '"my-etag-1234"',
        "Last-Modified": "Wed, 30 Sep 2026 00:00:00 GMT",
        "Content-Type": "text/plain",
      },
    });
  const path = "/dists/stable/InRelease";

  const notModified = [
    { "If-None-Match": '"my-etag-1234"' },
    { "If-None-Match": 'W/"my-etag-1234"' },
    { "If-None-Match": '"other", "my-etag-1234", "third"' },
    { "If-None-Match": "*" },
    { "If-Modified-Since": "Wed, 30 Sep 2026 00:00:00 GMT" },
    { "If-Modified-Since": "Thu, 01 Oct 2026 00:00:00 GMT" },
    // If-None-Match takes precedence: a matching ETag wins over a stale If-Modified-Since
    { "If-None-Match": '"my-etag-1234"', "If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT" },
  ];
  for (const headers of notModified) {
    const { res } = await call(path, { headers, upstream });
    assert.equal(res.status, 304, JSON.stringify(headers));
    assert.equal(res.body, null);
    assert.equal(res.headers.get("etag"), '"my-etag-1234"');
    assert.equal(res.headers.get("cache-control"), "public, max-age=60, s-maxage=60");
    assert.equal(res.headers.has("content-type"), false);
    assert.equal(res.headers.has("content-length"), false);
  }

  const modified = [
    { "If-None-Match": '"different-etag"' },
    { "If-Modified-Since": "Tue, 29 Sep 2026 00:00:00 GMT" },
    { "If-Modified-Since": "not a date" },
    // A mismatching ETag wins over a fresh If-Modified-Since
    { "If-None-Match": '"different-etag"', "If-Modified-Since": "Thu, 01 Oct 2026 00:00:00 GMT" },
    {},
  ];
  for (const headers of modified) {
    const { res } = await call(path, { headers, upstream });
    assert.equal(res.status, 200, JSON.stringify(headers));
    assert.equal(await res.text(), "repo-index-content");
  }
});

test("worker.fetch - Conditional headers never turn errors into 304", async () => {
  const { res } = await call("/dists/stable/InRelease", {
    headers: { "If-None-Match": "*" },
    upstream: () => new Response("Not Found", { status: 404 }),
  });
  assert.equal(res.status, 404);
});

// --- Installer --------------------------------------------------------------

test("worker.fetch - /install.sh is a static asset, never the Worker's business", async () => {
  // The asset layer answers this path before the Worker runs; if a request ever reached here the
  // installer would be proxied to the metadata origin instead of the deployed copy.
  const { fetchCalls } = await call("/install.sh");
  assert.equal(fetchCalls[0].url, `${TEST_METADATA_ORIGIN}/install.sh`);
});

// --- Scheduled Release Watcher ----------------------------------------------

test("compareVersions - Orders GA and pre-release versions accurately", () => {
  const ordered = [
    "2.13.0",
    "2.14.0",
    "2.15.0-beta.2",
    "2.15.0-rc.1",
    "2.15.0-rc.2",
    "2.15.0",
    "2.17.0-rc1",
    "2.17.0-rc2",
    "2.17.0-rc10",
    "2.17.0",
    "2.17.1",
    "2.18.0-rc1",
    "2.18.0",
  ];

  for (let i = 0; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i], ordered[i]), 0, ordered[i]);
    for (let j = i + 1; j < ordered.length; j++) {
      assert.equal(compareVersions(ordered[i], ordered[j]), -1, `${ordered[i]} < ${ordered[j]}`);
      assert.equal(compareVersions(ordered[j], ordered[i]), 1, `${ordered[j]} > ${ordered[i]}`);
    }
  }
});

test("parseUpstreamTagsAtom - Parses ordered tag links and rejects invalid XML", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Tags from kvrocks</title>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/apache/kvrocks/releases/tag/v2.17.0"/>
    <title>2.17.0</title>
  </entry>
  <entry>
    <link type="text/html" href="https://github.com/apache/kvrocks/releases/tag/v2.17.0-rc2" rel="alternate"/>
    <title>v2.17.0-rc2</title>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/apache/kvrocks/releases/tag/v2.17.0-rc1"/>
    <title>v2.17.0-rc1</title>
  </entry>
</feed>`;

  assert.deepEqual(parseUpstreamTagsAtom(xml), [
    { name: "v2.17.0" },
    { name: "v2.17.0-rc2" },
    { name: "v2.17.0-rc1" },
  ]);
  assert.deepEqual(parseUpstreamTagsAtom(`<feed xmlns="http://www.w3.org/2005/Atom"></feed>`), []);
  assert.throws(() => parseUpstreamTagsAtom("<html>Error</html>"), /invalid Atom XML/);
  assert.throws(() => parseUpstreamTagsAtom(""), /invalid Atom XML/);
});

test("selectPendingReleaseVersions - Returns empty when published releases are up to date", () => {
  const upstream = [
    { name: "v2.17.0" },
    { name: "v2.17.0-rc2" },
    { name: "v2.17.0-rc1" },
    { name: "v2.16.0" },
  ];
  const releases = [
    { tag_name: "v2.17.0-1", draft: false },
    { tag_name: "v2.16.0-1", draft: false },
  ];

  assert.deepEqual(selectPendingReleaseVersions(upstream, releases, []), []);
});

test("selectPendingReleaseVersions - Ignores draft releases when determining baseline", () => {
  const upstream = [{ name: "v2.18.0-rc1" }, { name: "v2.17.0" }];
  const releases = [
    { tag_name: "v2.18.0-rc1-1", draft: true },
    { tag_name: "v2.17.0-1", draft: false },
  ];

  assert.deepEqual(selectPendingReleaseVersions(upstream, releases, []), ["2.18.0-rc1"]);
});

test("selectPendingReleaseVersions - Tracks RCs sequentially through GA", () => {
  const releases217 = [{ tag_name: "v2.17.0-1", draft: false }];

  // New RC after 2.17.0 GA
  assert.deepEqual(
    selectPendingReleaseVersions([{ name: "v2.18.0-rc1" }, { name: "v2.17.0" }], releases217, []),
    ["2.18.0-rc1"]
  );

  // Next RC after rc1 is published
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.18.0-rc2" }, { name: "v2.18.0-rc1" }, { name: "v2.17.0" }],
      [{ tag_name: "v2.18.0-rc1-1", draft: false }, ...releases217],
      []
    ),
    ["2.18.0-rc2"]
  );

  // Final GA after rc2 is published
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.18.0" }, { name: "v2.18.0-rc2" }, { name: "v2.18.0-rc1" }, { name: "v2.17.0" }],
      [
        { tag_name: "v2.18.0-rc2-1", draft: false },
        { tag_name: "v2.18.0-rc1-1", draft: false },
        ...releases217,
      ],
      []
    ),
    ["2.18.0"]
  );
});

test("selectPendingReleaseVersions - Skips superseded RCs while queueing distinct versions in ascending order", () => {
  const releases = [{ tag_name: "v2.17.0-1", draft: false }];

  // Same major.minor.patch: superseded rc1 and rc2 are dropped in favor of GA 2.18.0
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.18.0" }, { name: "v2.18.0-rc2" }, { name: "v2.18.0-rc1" }, { name: "v2.17.0" }],
      releases,
      []
    ),
    ["2.18.0"]
  );

  // Distinct new versions: both 2.17.1 and 2.18.0-rc1 are queued oldest-to-newest
  assert.deepEqual(
    selectPendingReleaseVersions(
      [
        { name: "v2.18.0-rc1" },
        { name: "v2.17.1" },
        { name: "v2.17.1-rc1" },
        { name: "v2.17.0" },
      ],
      releases,
      []
    ),
    ["2.17.1", "2.18.0-rc1"]
  );
});

test("selectPendingReleaseVersions - Respects workflow runs (failed, active, unknown active, dry-run)", () => {
  const upstream = [{ name: "v2.18.0-rc1" }, { name: "v2.17.0" }];
  const releases = [{ tag_name: "v2.17.0-1", draft: false }];

  // Completed (even failed) non-dry-run suppresses duplicate dispatch for manual intervention
  const failedRun = [{ status: "completed", conclusion: "failure", display_title: "Release v2.18.0-rc1-1" }];
  assert.deepEqual(selectPendingReleaseVersions(upstream, releases, failedRun), []);

  // Advances once upstream publishes a newer version after a failed RC run
  assert.deepEqual(
    selectPendingReleaseVersions([{ name: "v2.18.0-rc2" }, ...upstream], releases, failedRun),
    ["2.18.0-rc2"]
  );

  // Active known run prevents re-dispatching itself while allowing newer versions to queue
  for (const status of ["in_progress", "queued"]) {
    assert.deepEqual(
      selectPendingReleaseVersions(upstream, releases, [
        { status, display_title: "Release v2.18.0-rc1-1" },
      ]),
      []
    );
    assert.deepEqual(
      selectPendingReleaseVersions([{ name: "v2.18.0" }, ...upstream], releases, [
        { status, display_title: "Release v2.18.0-rc1-1" },
      ]),
      ["2.18.0"]
    );
  }

  // Active run without version in display_title blocks conservatively
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, releases, [
      { status: "in_progress", display_title: "Release Packages" },
    ]),
    []
  );

  // Dry-run workflows (active or completed) never block real release dispatches
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, releases, [
      { status: "in_progress", display_title: "Release v2.18.0-rc1-1 (dry-run)" },
      { status: "completed", conclusion: "success", display_title: "Release v2.18.0-rc1-1 (dry-run)" },
    ]),
    ["2.18.0-rc1"]
  );
});

test("selectPendingReleaseVersions - Surfaces unrecognized new tags once and ignores historical ones", () => {
  const releases = [{ tag_name: "v2.17.0-1", draft: false }];

  // Unrecognized tag above baseline is passed through once so release.yaml fails and alerts
  const upstreamWithBadTag = [
    { name: "v2.18.0-alpha-1" },
    { name: "v2.17.0" },
    { name: "v.1.1.2" },
  ];
  assert.deepEqual(selectPendingReleaseVersions(upstreamWithBadTag, releases, []), ["2.18.0-alpha-1"]);

  // Once release.yaml has run (and failed) on that bad tag, do not re-dispatch every hour
  const failedBadRun = [
    { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-alpha-1-1" },
  ];
  assert.deepEqual(selectPendingReleaseVersions(upstreamWithBadTag, releases, failedBadRun), []);

  // Historical malformed tags below baseline are ignored
  assert.deepEqual(
    selectPendingReleaseVersions([{ name: "v2.17.0" }, { name: "v.1.1.2" }], releases, []),
    []
  );
});

test("selectPendingReleaseVersions - Brand-new repo dispatches only the single newest candidate", () => {
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.17.0" }, { name: "v2.17.0-rc2" }, { name: "v2.16.0" }],
      [],
      []
    ),
    ["2.17.0"]
  );

  // If newest upstream tag in a brand-new repo is malformed, dispatch it once
  assert.deepEqual(
    selectPendingReleaseVersions([{ name: "v2.18.0-alpha-1" }, { name: "v2.17.0" }], [], []),
    ["2.18.0-alpha-1"]
  );
  assert.deepEqual(
    selectPendingReleaseVersions([{ name: "v2.18.0-alpha-1" }, { name: "v2.17.0" }], [], [
      { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-alpha-1-1" },
    ]),
    []
  );
});

const SCHEDULE_ENV = {
  GITHUB_REPO: TEST_REPO,
  GITHUB_TOKEN: "ghp_test_token_123",
};

function atomFeed(tagNames) {
  const entries = tagNames
    .map(
      (tag) => `  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/apache/kvrocks/releases/tag/${tag}"/>
    <title>${tag}</title>
  </entry>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n${entries}\n</feed>`;
}

async function runScheduled({ env = SCHEDULE_ENV, fetchImpl } = {}) {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  const pending = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  };

  try {
    const result = await worker.scheduled({ cron: "0 * * * *" }, env, {
      waitUntil: (promise) => pending.push(promise),
    });
    await Promise.all(pending);
    return { result, fetchCalls };
  } catch (err) {
    await Promise.allSettled(pending);
    throw err;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("worker.scheduled - Throws descriptive error when GITHUB_REPO or GITHUB_TOKEN is missing", async () => {
  await assert.rejects(
    runScheduled({
      env: { GITHUB_TOKEN: "tok" },
      fetchImpl: () => {
        throw new Error("should not call fetch");
      },
    }),
    /Gateway Misconfiguration: GITHUB_REPO \(owner\/repo\) must be configured\./
  );

  for (const env of [{ GITHUB_REPO: TEST_REPO }, { GITHUB_REPO: TEST_REPO, GITHUB_TOKEN: "" }]) {
    await assert.rejects(
      runScheduled({
        env,
        fetchImpl: () => {
          throw new Error("should not call fetch");
        },
      }),
      /Gateway Misconfiguration: GITHUB_TOKEN secret must be configured\./
    );
  }
});

test("worker.scheduled - Queries tags.atom (unauthenticated) + GitHub API and queues pending releases in order", async () => {
  const { result, fetchCalls } = await runScheduled({
    fetchImpl: (url, init) => {
      if (url === "https://github.com/apache/kvrocks/tags.atom") {
        assert.equal(init.headers.Authorization, undefined);
        return new Response(atomFeed(["v2.18.0-rc1", "v2.17.1", "v2.17.0"]));
      }
      if (url === `https://api.github.com/repos/${TEST_REPO}/releases?per_page=15`) {
        return Response.json([{ tag_name: "v2.17.0-1", draft: false }]);
      }
      if (
        url ===
        `https://api.github.com/repos/${TEST_REPO}/actions/workflows/release.yaml/runs?event=workflow_dispatch&per_page=20`
      ) {
        return Response.json({ workflow_runs: [] });
      }
      if (
        url === `https://api.github.com/repos/${TEST_REPO}/actions/workflows/release.yaml/dispatches` &&
        init?.method === "POST"
      ) {
        return new Response(null, { status: 204 });
      }
      return new Response("Unexpected request", { status: 500 });
    },
  });

  assert.deepEqual(result, { dispatched: true, versions: ["2.17.1", "2.18.0-rc1"] });
  assert.equal(fetchCalls.length, 5);

  // API calls to the target repository carry the Bearer token; upstream tags.atom does not
  for (const call of fetchCalls.slice(1)) {
    assert.equal(call.init.headers.Authorization, "Bearer ghp_test_token_123");
    assert.equal(call.init.headers.Accept, "application/vnd.github+json");
  }

  assert.deepEqual(JSON.parse(fetchCalls[3].init.body), {
    ref: "main",
    inputs: { version: "2.17.1", iteration: "1" },
  });
  assert.deepEqual(JSON.parse(fetchCalls[4].init.body), {
    ref: "main",
    inputs: { version: "2.18.0-rc1", iteration: "1" },
  });
});

test("worker.scheduled - Makes no POST dispatch when up to date", async () => {
  const { result, fetchCalls } = await runScheduled({
    fetchImpl: (url) => {
      if (url === "https://github.com/apache/kvrocks/tags.atom") {
        return new Response(atomFeed(["v2.17.0", "v2.17.0-rc2"]));
      }
      if (url.includes("/releases?per_page=15")) {
        return Response.json([{ tag_name: "v2.17.0-1", draft: false }]);
      }
      return Response.json({ workflow_runs: [] });
    },
  });

  assert.deepEqual(result, { dispatched: false, versions: [] });
  assert.equal(fetchCalls.length, 3);
  assert.equal(
    fetchCalls.some((c) => c.init?.method === "POST"),
    false
  );
});

test("worker.scheduled - Rejects on GitHub error, invalid feed XML, or network error", async () => {
  await assert.rejects(
    runScheduled({
      fetchImpl: (url) => {
        if (url === "https://github.com/apache/kvrocks/tags.atom") {
          return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
        }
        return Response.json([]);
      },
    }),
    /GitHub API error \(upstream tags, 429\): Too Many Requests/
  );

  await assert.rejects(
    runScheduled({
      fetchImpl: (url) => {
        if (url === "https://github.com/apache/kvrocks/tags.atom") {
          return new Response("<html>not atom</html>");
        }
        if (url.includes("/releases?")) return Response.json([]);
        return Response.json({ workflow_runs: [] });
      },
    }),
    /invalid Atom XML/
  );

  await assert.rejects(
    runScheduled({
      fetchImpl: () => {
        throw new TypeError("network down");
      },
    }),
    /GitHub API network error/
  );
});
