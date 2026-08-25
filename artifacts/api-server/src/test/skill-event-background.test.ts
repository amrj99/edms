/**
 * skill-event-background.test.ts — DEBT-010 decision B (#7).
 *
 * Proves the background skill dispatcher does NOT inherit the HTTP request's
 * AsyncLocalStorage (neither the fail-closed request marker nor an open tenant
 * tx), and that firing it from inside a request scope does not throw fail-closed
 * (i.e. it truly detaches and runs on the background/pool path with explicit ctx).
 */
import { describe, it, expect } from "vitest";
import { requestContext, dbContext } from "@workspace/db";
import { __test, dispatchSkillEventBackground, executeSkillBackground } from "../lib/skill-events.js";

describe("DEBT-010 — dispatchSkillEventBackground (detached background boundary)", () => {
  it("runs detached: inside it, request marker AND tenant tx are both cleared", () => {
    let seen: { req: unknown; db: unknown } | undefined;
    requestContext.run({ userId: 7, orgId: 111, isSystemOwner: false }, () => {
      // Simulate an OPEN tenant tx (dbContext set), as during a request handler.
      dbContext.run({ tx: {} as never, orgId: 111, isSystemOwner: false }, () => {
        expect(requestContext.getStore()).toBeDefined();
        expect(dbContext.getStore()).toBeDefined();
        __test.runDetachedFromRequest(() => {
          seen = { req: requestContext.getStore(), db: dbContext.getStore() };
        });
      });
    });
    expect(seen?.req).toBeUndefined(); // request marker NOT inherited
    expect(seen?.db).toBeUndefined();  // open tenant tx NOT inherited
  });

  it("firing from inside a request scope does not throw fail-closed (detaches to background)", async () => {
    // If it inherited the request marker, triggerSkillEvent's bare db read would
    // fail-closed. Detached, it runs on the background/pool path with explicit org.
    expect(() =>
      requestContext.run({ userId: 7, orgId: 111, isSystemOwner: false }, () => {
        dispatchSkillEventBackground({ organizationId: 111, userId: 7 }, "task_completed", { taskId: 1, projectId: 1 });
      }),
    ).not.toThrow();
    // let the detached fire-and-forget settle
    await new Promise((r) => setTimeout(r, 60));
  });

  it("executeSkillBackground: firing from inside a request scope does not throw fail-closed (detaches)", async () => {
    expect(() =>
      requestContext.run({ userId: 7, orgId: 111, isSystemOwner: false }, () => {
        dbContext.run({ tx: {} as never, orgId: 111, isSystemOwner: false }, () => {
          executeSkillBackground({ organizationId: 111, userId: 7, skillId: 999999 }, { triggeredByType: "manual" });
        });
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 60));
  });
});
