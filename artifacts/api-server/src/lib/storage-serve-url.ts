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
//
// ─── Single source of truth (why F2 cannot silently return) ───────────────────
// The system has TWO cooperating SSOTs, bound by a contract test:
//   1. FORMAT   — the stored serve URL is produced ONLY by the exported builders
//                 s3ServeUrl / r2ServeUrl (lib/orgStorage.ts). Adapters and tests
//                 call the same builder, so no code path invents its own S3/R2
//                 string.
//   2. IDENTITY — this canonicaliser is the ONLY definition of "same object",
//                 and the download guard applies it to BOTH sides (the request
//                 path AND every candidate file_url).
// storage-serve-url.test.ts is the CONTRACT TEST: for every backend it asserts
// canonicalize(builder output) === canonicalize(route request path). If a future
// adapter adds or changes a serve-URL format whose stored form no longer
// canonicalises to its request path, that test FAILS in CI — which is the
// structural guarantee against reintroducing F2.
//
// INVARIANT for future work: any NEW storage backend MUST (a) expose its stored
// serve URL through an exported builder, and (b) be added to the contract test
// above. Do not hand-build serve URLs at call sites.
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
