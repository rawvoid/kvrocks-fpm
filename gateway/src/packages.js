/**
 * Package proxy (/pool/*.deb, /rpm/**.rpm): derives GitHub Release asset URLs from package
 * filenames and streams 200 responses through Cloudflare's edge cache (`caches.default`).
 */

import { USER_AGENT, badGateway, fetchUpstream, textResponse } from "./shared.js";

// Filename conventions: deb `<name>_<version>-<revision>_<arch>.deb`, rpm `<name>-<version>-<release>.<arch>.rpm`.
// Capture group 1 is `${VERSION}-${ITERATION}`, i.e. the release tag without the leading "v".
const VERSION_REV = "([0-9]+\\.[0-9]+\\.[0-9]+[0-9A-Za-z.+~-]*-[0-9A-Za-z.+~]+)";
const DEB_PKG_RE = new RegExp(`^[a-z0-9.+-]+_${VERSION_REV}_(?:amd64|arm64)\\.deb$`);
const RPM_PKG_RE = new RegExp(`^[a-z0-9.+-]+-${VERSION_REV}\\.(?:x86_64|aarch64)\\.rpm$`);

const PACKAGE_TTL = 365 * 24 * 3600;

const PACKAGE_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "content-disposition",
  "etag",
  "last-modified",
];

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

  return `https://github.com/${repo}/releases/download/v${match[1]}/${filename}`;
}

export function isPackagePath(pathname) {
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

export async function handlePackage(request, ctx, repo, pathname) {
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

  const upstreamHeaders = { "User-Agent": USER_AGENT };
  if (range) {
    upstreamHeaders["Range"] = range;
    const ifRange = request.headers.get("If-Range");
    if (ifRange) upstreamHeaders["If-Range"] = ifRange;
  }

  // Always GET, even for HEAD: the redirect target is a signed URL that may only be valid for GET.
  const upstream = await fetchUpstream(targetUrl, { headers: upstreamHeaders });
  if (!upstream) return badGateway("GitHub Releases");

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
