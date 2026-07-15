/**
 * c7-3-consumer-contract.test.ts — C7-3 Consumer Contract Tests.
 *
 * NOT rendering tests. They assert that `unwrapList` — the primitive the C7-3
 * consumers (Tasks / Workflow instances / Meetings / Action items / Notifications)
 * now call — returns the SAME items in the SAME order for the ACTUAL shapes those
 * endpoints produce, plus the future `{ items }` form, an empty list, and that
 * domain-specific sibling fields (notifications' `unreadCount`) are neither
 * consumed nor mutated by the helper.
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

describe("C7-3 consumer contracts — Tasks / Workflow / Meetings / ActionItems / Notifications", () => {
  it("tasks: `{ tasks, total }` → same items/order; total untouched", () => {
    const tasks = [{ id: 3 }, { id: 1 }, { id: 2 }];
    const res = { tasks, total: 3 };
    const out = unwrapList<{ id: number }>(res, "tasks");
    expect(out).toEqual(tasks);
    expect(out.map(t => t.id)).toEqual([3, 1, 2]);
    expect(res.total).toBe(3);
  });

  it("workflow instances: `{ instances, total }` → same items/order", () => {
    const instances = [{ id: 5, status: "active" }, { id: 6, status: "done" }];
    const out = unwrapList<{ id: number }>({ instances, total: 2 }, "instances");
    expect(out).toEqual(instances);
    expect(out.map(i => i.id)).toEqual([5, 6]);
  });

  it("meetings: `{ meetings }` (no total) → same items", () => {
    const meetings = [{ id: 1, title: "Kickoff" }, { id: 2, title: "Review" }];
    expect(unwrapList<{ id: number }>({ meetings }, "meetings")).toEqual(meetings);
  });

  it("action items: `{ actionItems }` → same items/order", () => {
    const actionItems = [{ id: 9 }, { id: 8 }];
    const out = unwrapList<{ id: number }>({ actionItems }, "actionItems");
    expect(out).toEqual(actionItems);
    expect(out.map(a => a.id)).toEqual([9, 8]);
  });

  it("notifications: `{ notifications, unreadCount }` → returns list; unreadCount untouched & unused", () => {
    const notifications = [{ id: 1, read: false }, { id: 2, read: true }];
    const res = { notifications, unreadCount: 1 };
    const out = unwrapList<{ id: number }>(res, "notifications");
    expect(out).toEqual(notifications);
    expect(res.unreadCount).toBe(1); // sibling metric untouched
    expect((out as unknown as { unreadCount?: number }).unreadCount).toBeUndefined(); // not folded in
  });

  it("future `{ items }` form is read and WINS over legacy key when both present", () => {
    for (const key of ["tasks", "instances", "meetings", "actionItems", "notifications"]) {
      expect(unwrapList<{ id: number }>({ items: [{ id: 9 }], [key]: [{ id: 1 }] } as any, key))
        .toEqual([{ id: 9 }]);
    }
  });

  it("empty list is valid; undefined (loading) → [] for every key", () => {
    for (const key of ["tasks", "instances", "meetings", "actionItems", "notifications"]) {
      expect(unwrapList({ [key]: [] } as any, key)).toEqual([]);
      expect(unwrapList(undefined, key)).toEqual([]);
    }
  });
});
