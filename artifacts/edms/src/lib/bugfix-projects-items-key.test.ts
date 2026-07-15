/**
 * bugfix-projects-items-key.test.ts
 *
 * Bug: action-items.tsx and reports-dashboard.tsx fetched GET /api/projects —
 * whose contract returns `{ projects, total }` — but read `projectsData?.items`.
 * Since `.items` is absent on that shape, both consumers ALWAYS got an empty
 * projects list.
 *
 * RED  : the OLD read (`data?.items ?? []`) returns [] for the real backend shape.
 * GREEN: the fixed read (`unwrapList(data, "projects")`) returns the projects,
 *        and also reads the future `{ items }` shape.
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

// The exact expression both consumers used BEFORE the fix.
const oldRead = (data: unknown): unknown[] => (data as { items?: unknown[] })?.items ?? [];

describe("bugfix: /api/projects consumers read `.items` instead of `.projects`", () => {
  const backendShape = { projects: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }], total: 2 };

  it("RED: the old `data?.items ?? []` read yields an EMPTY list for `{ projects, total }`", () => {
    expect(oldRead(backendShape)).toEqual([]); // the bug: always empty
  });

  it("GREEN: `unwrapList(data, \"projects\")` returns the real projects, order preserved", () => {
    const out = unwrapList<{ id: number }>(backendShape, "projects");
    expect(out).toEqual(backendShape.projects);
    expect(out.map(p => p.id)).toEqual([1, 2]); // content + order stable
    expect(backendShape.total).toBe(2);         // extra field untouched
  });

  it("also reads the future `{ items }` shape", () => {
    expect(unwrapList<{ id: number }>({ items: [{ id: 9 }] }, "projects")).toEqual([{ id: 9 }]);
  });

  it("empty projects list stays a valid empty result (not an error)", () => {
    expect(unwrapList({ projects: [], total: 0 }, "projects")).toEqual([]);
  });
});
