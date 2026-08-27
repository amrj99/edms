/**
 * classification-background.test.ts — DEBT-010 (AI classification background boundary).
 *
 * Proves dispatchClassificationBackground does NOT inherit the HTTP request's ALS
 * (request marker + tenant tx both cleared), and that firing it from inside a
 * request scope does not throw fail-closed (it detaches to the background path).
 */
import { describe, it, expect } from "vitest";
import { requestContext, dbContext } from "@workspace/db";
import { __test, dispatchClassificationBackground } from "../lib/ai/classification-events.js";

describe("DEBT-010 — dispatchClassificationBackground (detached AI boundary)", () => {
  it("runs detached: request marker AND tenant tx are both cleared inside", () => {
    let seen: { req: unknown; db: unknown } | undefined;
    requestContext.run({ userId: 3, orgId: 222, isSystemOwner: false }, () => {
      dbContext.run({ tx: {} as never, orgId: 222, isSystemOwner: false, userId: 7 }, () => {
        expect(requestContext.getStore()).toBeDefined();
        expect(dbContext.getStore()).toBeDefined();
        __test.runDetachedFromRequest(() => {
          seen = { req: requestContext.getStore(), db: dbContext.getStore() };
        });
      });
    });
    expect(seen?.req).toBeUndefined();
    expect(seen?.db).toBeUndefined();
  });

  it("firing from inside a request scope does not throw fail-closed (detaches to background)", async () => {
    expect(() =>
      requestContext.run({ userId: 3, orgId: 222, isSystemOwner: false }, () => {
        dispatchClassificationBackground(
          { organizationId: 222, userId: 3, itemType: "correspondence", itemId: 1 },
          { subject: "Test subject", body: "Test body" },
        );
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 60));
  });
});
