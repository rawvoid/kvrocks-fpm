/**
 * Apache Kvrocks package repository edge gateway (Cloudflare Worker).
 *
 * - Packages (/pool/*.deb, /rpm/**.rpm) are streamed from GitHub Releases and cached in caches.default.
 * - Landing page, stylesheet and tab icon (/, /styles.css, /favicon.svg) are static assets served directly by the edge.
 * - Installer and DNF repo config (/install.sh, /kvrocks.repo) enter the Worker first to fill in the request origin.
 * - Repository metadata (APT/DNF indexes and signing keys) is proxied from GitHub Pages.
 * - Hourly Cron Trigger (`scheduled`) watches upstream Apache Kvrocks tags and dispatches release.yaml.
 */

import { handleMetadata, resolveMetadataOrigin } from "./metadata.js";
import { handlePackage, isPackagePath } from "./packages.js";
import { textResponse } from "./shared.js";
import { checkAndDispatchRelease } from "./watcher.js";

const REPO_ORIGIN_PLACEHOLDER = "__REPO_ORIGIN__";
const SAFE_ORIGIN_RE = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]+)?$/i;
const UTF8_ENCODER = new TextEncoder();

function isTemplatePath(pathname) {
  return pathname === "/install.sh" || pathname === "/kvrocks.repo";
}

async function handleTemplate(request, env, origin, pathname) {
  if (!SAFE_ORIGIN_RE.test(origin)) {
    return textResponse("Bad Request: invalid request origin", 400, { "Cache-Control": "no-store" });
  }
  if (!env.ASSETS?.fetch) {
    return textResponse("Gateway Misconfiguration: ASSETS binding must be configured.", 500);
  }

  const asset = await env.ASSETS.fetch(new Request(`${origin}${pathname}`));
  if (!asset.ok) {
    await asset.body?.cancel();
    return textResponse("Not Found", 404, { "Cache-Control": "no-store" });
  }

  const rendered = (await asset.text()).replaceAll(REPO_ORIGIN_PLACEHOLDER, () => origin);
  const bytes = UTF8_ENCODER.encode(rendered);
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
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

    const { origin, pathname } = new URL(request.url);
    if (isTemplatePath(pathname)) {
      return handleTemplate(request, env, origin, pathname);
    }
    return isPackagePath(pathname)
      ? handlePackage(request, ctx, githubRepo, pathname)
      : handleMetadata(request, metadataOrigin, pathname);
  },

  async scheduled(controller, env) {
    return checkAndDispatchRelease(env);
  },
};
