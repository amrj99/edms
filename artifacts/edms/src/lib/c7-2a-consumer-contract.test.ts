/**
 * c7-2a-consumer-contract.test.ts — C7-2a Consumer Contract Tests.
 *
 * NOT rendering tests. They assert that `unwrapList` — the primitive the C7-2a
 * consumers (Projects / Organizations) now call — returns the SAME items in the
 * SAME order for the ACTUAL shapes those endpoints produce (legacy key and the
 * future `{ items }` form), preserves order, treats an empty array as valid, and
 * never mutates the response's extra fields (`total`).
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

describe("C7-2a consumer contracts — Projects / Organizations", () => {
  // ── Projects: /api/projects → { projects, total } ──────────────────────────
  it("projects: legacy `{ projects, total }` → same items/order, total untouched", () => {
    const projects = [{ id: 3, name: "Gamma" }, { id: 1, name: "Alpha" }, { id: 2, name: "Beta" }];
    const res = { projects, total: 3 };
    const out = unwrapList<{ id: number }>(res, "projects");
    expect(out).toEqual(projects);
    expect(out.map(p => p.id)).toEqual([3, 1, 2]); // order preserved
    expect(res.total).toBe(3);                     // extra field untouched
  });

  it("projects: future `{ items }` form is read and WINS over legacy when both present", () => {
    expect(unwrapList<{ id: number }>({ items: [{ id: 9 }], projects: [{ id: 1 }] }, "projects"))
      .toEqual([{ id: 9 }]);
  });

  it("projects: empty list is valid", () => {
    expect(unwrapList({ projects: [], total: 0 }, "projects")).toEqual([]);
  });

  // ── Organizations: /api/organizations → { organizations, total } ───────────
  it("organizations: legacy `{ organizations, total }` → same items/order", () => {
    const orgs = [{ id: 5, name: "Org E", userCount: 4 }, { id: 2, name: "Org B", userCount: 9 }];
    const res = { organizations: orgs, total: 2 };
    const out = unwrapList<{ id: number; userCount: number }>(res, "organizations");
    expect(out).toEqual(orgs);
    expect(out[0].userCount).toBe(4); // per-item fields preserved
    expect(res.total).toBe(2);
  });

  it("organizations: future `{ items }` form", () => {
    expect(unwrapList({ items: [{ id: 5 }] }, "organizations")).toEqual([{ id: 5 }]);
  });

  it("organizations: empty list is valid", () => {
    expect(unwrapList({ organizations: [] }, "organizations")).toEqual([]);
  });

  // ── Cross-domain invariant ─────────────────────────────────────────────────
  it("undefined (loading) → [] for both keys (initial-state safe)", () => {
    expect(unwrapList(undefined, "projects")).toEqual([]);
    expect(unwrapList(undefined, "organizations")).toEqual([]);
  });
});
