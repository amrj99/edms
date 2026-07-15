/**
 * c7-2b-consumer-contract.test.ts — C7-2b Consumer Contract Tests.
 *
 * NOT rendering tests. They assert that `unwrapList` — the primitive the C7-2b
 * consumers (Users) now call — returns the SAME items in the SAME order for the
 * ACTUAL shapes both user endpoints produce:
 *   • GET /api/users       → { users, total }
 *   • GET /api/chat/users  → { users }        (no `total`)
 * plus the future `{ items }` form, an empty list, `items` priority, and that
 * the `total` present on /api/users is neither consumed by the helper nor
 * mutated.
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

describe("C7-2b consumer contracts — Users", () => {
  it("/api/users `{ users, total }` → same items/order; total untouched & unused", () => {
    const users = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const res = { users, total: 3 };
    const out = unwrapList<{ id: number }>(res, "users");
    expect(out).toEqual(users);
    expect(out.map(u => u.id)).toEqual([3, 1, 2]); // order preserved
    expect(res.total).toBe(3);                     // present, untouched
    // the helper returns ONLY the array — `total` is not folded into the result
    expect((out as unknown as { total?: number }).total).toBeUndefined();
  });

  it("/api/chat/users `{ users }` (NO total) → same items, result unaffected by missing total", () => {
    const users = [{ id: 10, name: "A" }, { id: 11, name: "B" }];
    const out = unwrapList<{ id: number }>({ users }, "users");
    expect(out).toEqual(users);
    expect(out.map(u => u.id)).toEqual([10, 11]);
  });

  it("future `{ items }` form is read and WINS over legacy `users` when both present", () => {
    expect(unwrapList<{ id: number }>({ items: [{ id: 9 }], users: [{ id: 1 }] }, "users"))
      .toEqual([{ id: 9 }]);
  });

  it("empty list is valid for both endpoints", () => {
    expect(unwrapList({ users: [], total: 0 }, "users")).toEqual([]); // /api/users
    expect(unwrapList({ users: [] }, "users")).toEqual([]);           // /api/chat/users
  });

  it("undefined (loading) → [] (initial-state safe)", () => {
    expect(unwrapList(undefined, "users")).toEqual([]);
  });
});
