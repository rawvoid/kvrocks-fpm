/**
 * Shared HTTP response and upstream network helpers for the edge gateway Worker.
 */

export const USER_AGENT = "Kvrocks-Repository-Gateway/1.0";
export const NEGATIVE_TTL = 30;

export function textResponse(body, status, headers = {}) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain", ...headers } });
}

// 502 is the status class apt (Acquire::Retries, default 3) and dnf (`retries`) both retry as transient, and
// `no-store` keeps the failure out of every cache. One status for every cause: the rejection reason of fetch()
// cannot be told apart, and a second code would only make client behaviour harder to predict.
export function badGateway(what) {
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
export async function fetchUpstream(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}
