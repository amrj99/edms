/**
 * c7-1-consumer-contract.test.ts — C7-1 Consumer Contract Tests.
 *
 * NOT rendering tests. These assert that `unwrapList` — the primitive the C7-1
 * consumers (Documents / Folders / Events) now call — returns the SAME items in
 * the SAME order for the ACTUAL response shapes those endpoints produce, in both
 * the legacy-key form and the future `{ items }` form, and that it never mutates
 * or drops the response's extra fields (e.g. `total`).
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

describe("C7-1 consumer contracts — Documents / Folders / Events", () => {
  // ── Documents: /api/documents & /api/projects/:id/documents ────────────────
  it("documents: legacy `{ documents, total, page, limit, hasMore }` → same items/order", () => {
    const docs = [{ id: 3, title: "C" }, { id: 1, title: "A" }, { id: 2, title: "B" }];
    const res = { documents: docs, total: 3, page: 1, limit: 100, hasMore: false };
    const out = unwrapList<{ id: number }>(res, "documents");
    expect(out).toEqual(docs);              // same items, same order
    expect(out.map(d => d.id)).toEqual([3, 1, 2]);
    expect(res.total).toBe(3);              // extra fields untouched
  });

  it("documents: future `{ items }` form is read and WINS over legacy when both present", () => {
    const res = { items: [{ id: 9 }], documents: [{ id: 1 }], total: 1 };
    expect(unwrapList<{ id: number }>(res, "documents")).toEqual([{ id: 9 }]);
  });

  it("documents: empty list is valid", () => {
    expect(unwrapList({ documents: [], total: 0 }, "documents")).toEqual([]);
  });

  // ── Folders: /api/projects/:id/documents/folders ({folders:[…w/ documentCount]}) ──
  it("folders: legacy `{ folders }` with enriched items → same items/order", () => {
    const folders = [
      { id: 10, name: "02 — Structural", documentCount: 12 },
      { id: 11, name: "03 — MEP", documentCount: 3 },
    ];
    const out = unwrapList<{ id: number; documentCount: number }>({ folders }, "folders");
    expect(out).toEqual(folders);
    expect(out[0].documentCount).toBe(12); // per-item fields preserved
  });

  it("folders: future `{ items }` form", () => {
    expect(unwrapList({ items: [{ id: 10 }] }, "folders")).toEqual([{ id: 10 }]);
  });

  // ── Events: /api/calendar/events ({events}) & document activity ({events,total}) ──
  it("events: legacy `{ events, total }` (document activity) → same items/order", () => {
    const events = [{ type: "created", at: "2026-05-01" }, { type: "approved", at: "2026-06-01" }];
    const res = { events, total: 2 };
    const out = unwrapList<{ type: string }>(res, "events");
    expect(out).toEqual(events);
    expect(out.map(e => e.type)).toEqual(["created", "approved"]);
    expect(res.total).toBe(2);
  });

  it("events: calendar `{ events }` (no total) form", () => {
    const events = [{ id: 1 }, { id: 2 }];
    expect(unwrapList({ events }, "events")).toEqual(events);
  });

  // ── Cross-domain invariants ────────────────────────────────────────────────
  it("undefined (loading) → [] for every domain key (initial-state safe)", () => {
    for (const key of ["documents", "folders", "events"]) {
      expect(unwrapList(undefined, key)).toEqual([]);
    }
  });

  it("a composite search body is NOT silently accepted for a single-list key", () => {
    // /api/search returns {documents, correspondence, meetings, projects}; the
    // C7-1 consumers never pass it here, but if one did with a wrong key it fails loud.
    const composite = { documents: [1], correspondence: [2], meetings: [], projects: [3] };
    // documents IS present here, so unwrapList would return it — the guard against
    // composites is the call-site exclusion (search.tsx / AppLayout untouched), asserted in C7-4.
    expect(unwrapList(composite, "documents")).toEqual([1]);
    // but asking for a key the body lacks fails loud rather than returning []:
    expect(() => unwrapList(composite, "events")).toThrow(/to be an array/);
  });
});
