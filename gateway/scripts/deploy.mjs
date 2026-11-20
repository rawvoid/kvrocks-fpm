#!/usr/bin/env node
/**
 * Renders the assets and deploys the Worker in one step.
 *
 * `wrangler deploy` does not read `.dev.vars`, so the repository slug resolved by the renderer has to
 * be handed over explicitly. Doing that here keeps one source of truth for the value: CI, where
 * `GITHUB_REPOSITORY` is exported by GitHub, and a workstation, where it comes from the `origin`
 * remote, deploy exactly the same way.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "./render.mjs";

const gatewayDir = dirname(dirname(fileURLToPath(import.meta.url)));

if (!process.env.KVROCKS_GATEWAY_URL?.trim().replace(/\/+$/, "")) {
  console.error(
    "deploy: KVROCKS_GATEWAY_URL must be set so install.sh and kvrocks.repo do not ship with __REPO_ORIGIN__."
  );
  process.exit(1);
}

const { slug } = render({ writeDevVars: false });

// Pinned major keeps CI and workstations on the same CLI; `--yes` keeps a non-interactive runner from
// stalling on the install prompt. Extra arguments go to wrangler untouched, so
// `npm run deploy -- --dry-run --outdir /tmp/out` works.
const { status } = spawnSync(
  "npx",
  ["--yes", "wrangler@4", "deploy", "--var", `GITHUB_REPO:${slug}`, ...process.argv.slice(2)],
  { cwd: gatewayDir, stdio: "inherit" }
);

process.exit(status ?? 1);
