/**
 * Upstream release watcher (Cron Trigger): queries full tag lists via Git Wire Protocol v2
 * (`ls-refs`) for both the upstream repository and `GITHUB_REPO`, checks recent `release.yaml`
 * `workflow_dispatch` runs, and dispatches at most one oldest pending version (`>= MIN_VERSION`)
 * per tick with head-of-line retry bounding (`MAX_ATTEMPTS`).
 */

import { USER_AGENT } from "./shared.js";

const DEFAULT_UPSTREAM_REPO = "apache/kvrocks";
const DEFAULT_RELEASE_REF = "main";
export const DEFAULT_MIN_VERSION = "2.13.0";
export const DEFAULT_MAX_ATTEMPTS = 3;
const RELEASE_WORKFLOW = "release.yaml";
const GIT_LS_REFS_TAGS_BODY = "0014command=ls-refs\n0001001aref-prefix refs/tags/\n0000";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

// Matches the upstream version syntax accepted by .github/workflows/release.yaml (e.g. 2.17.0, 2.17.0-rc1).
const VERSION_CORE = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*)?";
const UPSTREAM_VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const UPSTREAM_TAG_RE = new RegExp(`^v(${VERSION_CORE})$`);
const LOOSE_UPSTREAM_TAG_RE = /^v([0-9]+\.[0-9]+\.[0-9]+)[^0-9].*$/;
const PACKAGED_TAG_RE = new RegExp(`^v(${VERSION_CORE})-[1-9][0-9]*$`);
// Deliberately excludes `(dry-run)` run titles so dry runs never suppress an automated release.
const RELEASE_RUN_TITLE_RE = new RegExp(`^Release vv?(${VERSION_CORE})-[1-9][0-9]*$`);

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

function normalizeMinVersion(value, defaultValue = DEFAULT_MIN_VERSION) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().replace(/^v/, "");
  try {
    parseVersion(normalized);
  } catch {
    throw new Error(
      `Gateway Misconfiguration: MIN_VERSION must be a valid version (e.g. 2.13.0), got '${value}'.`
    );
  }
  return normalized;
}

function normalizeMaxAttempts(value, defaultValue = DEFAULT_MAX_ATTEMPTS) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }
  const raw = String(value).trim();
  const num = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(num)) {
    throw new Error(
      `Gateway Misconfiguration: MAX_ATTEMPTS must be a positive integer, got '${value}'.`
    );
  }
  return num;
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

function extractVersions(items, regex) {
  if (!Array.isArray(items)) return [];
  const versions = new Set();
  for (const item of items) {
    const match = String(item?.name ?? "").match(regex);
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
 * Decodes a Git Wire Protocol v2 `ls-refs` pkt-line response into tag entries (`{ name }`).
 *
 * @param {string|Uint8Array|ArrayBuffer} input Raw pkt-line response body
 * @returns {Array<{name: string}>} Tag entries stripped of `refs/tags/`
 */
export function parseGitLsRefs(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = UTF8_ENCODER.encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    throw new Error("Git ls-refs returned invalid pkt-line response");
  }

  const tags = [];
  let offset = 0;
  let ended = false;

  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) {
      throw new Error("Git ls-refs returned invalid pkt-line response");
    }

    const hex = UTF8_DECODER.decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new Error("Git ls-refs returned invalid pkt-line response");
    }

    const len = parseInt(hex, 16);
    if (len === 0) {
      ended = true;
      offset += 4;
      if (offset < bytes.length) {
        const trailingEnd =
          offset + 4 === bytes.length &&
          UTF8_DECODER.decode(bytes.subarray(offset, offset + 4)) === "0002";
        if (!trailingEnd) {
          throw new Error("Git ls-refs returned invalid pkt-line response");
        }
      }
      break;
    }
    if (len === 2) {
      ended = true;
      offset += 4;
      if (offset !== bytes.length) {
        throw new Error("Git ls-refs returned invalid pkt-line response");
      }
      break;
    }
    if (len === 1) {
      offset += 4;
      continue;
    }
    if (len < 4 || offset + len > bytes.length) {
      throw new Error("Git ls-refs returned invalid pkt-line response");
    }

    const line = UTF8_DECODER.decode(bytes.subarray(offset + 4, offset + len)).replace(/\r?\n$/, "");
    offset += len;

    if (line.startsWith("ERR ")) {
      throw new Error(`Git ls-refs error: ${line.slice(4)}`);
    }

    const [oid, ref] = line.split(" ");
    if (/^[0-9a-f]{40,64}$/i.test(oid ?? "") && ref?.startsWith("refs/tags/") && !ref.endsWith("^{}")) {
      tags.push({ name: ref.slice("refs/tags/".length) });
    }
  }

  if (!ended) {
    throw new Error("Git ls-refs returned invalid pkt-line response");
  }

  return tags;
}

/**
 * Evaluates pending upstream releases and returns dispatch decisions plus watcher diagnostics.
 *
 * - Waits whenever any non-dry-run workflow run is still active (`status !== "completed"`).
 * - Considers all upstream tags `>= minVersion`, dropping superseded RCs and subtracting all
 *   locally published packaged tags (`v<version>-<iteration>`).
 * - Locks strictly onto the oldest missing version (`head = missingVersions[0]`) without ever
 *   skipping ahead; retries `head` up to `maxAttempts` completed non-dry-run runs before halting.
 * - Records version-like upstream tags (`>= minVersion`) that do not match packaging syntax in
 *   `skippedTags` until their base GA version appears, without dispatching or blocking valid tags.
 *
 * @param {Array<{name?: string}>} upstreamTags Full upstream Git tags
 * @param {Array<{name?: string}>} packagedTags Full local packaged tags
 * @param {Array<{status?: string, display_title?: string}>} [workflowRuns=[]] Recent release.yaml runs
 * @param {{minVersion?: string, maxAttempts?: number|string}} [options={}] Watcher thresholds
 * @returns {{versions: string[], skippedTags: string[], activeRun?: string, emptyUpstream?: boolean, halted?: boolean, head?: string, attempts?: number}}
 */
function evaluatePendingRelease(
  upstreamTags,
  packagedTags,
  workflowRuns = [],
  options = {}
) {
  const minVersion = normalizeMinVersion(options?.minVersion);
  const maxAttempts = normalizeMaxAttempts(options?.maxAttempts);

  const upstreamValid = extractVersions(upstreamTags, UPSTREAM_TAG_RE).filter(
    (version) => compareVersions(version, minVersion) >= 0
  );
  const upstreamValidSet = new Set(upstreamValid);

  const skippedEntries = [];
  const seenSkipped = new Set();
  if (Array.isArray(upstreamTags)) {
    for (const item of upstreamTags) {
      const name = String(item?.name ?? "");
      if (!name || UPSTREAM_TAG_RE.test(name) || seenSkipped.has(name)) continue;

      const looseMatch = name.match(LOOSE_UPSTREAM_TAG_RE);
      if (!looseMatch) continue;
      const base = looseMatch[1];
      if (compareVersions(base, minVersion) < 0 || upstreamValidSet.has(base)) continue;

      seenSkipped.add(name);
      skippedEntries.push({ base, name });
    }
    skippedEntries.sort(
      (a, b) => compareVersions(a.base, b.base) || a.name.localeCompare(b.name)
    );
  }
  const skippedTags = skippedEntries.map((entry) => entry.name);

  const runs = Array.isArray(workflowRuns) ? workflowRuns : [];
  const nonDryRuns = runs.filter(
    (run) => !String(run?.display_title ?? "").endsWith("(dry-run)")
  );

  // Strict single-flight guard: never queue a second run behind an active release.
  const activeRun = nonDryRuns.find((run) => run?.status && run.status !== "completed");
  if (activeRun) {
    return {
      versions: [],
      skippedTags,
      activeRun: String(activeRun.display_title || activeRun.status),
    };
  }

  if (!Array.isArray(upstreamTags) || upstreamTags.length === 0) {
    return { versions: [], skippedTags: [], emptyUpstream: true };
  }

  const packagedSet = new Set(extractVersions(packagedTags, PACKAGED_TAG_RE));

  const attemptCounts = new Map();
  for (const run of nonDryRuns) {
    const match = String(run?.display_title ?? "").match(RELEASE_RUN_TITLE_RE);
    if (match) {
      const version = match[1];
      attemptCounts.set(version, (attemptCounts.get(version) ?? 0) + 1);
    }
  }

  const targetVersions = dropSupersededPrereleases(upstreamValid);
  const missingVersions = targetVersions.filter((version) => !packagedSet.has(version));

  // Head-of-line lock: always evaluate attempts on missingVersions[0] before anything else so
  // repeated failures halt the pipeline instead of skipping ahead out of order.
  if (missingVersions.length > 0) {
    const head = missingVersions[0];
    const attempts = attemptCounts.get(head) ?? 0;
    return attempts < maxAttempts
      ? { versions: [head], skippedTags, head, attempts }
      : { versions: [], skippedTags, halted: true, head, attempts };
  }

  return { versions: [], skippedTags };
}

/**
 * Selects the next upstream Kvrocks version to dispatch to `release.yaml` (at most one per tick).
 *
 * @param {Array<{name?: string}>} upstreamTags Full upstream Git tags
 * @param {Array<{name?: string}>} packagedTags Full local packaged tags
 * @param {Array<{status?: string, display_title?: string}>} [workflowRuns=[]] Recent release.yaml runs
 * @param {{minVersion?: string, maxAttempts?: number|string}} [options={}] Watcher thresholds
 * @returns {string[]} Zero or one version to dispatch (without leading "v")
 */
export function selectPendingReleaseVersions(
  upstreamTags,
  packagedTags,
  workflowRuns = [],
  options = {}
) {
  return evaluatePendingRelease(upstreamTags, packagedTags, workflowRuns, options).versions;
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

async function fetchGitTags(repo, label, token = null) {
  const headers = {
    "Git-Protocol": "version=2",
    "Content-Type": "application/x-git-upload-pack-request",
    Accept: "application/x-git-upload-pack-result",
    "User-Agent": USER_AGENT,
  };
  if (token) {
    headers.Authorization = `Basic ${btoa(`x-access-token:${token}`)}`;
  }

  const res = await fetchGitHub(
    `https://github.com/${repo}.git/git-upload-pack`,
    {
      method: "POST",
      headers,
      body: GIT_LS_REFS_TAGS_BODY,
    },
    label
  );
  return parseGitLsRefs(await res.arrayBuffer());
}

/**
 * Checks upstream tags against locally packaged tags and dispatches at most one pending release.
 *
 * @param {object} env Worker environment bindings
 * @returns {Promise<{dispatched: boolean, versions: string[]}>} Dispatch summary
 */
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

  const minVersion = normalizeMinVersion(env?.MIN_VERSION);
  const maxAttempts = normalizeMaxAttempts(env?.MAX_ATTEMPTS);

  const headers = githubApiHeaders(githubToken);
  const [upstreamTags, packagedTags, runsData] = await Promise.all([
    fetchGitTags(upstreamRepo, "upstream tags"),
    fetchGitTags(githubRepo, "packaged tags", githubToken),
    fetchGitHub(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/${RELEASE_WORKFLOW}/runs?event=workflow_dispatch&per_page=100`,
      { headers },
      "workflow runs"
    ).then((res) => res.json()),
  ]);

  const { versions, skippedTags, activeRun, emptyUpstream, halted, head, attempts } =
    evaluatePendingRelease(upstreamTags, packagedTags, runsData?.workflow_runs ?? [], {
      minVersion,
      maxAttempts,
    });

  if (emptyUpstream) {
    console.warn(JSON.stringify({ event: "watcher.empty_upstream", upstreamRepo, githubRepo }));
  }
  if (halted) {
    console.error(
      JSON.stringify({ event: "watcher.halted", upstreamRepo, githubRepo, head, attempts, maxAttempts })
    );
  }

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
  console.log(
    JSON.stringify({
      event: "watcher",
      upstreamRepo,
      githubRepo,
      minVersion,
      maxAttempts,
      dispatched,
      versions,
      ...(skippedTags.length > 0 ? { skippedTags } : {}),
      ...(activeRun ? { activeRun } : {}),
    })
  );
  return { dispatched, versions };
}
