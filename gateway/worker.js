/**
 * Apache Kvrocks package repository edge gateway (Cloudflare Worker).
 *
 * - Packages (/pool/*.deb, /rpm/**.rpm) are stored on GitHub Releases. The release tag is derived
 *   from the filename (tag = `v${VERSION}-${ITERATION}`, see release.yaml), so no GitHub API call is
 *   needed. Full 200 responses are cached via caches.default keyed by the canonical GitHub URL, because
 *   GitHub answers with a short-lived signed redirect that `cf.cacheEverything` must not pin.
 * - Everything else (APT/DNF metadata, keys, installer, landing page) is proxied from GitHub Pages with
 *   `cf.cacheEverything`. APT/DNF indexes get a short TTL to keep the window in which an edge holds a
 *   mix of old and new files small; content-addressed DNF repodata is immutable.
 * - Only GET/HEAD are served. Client headers and query strings are never forwarded upstream, so they can
 *   neither fragment nor bust the cache. Conditional requests for metadata are answered by the Worker.
 */

// Filename conventions: deb `<name>_<version>-<revision>_<arch>.deb`, rpm `<name>-<version>-<release>.<arch>.rpm`.
// Capture group 1 is `${VERSION}-${ITERATION}`, i.e. the release tag without the leading "v".
const DEB_PKG_RE = /^[^_]+_([0-9]+\.[0-9]+\.[0-9]+[^_]*)_[^_]+\.deb$/;
const RPM_PKG_RE = /-([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+~-]*-[0-9A-Za-z.+~]+)\.(?:x86_64|aarch64)\.rpm$/;

// Indexes that change on every release and reference each other (Release -> Packages, repomd.xml -> repodata).
const REPO_INDEX_RE = /\/(?:InRelease|Release|Release\.gpg|Packages(?:\.\w+)?|repomd\.xml(?:\.asc)?)$/;
// createrepo_c/mergerepo_c name repodata files `<checksum>-<type>.<ext>`, so their content never changes.
const HASHED_REPODATA_RE = /\/repodata\/[0-9a-f]{32,}-/i;
const SIGNING_KEY_RE = /\.(?:asc|gpg)$/;

const PACKAGE_TTL = 365 * 24 * 3600;
const REPO_INDEX_TTL = 60;
const HASHED_REPODATA_TTL = 30 * 24 * 3600;
const SIGNING_KEY_TTL = 24 * 3600;
const DEFAULT_TTL = 600;
const NEGATIVE_TTL = 30;

const PACKAGE_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "content-disposition",
  "etag",
  "last-modified",
];

/**
 * Percent-encodes a filename or version for use as one URL path segment, keeping `+` literal.
 * `encodeURIComponent` also escapes `/`, `?` and `#`, so the value cannot alter the URL structure.
 */
function encodePathSegment(value) {
  return encodeURIComponent(value).replaceAll("%2B", "+");
}

/**
 * Resolves the GitHub Release asset URL for a package request path.
 *
 * @param {string} pathname Request path, e.g. /pool/main/kvrocks_2.17.0-1_amd64.deb
 * @param {string} repo GitHub repository slug (owner/repo)
 * @returns {string|null} Asset URL, or null if the filename is not a recognised package name
 */
export function resolveReleaseDownloadUrl(pathname, repo) {
  if (!repo || !pathname) return null;

  let filename;
  try {
    filename = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  } catch {
    return null;
  }

  const match = filename.match(DEB_PKG_RE) ?? filename.match(RPM_PKG_RE);
  if (!match) return null;

  return `https://github.com/${repo}/releases/download/v${encodePathSegment(match[1])}/${encodePathSegment(filename)}`;
}

function textResponse(body, status, headers = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...headers } });
}

function isPackagePath(pathname) {
  return (
    (pathname.startsWith("/pool/") && pathname.endsWith(".deb")) ||
    (pathname.startsWith("/rpm/") && pathname.endsWith(".rpm"))
  );
}

function packageResponse(upstream, isHead, cacheStatus) {
  const headers = new Headers({
    "Cache-Control": `public, max-age=${PACKAGE_TTL}, immutable`,
    "Accept-Ranges": "bytes",
    "X-Cache-Status": cacheStatus,
  });
  for (const name of PACKAGE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (isHead) upstream.body?.cancel();
  return new Response(isHead ? null : upstream.body, { status: upstream.status, headers });
}

async function handlePackage(request, ctx, repo, pathname) {
  const targetUrl = resolveReleaseDownloadUrl(pathname, repo);
  if (!targetUrl) {
    return textResponse("Package Not Found in Repository (invalid package naming convention)", 404);
  }

  const isHead = request.method === "HEAD";
  const range = request.headers.get("Range");
  const cache = caches.default;

  // The cache serves Range requests from a cached full object (206) on its own.
  const cached = await cache.match(new Request(targetUrl, { headers: range ? { Range: range } : {} }));
  if (cached) return packageResponse(cached, isHead, "HIT-CLOUDFLARE-EDGE");

  const upstreamHeaders = { "User-Agent": "Kvrocks-Repository-Gateway/1.0" };
  if (range) {
    upstreamHeaders["Range"] = range;
    const ifRange = request.headers.get("If-Range");
    if (ifRange) upstreamHeaders["If-Range"] = ifRange;
  }

  // Always GET, even for HEAD: the redirect target is a signed URL that may only be valid for GET.
  const upstream = await fetch(targetUrl, { headers: upstreamHeaders });
  if (!upstream.ok) {
    upstream.body?.cancel();
    return textResponse(
      `Failed to fetch package from upstream GitHub Releases (${upstream.status}): ${upstream.statusText}`,
      upstream.status,
      { "Cache-Control": "no-store" }
    );
  }

  const response = packageResponse(upstream, isHead, "MISS-FETCHED-FROM-GITHUB");
  if (upstream.status === 200 && !isHead) {
    ctx.waitUntil(cache.put(new Request(targetUrl), response.clone()));
  }
  return response;
}

function cachePolicy(path) {
  if (REPO_INDEX_RE.test(path)) return { ttl: REPO_INDEX_TTL };
  if (HASHED_REPODATA_RE.test(path)) return { ttl: HASHED_REPODATA_TTL, immutable: true };
  if (SIGNING_KEY_RE.test(path)) return { ttl: SIGNING_KEY_TTL };
  return { ttl: DEFAULT_TTL };
}

// Only successful responses get the long TTL; errors must not be pinned by clients or proxies.
function cacheControl(status, { ttl, immutable = false }) {
  if (status >= 200 && status < 300) {
    return `public, max-age=${ttl}, s-maxage=${ttl}${immutable ? ", immutable" : ""}`;
  }
  return status === 404 ? `public, max-age=${NEGATIVE_TTL}` : "no-store";
}

// RFC 9110 §13.1: If-None-Match (weak comparison) takes precedence over If-Modified-Since.
function isNotModified(requestHeaders, responseHeaders) {
  const ifNoneMatch = requestHeaders.get("If-None-Match");
  if (ifNoneMatch) {
    if (ifNoneMatch.trim() === "*") return true;
    const etag = responseHeaders.get("ETag");
    if (!etag) return false;
    const opaque = (tag) => tag.trim().replace(/^W\//, "");
    return ifNoneMatch.split(",").some((tag) => opaque(tag) === opaque(etag));
  }

  // Date.parse yields NaN for a missing or malformed header, which makes the comparison false.
  const since = Date.parse(requestHeaders.get("If-Modified-Since"));
  const modified = Date.parse(responseHeaders.get("Last-Modified"));
  return modified <= since;
}

async function handleMetadata(request, metadataOrigin, pathname) {
  const path = pathname === "/" ? "/index.html" : pathname;
  const policy = cachePolicy(path);

  // Plain string concatenation keeps the target on the configured origin, whatever the path looks like.
  const upstream = await fetch(`${metadataOrigin.replace(/\/+$/, "")}${path}`, {
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": policy.ttl, "404": NEGATIVE_TTL, "500-599": -1 },
    },
  });

  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.set("Cache-Control", cacheControl(upstream.status, policy));

  if (upstream.status === 200 && isNotModified(request.headers, upstream.headers)) {
    upstream.body?.cancel();
    const notModified = new Headers({ "Cache-Control": headers.get("Cache-Control") });
    for (const name of ["ETag", "Last-Modified"]) {
      const value = headers.get(name);
      if (value) notModified.set(name, value);
    }
    return new Response(null, { status: 304, headers: notModified });
  }

  const isHead = request.method === "HEAD";
  if (isHead) upstream.body?.cancel();
  return new Response(isHead ? null : upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method Not Allowed", 405, { Allow: "GET, HEAD" });
    }

    const { GITHUB_REPO: githubRepo, METADATA_ORIGIN: metadataOrigin } = env;
    if (!githubRepo || !metadataOrigin) {
      return textResponse(
        "Gateway Misconfiguration: GITHUB_REPO and METADATA_ORIGIN environment variables are required.",
        500
      );
    }

    const { pathname } = new URL(request.url);
    return isPackagePath(pathname)
      ? handlePackage(request, ctx, githubRepo, pathname)
      : handleMetadata(request, metadataOrigin, pathname);
  },
};
