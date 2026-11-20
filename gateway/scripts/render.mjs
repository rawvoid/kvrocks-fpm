#!/usr/bin/env node
/**
 * Renders `public/` into `dist/`, the directory wrangler uploads as static assets.
 *
 * Rendering resolves the two placeholders in the sources, so a fork edits no file at all:
 *   __GITHUB_REPO__   `owner/repo` of this repository — read from `GITHUB_REPOSITORY` (exported by
 *                     GitHub Actions for every step), else from the `origin` remote for local runs.
 *   __REPO_ORIGIN__   public origin of the deployed gateway — read from `KVROCKS_GATEWAY_URL` and
 *                     baked into `index.html`, `install.sh` and `kvrocks.repo`.
 *
 * An unset `KVROCKS_GATEWAY_URL` is left as the bare placeholder: the landing page falls back to
 * `window.location.origin`, and the installer refuses to guess and asks for `KVROCKS_REPO_URL` instead.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GITHUB_REPO_PLACEHOLDER = "__GITHUB_REPO__";
const REPO_ORIGIN_PLACEHOLDER = "__REPO_ORIGIN__";
const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// Bare origin, no path and no trailing slash: it is concatenated with `/dists/...`, `/kvrocks.gpg`, ...
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/;

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

/** Returns the gateway origin to bake into the static assets, or null when it is not configured. */
function resolveOrigin() {
  const origin = process.env.KVROCKS_GATEWAY_URL?.trim().replace(/\/+$/, "");
  if (!origin) return null;

  if (!ORIGIN_RE.test(origin)) {
    console.error(
      `render: KVROCKS_GATEWAY_URL must be a bare origin such as 'https://repo.example.com', got '${origin}'.`
    );
    process.exit(1);
  }

  return origin;
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
 * Renders `public/` into `outDir` and returns the values it resolved.
 *
 * @returns {{ slug: string, origin: string|null }}
 */
export function render({ outDir = distDir, devVarsPath = join(gatewayDir, ".dev.vars"), writeDevVars = true } = {}) {
  const slug = resolveSlug();
  const origin = resolveOrigin();

  rmSync(outDir, { recursive: true, force: true });
  cpSync(publicDir, outDir, { recursive: true });

  /** Replaces `placeholder` in every rendered file that contains it, returning the paths written. */
  function substitute(placeholder, value) {
    const written = [];
    for (const rel of walk(outDir)) {
      const path = join(outDir, rel);
      const source = readFileSync(path, "utf8");
      if (!source.includes(placeholder)) continue;

      writeFileSync(path, source.replaceAll(placeholder, value));
      written.push(rel);
    }
    return written;
  }

  const renderedPage = substitute(GITHUB_REPO_PLACEHOLDER, slug);
  const renderedOrigin = origin ? substitute(REPO_ORIGIN_PLACEHOLDER, origin) : [];

  // `wrangler dev` reads local-only variables from `.dev.vars`; `wrangler deploy` does not, which is why
  // `scripts/deploy.mjs` passes the same value with `--var`.
  if (writeDevVars) {
    upsertDevVar(devVarsPath, "GITHUB_REPO", slug);
  }

  console.log(`render: repository ${slug}`);
  console.log(`render: origin ${origin ?? "(KVROCKS_GATEWAY_URL unset)"}`);
  for (const rel of renderedPage) console.log(`render: ${rel} <- ${GITHUB_REPO_PLACEHOLDER}`);
  for (const rel of renderedOrigin) console.log(`render: ${rel} <- ${REPO_ORIGIN_PLACEHOLDER}`);

  if (!origin) {
    console.warn(
      "render: KVROCKS_GATEWAY_URL is not set, so __REPO_ORIGIN__ stays unrendered (index.html falls back " +
        "to window.location.origin; install.sh will ask for KVROCKS_REPO_URL)."
    );
  }

  return { slug, origin };
}

// The script also works standalone (`node scripts/render.mjs`), which is what `npm run build` does.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  render();
}
