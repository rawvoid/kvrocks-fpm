/**
 * Upstream release watcher (Cron Trigger): inspects the latest upstream Apache Kvrocks tags from
 * `tags.atom`, compares them against published GitHub Releases and recent workflow runs in
 * `GITHUB_REPO`, and queues `release.yaml` dispatches in ascending version order.
 */

import { USER_AGENT } from "./shared.js";

const DEFAULT_UPSTREAM_REPO = "apache/kvrocks";
const DEFAULT_RELEASE_REF = "main";
const RELEASE_WORKFLOW = "release.yaml";

// Matches the upstream version syntax accepted by .github/workflows/release.yaml (e.g. 2.17.0, 2.17.0-rc1).
const VERSION_CORE = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*)?";
const UPSTREAM_VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const UPSTREAM_TAG_RE = new RegExp(`^(?:refs/tags/)?v(${VERSION_CORE})$`);
const PACKAGED_TAG_RE = new RegExp(`^(?:refs/tags/)?v(${VERSION_CORE})-[1-9][0-9]*$`);
// Deliberately excludes `(dry-run)` run titles so dry runs never suppress an automated release.
const RELEASE_RUN_TITLE_RE = new RegExp(`^Release vv?(${VERSION_CORE})-[1-9][0-9]*$`);
const RELEASE_RUN_ANY_TITLE_RE = /^Release vv?(.+)-[1-9][0-9]*$/;

const isPrerelease = (version) => version.includes("-");

function minorSeries(version) {
  const { major, minor } = parseVersion(version);
  return `${major}.${minor}`;
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
  const knownSet = new Set(knownVersions);
  const overallBaseline = knownVersions.at(-1) ?? null;
  const stableKnown = knownVersions.filter((v) => !isPrerelease(v));
  const stableBaseline = stableKnown.at(-1) ?? null;
  const seriesStableBaseline = new Map();
  for (const version of stableKnown) {
    seriesStableBaseline.set(minorSeries(version), version);
  }

  const dispatchedRawVersions = new Set(dispatchedVersions);
  for (const run of nonDryRuns) {
    const match = String(run?.display_title ?? "").match(RELEASE_RUN_ANY_TITLE_RE);
    if (match) dispatchedRawVersions.add(match[1]);
  }

  if (overallBaseline === null) {
    const newestName = String(getTagText(upstreamTags[0]) ?? "").replace(/^refs\/tags\//, "");
    if (newestName && !UPSTREAM_TAG_RE.test(newestName)) {
      const rawVersion = newestName.replace(/^v/, "");
      return rawVersion && !dispatchedRawVersions.has(rawVersion) ? [rawVersion] : [];
    }
    const upstreamVersions = extractVersions(upstreamTags, UPSTREAM_TAG_RE, getTagText);
    const deduped = dropSupersededPrereleases(upstreamVersions);
    const latest = deduped.at(-1);
    if (!latest) return [];
    if (isPrerelease(latest)) {
      const latestStable = deduped.filter((v) => !isPrerelease(v)).at(-1);
      if (latestStable) return [latestStable, latest];
    }
    return [latest];
  }

  const validNew = new Set();
  const bootstrapStables = [];
  const invalidNew = [];
  let seenBaselineOrOlder = false;

  for (const item of upstreamTags) {
    const rawName = String(getTagText(item) ?? "").replace(/^refs\/tags\//, "");
    if (!rawName) continue;

    const match = rawName.match(UPSTREAM_TAG_RE);
    if (match) {
      const version = match[1];
      if (compareVersions(version, overallBaseline) <= 0) {
        seenBaselineOrOlder = true;
      }
      if (knownSet.has(version)) continue;

      if (!isPrerelease(version)) {
        if (stableBaseline === null) {
          bootstrapStables.push(version);
        } else if (compareVersions(version, stableBaseline) > 0) {
          validNew.add(version);
        } else {
          const seriesBaseline = seriesStableBaseline.get(minorSeries(version));
          if (seriesBaseline && compareVersions(version, seriesBaseline) > 0) {
            validNew.add(version);
          }
        }
      } else if (compareVersions(version, overallBaseline) > 0) {
        validNew.add(version);
      }
    } else if (!seenBaselineOrOlder) {
      const rawVersion = rawName.replace(/^v/, "");
      if (rawVersion && !dispatchedRawVersions.has(rawVersion) && !invalidNew.includes(rawVersion)) {
        invalidNew.push(rawVersion);
      }
    }
  }

  if (bootstrapStables.length > 0) {
    bootstrapStables.sort(compareVersions);
    validNew.add(bootstrapStables.at(-1));
  }

  const candidates = dropSupersededPrereleases([...validNew].sort(compareVersions));
  return [...candidates, ...invalidNew.reverse()];
}

function githubApiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
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

export async function checkAndDispatchRelease(env) {
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
          "User-Agent": USER_AGENT,
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
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&per_page=100`,
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

  const dispatched = versions.length > 0;
  console.log(JSON.stringify({ event: "watcher", upstreamRepo, githubRepo, dispatched, versions }));
  return { dispatched, versions };
}
