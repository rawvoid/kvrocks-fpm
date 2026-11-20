import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  compareVersions,
  parseUpstreamTagsAtom,
  selectPendingReleaseVersions,
} from "../src/watcher.js";

const TEST_REPO = "test-owner/test-repo";
const SCHEDULE_ENV = {
  GITHUB_REPO: TEST_REPO,
  GITHUB_TOKEN: "ghp_test_token_123",
};

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
