/**
 * bugfix-projects-list-stale-memo.test.ts
 *
 * Empirical root-cause proof for the production regression: /projects renders
 * "No projects found" even though GET /api/projects returns { items:[project] }.
 *
 * pages/projects.tsx:135-139 computes
 *   const projects = unwrapList(data, "projects");   // body reads data.items ?? data.projects
 *   ...
 *   }, [data?.projects, orgFilter]);                 // dep array references the LEGACY key
 *
 * After the C-7 backend flip the response has NO `.projects` key, so
 * `data?.projects` is permanently `undefined`. React only recomputes a useMemo
 * when a dependency changes (Object.is over the dep array). Across the
 * undefined → { items } transition the buggy dep stays `undefined` → the memo is
 * NEVER recomputed → the first-render value `[]` sticks → empty list.
 *
 * This test reproduces React's exact dependency rule (Object.is) with the REAL
 * `unwrapList`, and shows the bug flips with the one-line dependency fix.
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

/** Faithful model of React's useMemo: recompute iff any dep differs by Object.is. */
function makeMemo() {
  let prevDeps: any[] | null = null;
  let cached: any;
  return (factory: () => any, deps: any[]) => {
    const changed =
      !prevDeps ||
      deps.length !== prevDeps.length ||
      deps.some((d, i) => !Object.is(d, prevDeps![i]));
    if (changed) {
      cached = factory();
      prevDeps = deps;
    }
    return cached;
  };
}

const PROJECT = { id: 1, name: "test", organizationId: 1 };

// The exact memo body from pages/projects.tsx (unwrapList + orgFilter filter).
const computeFiltered = (data: any, orgFilter: string) => {
  const projects = unwrapList<any>(data, "projects");
  if (orgFilter === "_all") return projects;
  return projects.filter((p: any) => String(p.organizationId) === orgFilter);
};

describe("projects list — stale useMemo dependency (production bug)", () => {
  it("the API payload really does contain the project (data.items)", () => {
    const loaded = { items: [PROJECT] };
    expect(loaded.items).toHaveLength(1);
    // unwrapList prefers `items` → the body would compute the project correctly.
    expect(unwrapList<any>(loaded, "projects")).toHaveLength(1);
  });

  it("BUGGY dep [data?.projects, orgFilter] → filteredProjects stays EMPTY after load", () => {
    const memo = makeMemo();
    const orgFilter = "_all";

    let data: any = undefined; // render 1: query not resolved yet
    let result = memo(() => computeFiltered(data, orgFilter), [data?.projects, orgFilter]);
    expect(result).toEqual([]); // correct on first render

    data = { items: [PROJECT] }; // render 2: query resolved to the new envelope
    result = memo(() => computeFiltered(data, orgFilter), [data?.projects, orgFilter]);
    // deps went [undefined, "_all"] → [undefined, "_all"] : UNCHANGED → memo not recomputed
    expect(result).toEqual([]); // 🔴 BUG: empty although data.items has the project
  });

  it("FIXED dep [data, orgFilter] → project appears immediately after load", () => {
    const memo = makeMemo();
    const orgFilter = "_all";

    let data: any = undefined;
    let result = memo(() => computeFiltered(data, orgFilter), [data, orgFilter]);
    expect(result).toEqual([]);

    data = { items: [PROJECT] };
    result = memo(() => computeFiltered(data, orgFilter), [data, orgFilter]);
    // deps went [undefined, …] → [object, …] : CHANGED → memo recomputed
    expect(result).toHaveLength(1); // ✅ FIX: project shows
    expect(result[0].id).toBe(1);
  });
});
