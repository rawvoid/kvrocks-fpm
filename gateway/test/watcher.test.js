import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  compareVersions,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MIN_VERSION,
  parseGitLsRefs,
  selectPendingReleaseVersions,
} from "../src/watcher.js";

const TEST_REPO = "test-owner/test-repo";
const SCHEDULE_ENV = {
  GITHUB_REPO: TEST_REPO,
  GITHUB_TOKEN: "ghp_test_token_123",
};

const UTF8_ENCODER = new TextEncoder();
const FAKE_OID = "a".repeat(40);
const EXPECTED_LS_REFS_BODY = "0014command=ls-refs\n0001001aref-prefix refs/tags/\n0000";

function pktLine(text) {
  const byteLen = UTF8_ENCODER.encode(text).length;
  const lenHex = (byteLen + 4).toString(16).padStart(4, "0");
  return `${lenHex}${text}`;
}

function lsRefsBody(tagNames) {
  return (
    tagNames
      .map((tag) => {
        const ref = tag.startsWith("refs/") ? tag : `refs/tags/${tag}`;
        return pktLine(`${FAKE_OID} ${ref}\n`);
      })
      .join("") + "0000"
  );
}

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

test("parseGitLsRefs - Parses pkt-line tag refs and ignores peeled/non-tag lines", () => {
  const body =
    "0001" +
    pktLine(`${FAKE_OID} refs/tags/v2.13.0\n`) +
    pktLine(`${FAKE_OID} refs/tags/v2.17.0-rc1^{}\n`) +
    pktLine(`${FAKE_OID} refs/tags/v2.17.0\r\n`) +
    pktLine(`${FAKE_OID} refs/tags/v2.18.0-测试 peeled:${FAKE_OID}\n`) +
    pktLine(`${FAKE_OID} refs/heads/main\n`) +
    "0000";

  const expected = [
    { name: "v2.13.0" },
    { name: "v2.17.0" },
    { name: "v2.18.0-测试" },
  ];

  assert.deepEqual(parseGitLsRefs(body), expected);
  const bytes = UTF8_ENCODER.encode(body);
  assert.deepEqual(parseGitLsRefs(bytes), expected);
  assert.deepEqual(parseGitLsRefs(bytes.buffer), expected);

  // Empty flush packet and 0002 response-end packet are both valid terminators
  assert.deepEqual(parseGitLsRefs("0000"), []);
  assert.deepEqual(parseGitLsRefs("00000002"), []);
  assert.deepEqual(parseGitLsRefs(pktLine(`${FAKE_OID} refs/tags/v2.17.0\n`) + "0002"), [
    { name: "v2.17.0" },
  ]);
});

test("parseGitLsRefs - Rejects invalid, truncated, HTML, or ERR pkt-line payloads", () => {
  for (const bad of [
    "",
    "<html>Error</html>",
    "000",
    "zzzz0000",
    "0003",
    "0000<html>trailing</html>",
    pktLine(`${FAKE_OID} refs/tags/v2.17.0\n`), // missing 0000/0002 terminator
    `00ff${FAKE_OID} refs/tags/v2.17.0\n0000`, // truncated packet length
    null,
    123,
  ]) {
    assert.throws(() => parseGitLsRefs(bad), /invalid pkt-line response/);
  }

  assert.throws(
    () => parseGitLsRefs(pktLine("ERR unknown command\n") + "0000"),
    /Git ls-refs error: unknown command/
  );
});

test("selectPendingReleaseVersions - Returns empty when published tags are up to date", () => {
  const upstream = [
    { name: "v2.13.0" },
    { name: "v2.17.0-rc1" },
    { name: "v2.17.0-rc2" },
    { name: "v2.17.0" },
  ];
  const packaged = [
    { name: "v2.13.0-1" },
    { name: "v2.17.0-1" },
  ];

  assert.deepEqual(selectPendingReleaseVersions(upstream, packaged, []), []);
  assert.deepEqual(selectPendingReleaseVersions([], packaged, []), []);
});

test("selectPendingReleaseVersions - Filters by MIN_VERSION and validates options", () => {
  assert.equal(DEFAULT_MIN_VERSION, "2.13.0");
  assert.equal(DEFAULT_MAX_ATTEMPTS, 3);

  const upstream = [
    { name: "v1.0.0" },
    { name: "v.1.1.2" },
    { name: "v2.12.0" },
    { name: "v2.13.0-rc1" },
    { name: "v2.13.0" },
    { name: "v2.14.0" },
  ];

  // Default MIN_VERSION (2.13.0) excludes v1.0.0, v2.12.0, and v2.13.0-rc1
  assert.deepEqual(selectPendingReleaseVersions(upstream, [], []), ["2.13.0"]);

  // Custom minVersion (with and without leading "v")
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [], { minVersion: "v2.14.0" }),
    ["2.14.0"]
  );
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [{ name: "v2.14.0-1" }], [], { minVersion: "2.12.0" }),
    ["2.12.0"]
  );
  // Empty/whitespace options fall back to defaults
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [{ name: "v2.13.0-1" }], [], {
      minVersion: "  ",
      maxAttempts: "",
    }),
    ["2.14.0"]
  );

  // Invalid options fail fast
  for (const minVersion of ["bad", "2.13", "2.13.0-rc_1"]) {
    assert.throws(
      () => selectPendingReleaseVersions(upstream, [], [], { minVersion }),
      /Gateway Misconfiguration: MIN_VERSION/
    );
  }
  for (const maxAttempts of ["0", "-1", "1.5", "abc", 0]) {
    assert.throws(
      () => selectPendingReleaseVersions(upstream, [], [], { maxAttempts }),
      /Gateway Misconfiguration: MAX_ATTEMPTS/
    );
  }
});

test("selectPendingReleaseVersions - Brand-new repo dispatches oldest missing GA sequentially and skips superseded historical RCs", () => {
  const upstream = [
    { name: "v2.12.0" },
    { name: "v2.13.0-rc1" },
    { name: "v2.13.0" },
    { name: "v2.14.0-rc1" },
    { name: "v2.14.0" },
    { name: "v2.15.0-rc1" },
    { name: "v2.15.0" },
    { name: "v2.16.0-rc1" },
    { name: "v2.16.0" },
    { name: "v2.17.0-rc1" },
    { name: "v2.17.0-rc2" },
    { name: "v2.17.0" },
    { name: "v2.18.0-rc1" },
  ];

  // Progresses strictly one version per tick in ascending order, skipping superseded RCs
  const expectedSequence = ["2.13.0", "2.14.0", "2.15.0", "2.16.0", "2.17.0", "2.18.0-rc1"];
  const packaged = [];

  for (const next of expectedSequence) {
    assert.deepEqual(selectPendingReleaseVersions(upstream, packaged, []), [next]);
    packaged.push({ name: `v${next}-1` });
  }

  assert.deepEqual(selectPendingReleaseVersions(upstream, packaged, []), []);
});

test("selectPendingReleaseVersions - Tracks active RCs sequentially through GA", () => {
  const basePackaged = [{ name: "v2.17.0-1" }];
  const baseUpstream = [{ name: "v2.17.0" }];

  // New RC after 2.17.0 GA
  assert.deepEqual(
    selectPendingReleaseVersions([...baseUpstream, { name: "v2.18.0-rc1" }], basePackaged, []),
    ["2.18.0-rc1"]
  );

  // Next RC after rc1 is published
  assert.deepEqual(
    selectPendingReleaseVersions(
      [...baseUpstream, { name: "v2.18.0-rc1" }, { name: "v2.18.0-rc2" }],
      [...basePackaged, { name: "v2.18.0-rc1-1" }],
      []
    ),
    ["2.18.0-rc2"]
  );

  // Final GA after rc2 is published
  assert.deepEqual(
    selectPendingReleaseVersions(
      [...baseUpstream, { name: "v2.18.0-rc1" }, { name: "v2.18.0-rc2" }, { name: "v2.18.0" }],
      [...basePackaged, { name: "v2.18.0-rc1-1" }, { name: "v2.18.0-rc2-1" }],
      []
    ),
    ["2.18.0"]
  );

  // If rc1, rc2, and GA all exist before packaging, superseded RCs are dropped
  assert.deepEqual(
    selectPendingReleaseVersions(
      [...baseUpstream, { name: "v2.18.0-rc1" }, { name: "v2.18.0-rc2" }, { name: "v2.18.0" }],
      basePackaged,
      []
    ),
    ["2.18.0"]
  );
});

test("selectPendingReleaseVersions - Dispatches maintenance branch RCs and GAs >= MIN_VERSION in ascending order", () => {
  const upstream = [
    { name: "v2.12.1" },
    { name: "v2.13.0" },
    { name: "v2.14.0" },
    { name: "v2.14.1-rc1" },
    { name: "v2.18.0" },
    { name: "v2.18.1-rc1" },
  ];
  const packaged = [
    { name: "v2.13.0-1" },
    { name: "v2.14.0-1" },
    { name: "v2.18.0-1" },
  ];

  // Maintenance RC 2.14.1-rc1 comes before 2.18.1-rc1
  assert.deepEqual(selectPendingReleaseVersions(upstream, packaged, []), ["2.14.1-rc1"]);

  // Once 2.14.1 GA lands, 2.14.1-rc1 is superseded and 2.14.1 is dispatched before 2.18.1-rc1
  assert.deepEqual(
    selectPendingReleaseVersions([...upstream, { name: "v2.14.1" }], packaged, []),
    ["2.14.1"]
  );

  // After 2.14.1 is packaged, advances to 2.18.1-rc1
  assert.deepEqual(
    selectPendingReleaseVersions(
      [...upstream, { name: "v2.14.1" }],
      [...packaged, { name: "v2.14.1-1" }],
      []
    ),
    ["2.18.1-rc1"]
  );
});

test("selectPendingReleaseVersions - Enforces strict single-flight active run guard while ignoring dry-runs", () => {
  const upstream = [{ name: "v2.13.0" }, { name: "v2.14.0" }];

  for (const status of ["in_progress", "queued", "waiting"]) {
    assert.deepEqual(
      selectPendingReleaseVersions(upstream, [], [
        { status, display_title: "Release v2.13.0-1" },
      ]),
      []
    );
    assert.deepEqual(
      selectPendingReleaseVersions(upstream, [], [
        { status, display_title: "Release Packages" },
      ]),
      []
    );
  }

  // Dry-run workflows (active or completed) never block or count toward attempts
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [
      { status: "in_progress", display_title: "Release v2.13.0-1 (dry-run)" },
      { status: "completed", conclusion: "failure", display_title: "Release v2.13.0-1 (dry-run)" },
      { status: "completed", conclusion: "failure", display_title: "Release v2.13.0-1 (dry-run)" },
      { status: "completed", conclusion: "failure", display_title: "Release v2.13.0-1 (dry-run)" },
    ]),
    ["2.13.0"]
  );
});

test("selectPendingReleaseVersions - Retries head up to MAX_ATTEMPTS then halts globally without skipping", () => {
  const upstream = [{ name: "v2.13.0" }, { name: "v2.14.0" }];
  const failed213 = { status: "completed", conclusion: "failure", display_title: "Release v2.13.0-1" };

  // Attempts 0, 1, 2 -> keeps retrying 2.13.0
  assert.deepEqual(selectPendingReleaseVersions(upstream, [], []), ["2.13.0"]);
  assert.deepEqual(selectPendingReleaseVersions(upstream, [], [failed213]), ["2.13.0"]);
  assert.deepEqual(selectPendingReleaseVersions(upstream, [], [failed213, failed213]), ["2.13.0"]);

  // Attempt 3 -> halts globally (does NOT skip 2.13.0 to dispatch 2.14.0)
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [failed213, failed213, failed213]),
    []
  );

  // An unrelated manual succeeded run does not reset head's attempt count
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [
      { status: "completed", conclusion: "success", display_title: "Release v2.12.0-2" },
      failed213,
      failed213,
      failed213,
    ]),
    []
  );

  // Manual fix & release of v2.13.0-1 unblocks queue at 2.14.0
  assert.deepEqual(
    selectPendingReleaseVersions(
      upstream,
      [{ name: "v2.13.0-1" }],
      [failed213, failed213, failed213]
    ),
    ["2.14.0"]
  );

  // Custom maxAttempts is respected
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [failed213], { maxAttempts: 1 }),
    []
  );
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [failed213, failed213], { maxAttempts: 2 }),
    []
  );
  assert.deepEqual(
    selectPendingReleaseVersions(upstream, [], [failed213], { maxAttempts: 2 }),
    ["2.13.0"]
  );

  // Superseded failed RC automatically unblocks when upstream cuts a newer RC
  const failedRc1 = { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-rc1-1" };
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.17.0" }, { name: "v2.18.0-rc1" }],
      [{ name: "v2.17.0-1" }],
      [failedRc1, failedRc1, failedRc1]
    ),
    []
  );
  assert.deepEqual(
    selectPendingReleaseVersions(
      [{ name: "v2.17.0" }, { name: "v2.18.0-rc1" }, { name: "v2.18.0-rc2" }],
      [{ name: "v2.17.0-1" }],
      [failedRc1, failedRc1, failedRc1]
    ),
    ["2.18.0-rc2"]
  );
});

test("selectPendingReleaseVersions - Ignores unrecognized or malformed upstream tags without blocking valid releases", () => {
  const upstreamWithBadTag = [
    { name: "v2.17.0" },
    { name: "v2.18.0-alpha-1" },
    { name: "v2.12.0-alpha-1" },
    { name: "v.1.1.2" },
    { name: "nightly" },
  ];

  // Valid pending versions are never blocked by malformed tags (including on brand-new repos)
  assert.deepEqual(selectPendingReleaseVersions(upstreamWithBadTag, [], []), ["2.17.0"]);

  // Once valid versions are packaged, unrecognized tags are still ignored (never dispatched)
  assert.deepEqual(
    selectPendingReleaseVersions(upstreamWithBadTag, [{ name: "v2.17.0-1" }], []),
    []
  );
});

async function runScheduled({ env = SCHEDULE_ENV, fetchImpl } = {}) {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    return fetchImpl(url, init);
  };

  try {
    const result = await worker.scheduled({ cron: "0 * * * *" }, env, {});
    return { result, fetchCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("worker.scheduled - Throws descriptive error on missing or invalid configuration", async () => {
  const neverFetch = () => {
    throw new Error("should not call fetch");
  };

  await assert.rejects(
    runScheduled({ env: { GITHUB_TOKEN: "tok" }, fetchImpl: neverFetch }),
    /Gateway Misconfiguration: GITHUB_REPO \(owner\/repo\) must be configured\./
  );

  for (const env of [{ GITHUB_REPO: TEST_REPO }, { GITHUB_REPO: TEST_REPO, GITHUB_TOKEN: "" }]) {
    await assert.rejects(
      runScheduled({ env, fetchImpl: neverFetch }),
      /Gateway Misconfiguration: GITHUB_TOKEN secret must be configured\./
    );
  }

  await assert.rejects(
    runScheduled({ env: { ...SCHEDULE_ENV, MIN_VERSION: "bad" }, fetchImpl: neverFetch }),
    /Gateway Misconfiguration: MIN_VERSION/
  );
  await assert.rejects(
    runScheduled({ env: { ...SCHEDULE_ENV, MAX_ATTEMPTS: "0" }, fetchImpl: neverFetch }),
    /Gateway Misconfiguration: MAX_ATTEMPTS/
  );
});

test("worker.scheduled - Queries Git ls-refs + workflow runs and dispatches single oldest pending release", async () => {
  const expectedBasicAuth = `Basic ${btoa("x-access-token:ghp_test_token_123")}`;

  const { result, fetchCalls } = await runScheduled({
    fetchImpl: (url, init) => {
      if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
        assert.equal(init.method, "POST");
        assert.equal(init.headers["Git-Protocol"], "version=2");
        assert.equal(init.headers["Content-Type"], "application/x-git-upload-pack-request");
        assert.equal(init.headers.Authorization, undefined);
        assert.equal(init.body, EXPECTED_LS_REFS_BODY);
        return new Response(
          lsRefsBody(["v2.12.0", "v2.13.0", "v2.14.0-rc1", "v2.14.0", "v2.15.0-rc1"])
        );
      }
      if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
        assert.equal(init.method, "POST");
        assert.equal(init.headers["Git-Protocol"], "version=2");
        assert.equal(init.headers["Content-Type"], "application/x-git-upload-pack-request");
        assert.equal(init.headers.Authorization, expectedBasicAuth);
        assert.equal(init.body, EXPECTED_LS_REFS_BODY);
        return new Response(lsRefsBody(["v2.13.0-1"]));
      }
      if (
        url ===
        `https://api.github.com/repos/${TEST_REPO}/actions/workflows/release.yaml/runs?event=workflow_dispatch&per_page=100`
      ) {
        assert.equal(init.headers.Authorization, "Bearer ghp_test_token_123");
        assert.equal(init.headers.Accept, "application/vnd.github+json");
        return Response.json({ workflow_runs: [] });
      }
      if (
        url === `https://api.github.com/repos/${TEST_REPO}/actions/workflows/release.yaml/dispatches` &&
        init?.method === "POST"
      ) {
        assert.equal(init.headers.Authorization, "Bearer ghp_test_token_123");
        return new Response(null, { status: 204 });
      }
      return new Response("Unexpected request", { status: 500 });
    },
  });

  // Dispatches only 2.14.0 (skipping superseded 2.14.0-rc1, holding 2.15.0-rc1 for next tick)
  assert.deepEqual(result, { dispatched: true, versions: ["2.14.0"] });
  assert.equal(fetchCalls.length, 4);
  assert.deepEqual(JSON.parse(fetchCalls[3].init.body), {
    ref: "main",
    inputs: { version: "2.14.0", iteration: "1" },
  });
});

test("worker.scheduled - Respects custom UPSTREAM_REPO, RELEASE_REF, MIN_VERSION, and MAX_ATTEMPTS", async () => {
  const { result, fetchCalls } = await runScheduled({
    env: {
      ...SCHEDULE_ENV,
      UPSTREAM_REPO: "custom-org/kvrocks-fork",
      RELEASE_REF: "release-branch",
      MIN_VERSION: "v2.15.0",
      MAX_ATTEMPTS: "2",
    },
    fetchImpl: (url, init) => {
      if (url === "https://github.com/custom-org/kvrocks-fork.git/git-upload-pack") {
        return new Response(lsRefsBody(["v2.14.0", "v2.15.0", "v2.16.0"]));
      }
      if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
        return new Response("0000");
      }
      if (url.includes("/actions/workflows/release.yaml/runs")) {
        return Response.json({
          workflow_runs: [
            { status: "completed", conclusion: "failure", display_title: "Release v2.15.0-1" },
          ],
        });
      }
      if (url.endsWith("/dispatches") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response("Unexpected request", { status: 500 });
    },
  });

  assert.deepEqual(result, { dispatched: true, versions: ["2.15.0"] });
  assert.deepEqual(JSON.parse(fetchCalls[3].init.body), {
    ref: "release-branch",
    inputs: { version: "2.15.0", iteration: "1" },
  });
});

test("worker.scheduled - Makes no POST dispatch when up to date or halted at MAX_ATTEMPTS", async () => {
  const upToDate = await runScheduled({
    fetchImpl: (url) => {
      if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
        return new Response(lsRefsBody(["v2.17.0", "v2.17.0-rc2"]));
      }
      if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
        return new Response(lsRefsBody(["v2.17.0-1"]));
      }
      return Response.json({ workflow_runs: [] });
    },
  });

  assert.deepEqual(upToDate.result, { dispatched: false, versions: [] });
  assert.equal(upToDate.fetchCalls.length, 3);
  assert.equal(
    upToDate.fetchCalls.some((c) => c.init?.method === "POST" && c.url.endsWith("/dispatches")),
    false
  );

  const halted = await runScheduled({
    fetchImpl: (url) => {
      if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
        return new Response(lsRefsBody(["v2.17.0", "v2.18.0"]));
      }
      if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
        return new Response(lsRefsBody(["v2.17.0-1"]));
      }
      return Response.json({
        workflow_runs: [
          { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-1" },
          { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-1" },
          { status: "completed", conclusion: "failure", display_title: "Release v2.18.0-1" },
        ],
      });
    },
  });

  assert.deepEqual(halted.result, { dispatched: false, versions: [] });
  assert.equal(halted.fetchCalls.length, 3);
  assert.equal(
    halted.fetchCalls.some((c) => c.init?.method === "POST" && c.url.endsWith("/dispatches")),
    false
  );
});

test("worker.scheduled - Rejects on GitHub HTTP error, invalid pkt-line response, or network error", async () => {
  await assert.rejects(
    runScheduled({
      fetchImpl: (url) => {
        if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
          return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
        }
        if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
          return new Response("0000");
        }
        return Response.json({ workflow_runs: [] });
      },
    }),
    /GitHub API error \(upstream tags, 429\): Too Many Requests/
  );

  await assert.rejects(
    runScheduled({
      fetchImpl: (url) => {
        if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
          return new Response("<html>not pkt-line</html>");
        }
        if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
          return new Response("0000");
        }
        return Response.json({ workflow_runs: [] });
      },
    }),
    /invalid pkt-line response/
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

test("worker.scheduled - Reports skippedTags in watcher log and logs warnings/errors for empty feed and halted head", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];
  const warnings = [];
  const errors = [];
  console.log = (msg) => logs.push(JSON.parse(msg));
  console.warn = (msg) => warnings.push(JSON.parse(msg));
  console.error = (msg) => errors.push(JSON.parse(msg));

  try {
    // Uncovered invalid tag >= MIN_VERSION appears in watcher log as skippedTags without warning
    await runScheduled({
      fetchImpl: (url, init) => {
        if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
          return new Response(lsRefsBody(["v2.17.0", "v2.18.0-alpha-1"]));
        }
        if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
          return new Response("0000");
        }
        if (url.endsWith("/dispatches") && init?.method === "POST") {
          return new Response(null, { status: 204 });
        }
        return Response.json({ workflow_runs: [] });
      },
    });

    // Once base GA tag (v2.18.0) exists upstream, skippedTags omits v2.18.0-alpha-1
    await runScheduled({
      fetchImpl: (url, init) => {
        if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
          return new Response(lsRefsBody(["v2.17.0", "v2.18.0-alpha-1", "v2.18.0"]));
        }
        if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
          return new Response(lsRefsBody(["v2.17.0-1"]));
        }
        if (url.endsWith("/dispatches") && init?.method === "POST") {
          return new Response(null, { status: 204 });
        }
        return Response.json({ workflow_runs: [] });
      },
    });

    await runScheduled({
      fetchImpl: (url) => {
        if (url.endsWith("/git-upload-pack")) return new Response("0000");
        return Response.json({ workflow_runs: [] });
      },
    });

    await runScheduled({
      fetchImpl: (url) => {
        if (url === "https://github.com/apache/kvrocks.git/git-upload-pack") {
          return new Response(lsRefsBody(["v2.17.0"]));
        }
        if (url === `https://github.com/${TEST_REPO}.git/git-upload-pack`) {
          return new Response("0000");
        }
        return Response.json({
          workflow_runs: Array(3).fill({
            status: "completed",
            conclusion: "failure",
            display_title: "Release v2.17.0-1",
          }),
        });
      },
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.deepEqual(logs[0].versions, ["2.17.0"]);
  assert.deepEqual(logs[0].skippedTags, ["v2.18.0-alpha-1"]);
  assert.deepEqual(logs[1].versions, ["2.18.0"]);
  assert.equal(logs[1].skippedTags, undefined);
  assert.deepEqual(
    warnings.map((w) => w.event),
    ["watcher.empty_upstream"]
  );
  assert.equal(errors[0].event, "watcher.halted");
  assert.equal(errors[0].head, "2.17.0");
});
