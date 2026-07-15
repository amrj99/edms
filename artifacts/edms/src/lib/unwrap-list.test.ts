import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

describe("unwrapList — C-7 list contract", () => {
  it("returns the new `items` array", () => {
    const r = unwrapList<number>({ items: [1, 2, 3], total: 3 }, "documents");
    expect(r).toEqual([1, 2, 3]);
  });

  it("returns the legacy key array when `items` is absent", () => {
    const r = unwrapList<number>({ documents: [4, 5], total: 2 }, "documents");
    expect(r).toEqual([4, 5]);
  });

  it("prefers `items` when BOTH `items` and the legacy key are present", () => {
    const r = unwrapList<string>({ items: ["new"], documents: ["old"] }, "documents");
    expect(r).toEqual(["new"]);
  });

  it("preserves element content AND order (no reordering)", () => {
    const src = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const r = unwrapList<{ id: number }>({ items: src }, "documents");
    expect(r).toEqual([{ id: 3 }, { id: 1 }, { id: 2 }]);
    expect(r).toBe(src); // same reference — no copy, no second pass
  });

  it("treats an EMPTY array as a valid result (not absence)", () => {
    expect(unwrapList({ items: [] }, "documents")).toEqual([]);
    expect(unwrapList({ documents: [] }, "documents")).toEqual([]);
  });

  it("returns [] for `undefined` (React Query initial/loading state only)", () => {
    expect(unwrapList(undefined, "documents")).toEqual([]);
  });

  it("THROWS on `null` (contract error — not an empty list)", () => {
    expect(() => unwrapList(null, "documents")).toThrow(/expected .*"items".*legacy key "documents"/);
  });

  it("THROWS on a non-object response", () => {
    expect(() => unwrapList(42, "documents")).toThrow(/received number/);
    expect(() => unwrapList("nope", "documents")).toThrow(/received string/);
  });

  it("THROWS when `items` is present but NOT an array (no silent fallback to legacy)", () => {
    expect(() => unwrapList({ items: "x", documents: [1] }, "documents")).toThrow(
      /"items" is present but is not an array/,
    );
    expect(() => unwrapList({ items: {}, documents: [1] }, "documents")).toThrow(
      /is not an array/,
    );
  });

  it("THROWS when neither `items` nor the legacy key is a valid array", () => {
    expect(() => unwrapList({ foo: 1, bar: 2 }, "documents")).toThrow(
      /expected "items" or legacy key "documents" to be an array/,
    );
  });

  it("error message names the legacyKey + present keys, but NEVER leaks body values", () => {
    let msg = "";
    try {
      unwrapList({ secretField: "TOP_SECRET_VALUE", count: 7 }, "users");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('legacy key "users"');
    expect(msg).toContain("secretField"); // key name is fine (diagnostic)
    expect(msg).not.toContain("TOP_SECRET_VALUE"); // value must NOT leak
    expect(msg).not.toContain("7");
  });

  it("a composite response (no items, wrong legacyKey) fails — proving call sites must not pass composites", () => {
    // GET /api/search returns {documents, correspondence, meetings, projects};
    // asking for legacyKey 'users' (absent) must THROW, not silently return [].
    const searchComposite = { documents: [1], correspondence: [2], meetings: [], projects: [3] };
    expect(() => unwrapList(searchComposite, "users")).toThrow(/to be an array/);
  });
});
