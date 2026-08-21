/**
 * DEBT-008 — single source of truth for appending a view-token (and optional extra
 * query params like `ct`) to an internal storage serve URL.
 *
 * R2/S3 serve URLs already carry a query string (`?orgId=…`), so the old manual
 * `${url}?vt=${token}` concatenation produced a MALFORMED `?orgId=…?vt=…` — the
 * browser folds everything after the first `?` into one query string, so `vt` is
 * swallowed into the `orgId` value and never parsed. A bare navigation to that URL
 * then carries no token → the download route returns 401. (On-premise serve URLs
 * have no query, so they happened to work — masking the bug.)
 *
 * withViewToken merges query params correctly whether or not the URL already has a
 * query, so `vt` (and any extras) are always real, parseable params.
 */
export function withViewToken(
  url: string,
  token: string,
  extra: Record<string, string> = {},
): string {
  const qIndex = url.indexOf("?");
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const params = new URLSearchParams(qIndex === -1 ? "" : url.slice(qIndex + 1));
  params.set("vt", token);
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${path}?${params.toString()}`;
}
