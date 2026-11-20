/**
 * Apache Kvrocks package repository edge gateway (Cloudflare Worker).
 *
 * - Packages (/pool/*.deb, /rpm/**.rpm) are stored on GitHub Releases. The release tag is derived
 *   from the filename (tag = `v${VERSION}-${ITERATION}`, see release.yaml), so no GitHub API call is
 *   needed. Full 200 responses are cached via caches.default keyed by the canonical GitHub URL, because
 *   GitHub answers with a short-lived signed redirect that `cf.cacheEverything` must not pin.
 * - The landing page and the installer are plain Static Assets of this Worker, rendered at build time
 *   by `scripts/render.mjs`: an asset hit is answered by the edge without running any of this code, so
 *   nothing here knows about either file.
 * - Everything else (APT/DNF metadata, keys, repository config) is proxied from GitHub Pages with
 *   `cf.cacheEverything`. APT/DNF indexes get a short TTL to keep the window in which an edge holds a
 *   mix of old and new files small; content-addressed DNF repodata is immutable.
 * - Only GET/HEAD are served. Client headers and query strings are never forwarded upstream, so they can
 *   neither fragment nor bust the cache. Conditional requests for metadata are answered by the Worker.
 * - An upstream that cannot be reached at all is answered with a plain-text 502 instead of letting the
 *   rejection surface as Cloudflare's HTML error page: apt and dnf parse bodies, so HTML reads as a
 *   malformed index rather than a failed fetch.
 * - Hourly Cron Trigger (`scheduled`) reads the latest upstream Apache Kvrocks tags from `tags.atom`
 *   (GA and pre-release), compares them against published GitHub Releases and recent workflow runs
 *   in `GITHUB_REPO`, and queues `release.yaml` dispatches in ascending version order. Requires both
 *   `GITHUB_REPO` and `GITHUB_TOKEN` (throws on missing configuration so Cron logs report failure).
 */

// Filename conventions: deb `<name>_<version>-<revision>_<arch>.deb`, rpm `<name>-<version>-<release>.<arch>.rpm`.
// Capture group 1 is `${VERSION}-${ITERATION}`, i.e. the release tag without the leading "v".
const VERSION_REV = "([0-9]+\\.[0-9]+\\.[0-9]+[0-9A-Za-z.+~-]*-[0-9A-Za-z.+~]+)";
const DEB_PKG_RE = new RegExp(`^[a-z0-9.+-]+_${VERSION_REV}_(?:amd64|arm64)\\.deb$`);
const RPM_PKG_RE = new RegExp(`^[a-z0-9.+-]+-${VERSION_REV}\\.(?:x86_64|aarch64)\\.rpm$`);

const DEFAULT_UPSTREAM_REPO = "apache/kvrocks";
const DEFAULT_RELEASE_REF = "main";
const RELEASE_WORKFLOW = "release.yaml";

// Matches the upstream version syntax accepted by .github/workflows/release.yaml (e.g. 2.17.0, 2.17.0-rc1).
const UPSTREAM_VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const UPSTREAM_TAG_RE = /^(?:refs\/tags\/)?v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)$/;
const PACKAGED_TAG_RE = /^(?:refs\/tags\/)?v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)-[1-9][0-9]*$/;
// Deliberately excludes `(dry-run)` run titles so dry runs never suppress an automated release.
const RELEASE_RUN_TITLE_RE = /^Release vv?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)-[1-9][0-9]*$/;
const RELEASE_RUN_ANY_TITLE_RE = /^Release v(.+)-[1-9][0-9]*$/;

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

function textResponse(body, status, headers = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...headers } });
}

// 502 is the status class apt (Acquire::Retries, default 3) and dnf (`retries`) both retry as transient, and
// `no-store` keeps the failure out of every cache. One status for every cause: the rejection reason of fetch()
// cannot be told apart, and a second code would only make client behaviour harder to predict.
function badGateway(what) {
  return textResponse(`Bad Gateway: ${what} could not be reached`, 502, { "Cache-Control": "no-store" });
}

/**
 * Calls the upstream, turning a network-layer rejection into `null`.
 *
 * fetch() only rejects when no request could be made at all (DNS, TLS, connection reset); upstream error
 * statuses resolve normally. `null` rather than a synthetic error response keeps "the upstream is unreachable"
 * distinguishable from "the upstream answered" at the call site.
 *
 * @returns {Promise<Response|null>} Upstream response, or null when the request could not be made
 */
async function fetchUpstream(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
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

async function handleMetadata(request, metadataOrigin, pathname) {
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

function parseVersion(version) {
  const match = String(version ?? "").match(UPSTREAM_VERSION_RE);
  if (!match) {
    throw new Error(`Invalid version format: '${version}'`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  };
}

/**
 * Compares two Kvrocks version strings in package/SemVer order (`2.17.0-rc1 < 2.17.0-rc2 < 2.17.0`).
 *
 * @param {string} a First version string
 * @param {string} b Second version string
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  for (const key of ["major", "minor", "patch"]) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }

  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;

  const tokensA = pa.prerelease.match(/[0-9]+|[A-Za-z]+/g) ?? [];
  const tokensB = pb.prerelease.match(/[0-9]+|[A-Za-z]+/g) ?? [];
  const len = Math.min(tokensA.length, tokensB.length);

  for (let i = 0; i < len; i++) {
    const ta = tokensA[i];
    const tb = tokensB[i];
    const numA = /^[0-9]+$/.test(ta);
    const numB = /^[0-9]+$/.test(tb);

    if (numA && numB) {
      const diff = Number(ta) - Number(tb);
      if (diff !== 0) return Math.sign(diff);
    } else if (ta !== tb) {
      return ta < tb ? -1 : 1;
    }
  }

  return Math.sign(tokensA.length - tokensB.length);
}

function getTagText(item) {
  if (typeof item === "string") return item;
  return item?.tag_name ?? item?.name ?? item?.ref ?? "";
}

function extractVersions(items, regex, getText = getTagText) {
  if (!Array.isArray(items)) return [];
  const versions = new Set();
  for (const item of items) {
    const match = String(getText(item) ?? "").match(regex);
    if (match) versions.add(match[1]);
  }
  return [...versions].sort(compareVersions);
}

function dropSupersededPrereleases(versions) {
  return versions.filter((version) => {
    const dashIdx = version.indexOf("-");
    if (dashIdx === -1) return true;
    const base = version.slice(0, dashIdx);
    return !versions.some(
      (other) => other.split("-", 1)[0] === base && compareVersions(other, version) > 0
    );
  });
}

/**
 * Extracts tag names from a GitHub repository's `/tags.atom` feed (newest-first).
 *
 * @param {string} xml Atom XML response body
 * @returns {Array<{name: string}>} Ordered tag entries
 */
export function parseUpstreamTagsAtom(xml) {
  if (typeof xml !== "string" || !/<feed[\s>]/i.test(xml)) {
    throw new Error("Upstream tags feed returned invalid Atom XML");
  }

  const tags = [];
  for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const linkMatch = entry[1].match(/<link\b[^>]*\bhref=["'][^"']*\/releases\/tag\/([^"'?#]+)["']/i);
    if (!linkMatch) continue;
    try {
      tags.push({ name: decodeURIComponent(linkMatch[1]) });
    } catch {
      tags.push({ name: linkMatch[1] });
    }
  }
  return tags;
}

/**
 * Selects upstream Kvrocks versions that should be dispatched to `release.yaml` (oldest-to-newest).
 *
 * - Ignores `(dry-run)` runs completely; waits only when an active non-dry-run workflow does not
 *   expose its target version in `display_title`.
 * - Compares the latest upstream tags against published (non-draft) releases and prior
 *   `workflow_dispatch` runs so failed or already-queued versions are never re-triggered.
 * - Drops superseded pre-releases when a newer pre-release or GA for the same `major.minor.patch`
 *   exists, while queueing distinct new versions in ascending order via `release.yaml` (`queue: max`).
 * - Passes unrecognized tags above the current baseline through to `release.yaml` once so its
 *   preflight validation reports the anomaly via GitHub notifications instead of silently ignoring it.
 *
 * @param {Array<string|{name?: string, ref?: string}>} upstreamTags Upstream Git tags (newest-first)
 * @param {Array<string|{tag_name?: string, draft?: boolean, ref?: string, name?: string}>} packagedReleases Local releases
 * @param {Array<{status?: string, display_title?: string}>} [workflowRuns=[]] Recent release.yaml runs
 * @returns {string[]} Versions to dispatch (without leading "v"), ordered oldest-to-newest
 */
export function selectPendingReleaseVersions(upstreamTags, packagedReleases, workflowRuns = []) {
  const runs = Array.isArray(workflowRuns) ? workflowRuns : [];
  const nonDryRuns = runs.filter(
    (run) => !String(run?.display_title ?? "").endsWith("(dry-run)")
  );

  // Wait only when an active run's title does not identify which version it is building.
  const hasUnknownActiveRun = nonDryRuns.some(
    (run) =>
      run?.status &&
      run.status !== "completed" &&
      !RELEASE_RUN_ANY_TITLE_RE.test(String(run.display_title ?? ""))
  );
  if (hasUnknownActiveRun) return [];

  if (!Array.isArray(upstreamTags) || upstreamTags.length === 0) return [];

  const nonDraftReleases = Array.isArray(packagedReleases)
    ? packagedReleases.filter((item) => typeof item === "string" || !item?.draft)
    : [];

  const packagedVersions = extractVersions(nonDraftReleases, PACKAGED_TAG_RE, getTagText);
  const dispatchedVersions = extractVersions(
    nonDryRuns,
    RELEASE_RUN_TITLE_RE,
    (run) => run?.display_title ?? ""
  );
  const knownVersions = [...new Set([...packagedVersions, ...dispatchedVersions])].sort(compareVersions);
  const baseline = knownVersions.at(-1) ?? null;

  const dispatchedRawVersions = new Set(dispatchedVersions);
  for (const run of nonDryRuns) {
    const match = String(run?.display_title ?? "").match(RELEASE_RUN_ANY_TITLE_RE);
    if (match) dispatchedRawVersions.add(match[1]);
  }

  if (baseline === null) {
    const newestName = String(getTagText(upstreamTags[0]) ?? "").replace(/^refs\/tags\//, "");
    if (newestName && !UPSTREAM_TAG_RE.test(newestName)) {
      const rawVersion = newestName.replace(/^v/, "");
      return dispatchedRawVersions.has(rawVersion) ? [] : [rawVersion];
    }
    const upstreamVersions = extractVersions(upstreamTags, UPSTREAM_TAG_RE, getTagText);
    const latest = dropSupersededPrereleases(upstreamVersions).at(-1);
    return latest ? [latest] : [];
  }

  const validNew = new Set();
  const invalidNew = [];
  let seenBaselineOrOlder = false;

  for (const item of upstreamTags) {
    const rawName = String(getTagText(item) ?? "").replace(/^refs\/tags\//, "");
    if (!rawName) continue;

    const match = rawName.match(UPSTREAM_TAG_RE);
    if (match) {
      const version = match[1];
      if (compareVersions(version, baseline) <= 0) {
        seenBaselineOrOlder = true;
      } else {
        validNew.add(version);
      }
    } else if (!seenBaselineOrOlder) {
      const rawVersion = rawName.replace(/^v/, "");
      if (!dispatchedRawVersions.has(rawVersion) && !invalidNew.includes(rawVersion)) {
        invalidNew.push(rawVersion);
      }
    }
  }

  const candidates = dropSupersededPrereleases([...validNew].sort(compareVersions));
  return [...candidates, ...invalidNew.reverse()];
}

function githubApiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Kvrocks-Repository-Gateway/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function fetchGitHub(url, init, label) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`GitHub API network error (${label}): ${err?.message ?? err}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GitHub API error (${label}, ${res.status}): ${res.statusText}`);
  }
  return res;
}

async function checkAndDispatchRelease(env) {
  const githubRepo = env?.GITHUB_REPO;
  const githubToken = env?.GITHUB_TOKEN;
  const upstreamRepo = env?.UPSTREAM_REPO || DEFAULT_UPSTREAM_REPO;
  const releaseRef = env?.RELEASE_REF || DEFAULT_RELEASE_REF;

  if (!githubRepo) {
    throw new Error("Gateway Misconfiguration: GITHUB_REPO (owner/repo) must be configured.");
  }
  if (!githubToken) {
    throw new Error("Gateway Misconfiguration: GITHUB_TOKEN secret must be configured.");
  }

  const headers = githubApiHeaders(githubToken);
  const [upstreamRes, releasesRes, runsRes] = await Promise.all([
    fetchGitHub(
      `https://github.com/${upstreamRepo}/tags.atom`,
      {
        headers: {
          Accept: "application/atom+xml, application/xml",
          "User-Agent": "Kvrocks-Repository-Gateway/1.0",
        },
      },
      "upstream tags"
    ),
    fetchGitHub(
      `https://api.github.com/repos/${githubRepo}/releases?per_page=15`,
      { headers },
      "packaged releases"
    ),
    fetchGitHub(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&per_page=20`,
      { headers },
      "workflow runs"
    ),
  ]);

  const [upstreamXml, packagedReleases, runsData] = await Promise.all([
    upstreamRes.text(),
    releasesRes.json(),
    runsRes.json(),
  ]);

  const upstreamTags = parseUpstreamTagsAtom(upstreamXml);
  const versions = selectPendingReleaseVersions(
    upstreamTags,
    packagedReleases,
    runsData?.workflow_runs ?? []
  );
  if (versions.length === 0) {
    return { dispatched: false, versions: [] };
  }

  // Dispatch oldest-to-newest sequentially so release.yaml (`queue: max`) processes them in order.
  for (const version of versions) {
    const dispatchRes = await fetchGitHub(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${RELEASE_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: releaseRef, inputs: { version, iteration: "1" } }),
      },
      `dispatch ${RELEASE_WORKFLOW} v${version}`
    );
    await dispatchRes.body?.cancel();
  }

  return { dispatched: true, versions };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse("Method Not Allowed", 405, { Allow: "GET, HEAD" });
    }

    const { GITHUB_REPO: githubRepo } = env;
    const metadataOrigin = resolveMetadataOrigin(env);
    if (!githubRepo || !metadataOrigin) {
      return textResponse(
        "Gateway Misconfiguration: GITHUB_REPO (owner/repo) or METADATA_ORIGIN must be configured.",
        500
      );
    }

    const { pathname } = new URL(request.url);
    return isPackagePath(pathname)
      ? handlePackage(request, ctx, githubRepo, pathname)
      : handleMetadata(request, metadataOrigin, pathname);
  },

  async scheduled(controller, env, ctx) {
    const task = checkAndDispatchRelease(env);
    ctx?.waitUntil?.(task);
    return task;
  },
};
