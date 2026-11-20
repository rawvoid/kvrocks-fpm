/**
 * Apache Kvrocks package repository edge gateway (Cloudflare Worker).
 *
 * - Packages (/pool/*.deb, /rpm/**.rpm) are streamed from GitHub Releases and cached in caches.default.
 * - Landing page, installer and DNF repo config are plain Static Assets served directly by the edge before this Worker.
 * - Repository metadata (APT/DNF indexes and signing keys) is proxied from GitHub Pages.
 * - Hourly Cron Trigger (`scheduled`) watches upstream Apache Kvrocks tags and dispatches release.yaml.
 */

import { handleMetadata, resolveMetadataOrigin } from "./metadata.js";
import { handlePackage, isPackagePath } from "./packages.js";
import { textResponse } from "./shared.js";
import { checkAndDispatchRelease } from "./watcher.js";

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
