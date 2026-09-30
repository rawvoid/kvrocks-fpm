/**
 * Apache Kvrocks Package Repository Edge Gateway (Cloudflare Worker)
 *
 * Responsibilities:
 * 1. Binary Package Downloads (*.deb, *.rpm):
 *    - Resolves the exact release tag deterministically from the package filename.
 *    - Fetches the package from GitHub Releases and stream-proxies (200 OK) directly to the client.
 *    - Caches packages in Cloudflare's Edge Cache for 1 year (immutable).
 *    - Eliminates Great Firewall (GFW) blocking/throttling for clients in mainland China.
 *    - Supports HEAD requests and optional ?redirect=1 for direct HTTP 302 redirects.
 *
 * 2. Repository Metadata, Static Assets & Root Landing Page (index.html, InRelease, repomd.xml, *.repo, *.asc, install.sh):
 *    - Proxies directly from GitHub Pages (configured via METADATA_ORIGIN).
 *    - Applies intelligent edge caching (5 minutes for index, 24 hours for GPG keys, 10 minutes for web/scripts).
 *    - Adds permissive CORS headers.
 */

// Pre-compiled regular expressions for Linux package resolution
const DEB_PKG_RE = /^[^_]+_([0-9]+\.[0-9]+\.[0-9]+[^_]*)_[^_]+\.deb$/;
const RPM_PKG_RE = /-([0-9]+\.[0-9]+\.[0-9]+(?:-[^.]+)?-[0-9A-Za-z.+~]+)\.(?:x86_64|aarch64)\.rpm$/;

/**
 * Deterministically resolves the target GitHub Release download URL for a given package path.
 *
 * @param {string} pathname Request URL path (e.g. /pool/main/kvrocks_2.17.0-1_amd64.deb)
 * @param {string} repo GitHub repository slug (owner/repo)
 * @returns {string|null} Full GitHub Release asset URL, or null if filename or repo is missing/unparseable
 */
export function resolveReleaseDownloadUrl(pathname, repo) {
  if (!repo || !pathname) return null;
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);

  // 1. Debian package convention: <package>_<version>_<architecture>.deb
  const deb = filename.match(DEB_PKG_RE);
  if (deb) return `https://github.com/${repo}/releases/download/v${deb[1]}/${filename}`;

  // 2. RPM package convention: <name>-<version>-<release>.<architecture>.rpm
  const rpm = filename.match(RPM_PKG_RE);
  if (rpm) return `https://github.com/${repo}/releases/download/v${rpm[1]}/${filename}`;

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const githubRepo = env?.GITHUB_REPO;
    const metadataOrigin = env?.METADATA_ORIGIN;

    if (!githubRepo || !metadataOrigin) {
      return new Response(
        "Gateway Misconfiguration: GITHUB_REPO and METADATA_ORIGIN environment variables are required.",
        {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }
      );
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Binary Package Requests (*.deb, *.rpm) -> Stream Proxy + Edge Cache
    if (pathname.endsWith(".deb") || pathname.endsWith(".rpm")) {
      const targetUrl = resolveReleaseDownloadUrl(pathname, githubRepo);
      if (!targetUrl) {
        return new Response("Package Not Found in Repository (invalid package naming convention)", {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // Check Cloudflare Edge Cache first
      const cache = typeof caches !== "undefined" ? caches.default : null;
      const cacheKey = new Request(url.toString(), request);
      if (cache) {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          const hitHeaders = new Headers(cachedResponse.headers);
          hitHeaders.set("X-Cache-Status", "HIT-CLOUDFLARE-EDGE");
          return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            statusText: cachedResponse.statusText,
            headers: hitHeaders,
          });
        }
      }

      // Direct 302 redirect mode if explicitly requested (e.g. ?redirect=1)
      if (url.searchParams.get("redirect") === "1" || url.searchParams.get("redirect") === "true") {
        return Response.redirect(targetUrl, 302);
      }

      // Stream proxy from GitHub Releases (CF fetch automatically follows 302 to AWS S3/CloudFront)
      const isHead = request.method === "HEAD";
      const upstreamResponse = await fetch(targetUrl, {
        method: isHead ? "HEAD" : "GET",
        headers: {
          "User-Agent": "Kvrocks-Repository-Gateway/1.0",
        },
        redirect: "follow",
      });

      if (!upstreamResponse.ok) {
        return new Response(
          `Failed to fetch package from upstream GitHub Releases (${upstreamResponse.status}): ${upstreamResponse.statusText}`,
          {
            status: upstreamResponse.status,
            headers: { "Content-Type": "text/plain" },
          }
        );
      }

      // Construct edge-cacheable response headers
      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
      responseHeaders.set("X-Cache-Status", "MISS-FETCHED-FROM-GITHUB");
      responseHeaders.delete("set-cookie");

      const responseToReturn = new Response(isHead ? null : upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });

      // Asynchronously populate Cloudflare Edge Cache
      if (cache && ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(cache.put(cacheKey, responseToReturn.clone()));
      }

      return responseToReturn;
    }

    // 2. Metadata, Static Assets, and Root Landing Page -> Proxy from GitHub Pages
    const originUrl = new URL(metadataOrigin);
    const targetPath = (pathname === "/" || pathname === "") ? "/index.html" : pathname;
    const upstreamPath = originUrl.pathname.replace(/\/$/, "") + targetPath;
    const upstreamMetaUrl = new URL(upstreamPath, originUrl.origin);
    upstreamMetaUrl.search = url.search;

    const proxyRequest = new Request(upstreamMetaUrl.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const metaResponse = await fetch(proxyRequest);

    const metaHeaders = new Headers(metaResponse.headers);
    metaHeaders.set("Access-Control-Allow-Origin", "*");

    // Tiered edge cache headers based on asset sensitivity
    if (targetPath.includes("InRelease") || targetPath.includes("Release") || targetPath.includes("repomd.xml")) {
      metaHeaders.set("Cache-Control", "public, max-age=300, s-maxage=300"); // 5 min for repo indexes
    } else if (targetPath.endsWith(".asc") || targetPath.endsWith(".gpg")) {
      metaHeaders.set("Cache-Control", "public, max-age=86400, s-maxage=86400"); // 24 hours for signing keys
    } else if (targetPath.endsWith(".html") || targetPath.endsWith(".sh") || targetPath.endsWith(".repo")) {
      metaHeaders.set("Cache-Control", "public, max-age=600, s-maxage=600"); // 10 min for html/config/installer
    }

    return new Response(metaResponse.body, {
      status: metaResponse.status,
      statusText: metaResponse.statusText,
      headers: metaHeaders,
    });
  },
};
