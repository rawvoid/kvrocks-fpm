/**
 * Repository metadata proxy: forwards APT/DNF indexes and signing keys from
 * GitHub Pages with per-type TTLs and conditional request (304) handling.
 */

import { NEGATIVE_TTL, badGateway, fetchUpstream } from "./shared.js";

// Indexes that change on every release and reference each other (Release -> Packages, repomd.xml -> repodata).
const REPO_INDEX_RE = /\/(?:InRelease|Release|Release\.gpg|Packages(?:\.\w+)?|repomd\.xml(?:\.asc)?)$/;
// createrepo_c/mergerepo_c name repodata files `<checksum>-<type>.<ext>`, so their content never changes.
const HASHED_REPODATA_RE = /\/repodata\/[0-9a-f]{32,}-/i;
const SIGNING_KEY_RE = /\.(?:asc|gpg)$/;

const REPO_INDEX_TTL = 60;
const HASHED_REPODATA_TTL = 30 * 24 * 3600;
const SIGNING_KEY_TTL = 24 * 3600;
const DEFAULT_TTL = 600;

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

/**
 * Resolves the GitHub Pages origin that serves the repository metadata.
 *
 * `METADATA_ORIGIN` is an explicit override for a custom domain. Otherwise the project site of
 * `GITHUB_REPO` is used, so a fork only has to point `GITHUB_REPO` at itself.
 *
 * @param {{ GITHUB_REPO?: string, METADATA_ORIGIN?: string }} env Worker environment
 * @returns {string|null} Metadata origin, or null when the repository is not configured
 */
export function resolveMetadataOrigin(env) {
  if (env.METADATA_ORIGIN) return env.METADATA_ORIGIN;

  const [owner, repo] = String(env.GITHUB_REPO ?? "").split("/");
  if (!owner || !repo) return null;

  return `https://${owner}.github.io/${repo}`;
}

export async function handleMetadata(request, metadataOrigin, pathname) {
  const policy = cachePolicy(pathname);

  // Plain string concatenation keeps the target on the configured origin, whatever the path looks like.
  const upstream = await fetchUpstream(`${metadataOrigin.replace(/\/+$/, "")}${pathname}`, {
    cf: {
      cacheEverything: true,
      cacheTtlByStatus: { "200-299": policy.ttl, "404": NEGATIVE_TTL, "500-599": -1 },
    },
  });
  if (!upstream) return badGateway("the metadata origin");

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
