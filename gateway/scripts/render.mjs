#!/usr/bin/env node
/**
 * Renders `public/` into `dist/`, the directory wrangler uploads as static assets.
 *
 * Rendering resolves `__GITHUB_REPO__` (`owner/repo` of this repository — read from
 * `GITHUB_REPOSITORY`, `KVROCKS_REPO_SLUG`, or the `origin` remote) and writes `GITHUB_REPO` to
 * `.dev.vars` for `wrangler dev`, so a fork edits no file at all.
 *
 * `__REPO_ORIGIN__` in `install.sh` and `kvrocks.repo` is preserved in `dist/` and filled in per
 * request by the Worker from `new URL(request.url).origin`.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GITHUB_REPO_PLACEHOLDER = "__GITHUB_REPO__";
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const gatewayDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(gatewayDir, "public");
const distDir = join(gatewayDir, "dist");

/** Returns `owner/repo` from the `origin` remote, or null when there is nothing to read. */
function slugFromOriginRemote() {
  let url;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: gatewayDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }

  // https://github.com/owner/repo(.git), git@github.com:owner/repo(.git), ssh://git@github.com/owner/repo
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function resolveSlug() {
  for (const name of ["GITHUB_REPOSITORY", "KVROCKS_REPO_SLUG"]) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    if (SLUG_RE.test(value)) return value;
    console.error(`render: ${name} must be 'owner/repo', got '${value}'.`);
    process.exit(1);
  }

  const remoteSlug = slugFromOriginRemote();
  if (remoteSlug && SLUG_RE.test(remoteSlug)) return remoteSlug;

  console.error(
    "render: cannot determine the repository slug.\n" +
      "Set GITHUB_REPOSITORY=owner/repo, or run this inside a checkout that has a GitHub 'origin' remote."
  );
  process.exit(1);
}

/** Lists files under `dir` as paths relative to it. */
function walk(dir, prefix = "") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(path).isDirectory() ? walk(path, rel) : [rel];
  });
}

/** Updates `key=value` in a `.dev.vars` file while preserving any other entries. */
function upsertDevVar(filePath, key, value) {
  const entry = `${key}=${value}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${entry}\n`);
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  const prefix = `${key}=`;
  let updated = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix)) {
      updated = true;
      return entry;
    }
    return line;
  });
  if (!updated) next.push(entry);

  writeFileSync(filePath, `${next.join("\n")}\n`);
}

/**
 * Renders `public/` into `outDir` and returns the repository slug it resolved.
 *
 * @returns {{ slug: string }}
 */
export function render({ outDir = distDir, devVarsPath = join(gatewayDir, ".dev.vars"), writeDevVars = true } = {}) {
  const slug = resolveSlug();

  rmSync(outDir, { recursive: true, force: true });
  cpSync(publicDir, outDir, { recursive: true });

  const written = [];
  for (const rel of walk(outDir)) {
    const path = join(outDir, rel);
    const source = readFileSync(path, "utf8");
    if (!source.includes(GITHUB_REPO_PLACEHOLDER)) continue;

    writeFileSync(path, source.replaceAll(GITHUB_REPO_PLACEHOLDER, slug));
    written.push(rel);
  }

  // `wrangler dev` reads local-only variables from `.dev.vars`; `wrangler deploy` does not, which is why
  // `scripts/deploy.mjs` passes the same value with `--var`.
  if (writeDevVars) {
    upsertDevVar(devVarsPath, "GITHUB_REPO", slug);
  }

  console.log(`render: repository ${slug}`);
  for (const rel of written) console.log(`render: ${rel} <- ${GITHUB_REPO_PLACEHOLDER}`);

  return { slug };
}

// The script also works standalone (`node scripts/render.mjs`), which is what `npm run build` does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  render();
}
