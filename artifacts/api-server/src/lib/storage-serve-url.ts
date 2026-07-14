// ─── Canonical storage serve-URL identity (B2.3b-1 / F2) ──────────────────────
//
// A single file object is referenced by two DIFFERENT-looking strings:
//
//   • the STORED serveUrl (what the storage adapter wrote to
//     document_files.file_url), e.g. for S3/R2:
//        /api/storage/s3-object/2%2F1%2Fdocument%2F17_x.pdf?orgId=2
//     — the object key is encodeURIComponent'd (slashes → %2F) and an ?orgId
//       query is appended.
//
//   • the REQUEST path the serve route reconstructs from Express params, e.g.
//        /api/storage/s3-object/2/1/document/17_x.pdf
//     — Express already decoded the :objectKey param and there is no query.
//
// These are the SAME storage object, so a raw string `eq` between them fails and
// the soft-delete download guard would miss S3/R2 (the F2 bypass). This helper
// reduces ANY equivalent serve URL to one canonical identity, and is applied to
// BOTH sides (the incoming request path AND each candidate stored file_url) so
// the comparison is symmetric and backend-agnostic.
//
// Canonical form = { path only, percent-decoded, slash-normalised }:
//   1. drop the query string  → ?orgId / param order can never bypass or falsely
//      match (orgId is redundant: the object key already encodes the org).
//   2. decodeURIComponent      → %2F ↔ / and any other encoding is normalised, so
//      the encoded stored key and the decoded request key collapse together.
//   3. collapse duplicate slashes + trim a trailing slash → cosmetic path noise
//      cannot create a false mismatch.
//
// It is a PURE function of the URL text — it does not trust any externally
// supplied "this resolves to that" mapping; two URLs match iff they canonicalise
// to the identical path. Covers on-premise, S3, R2 and Cloud/GCS serve formats.
export function canonicalizeStorageServeUrl(raw: string): string {
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding — fall back to the raw path rather than throw,
    // so a crafted URL cannot break the guard by triggering an exception.
    decoded = path;
  }
  return decoded.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}
