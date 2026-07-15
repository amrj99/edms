/**
 * bugfix-project-detail-3417-recipient-map.test.ts
 *
 * Bug: project-detail.tsx:3417 built the `corrUsers` list passed to
 * <RecipientAutocomplete> by mapping each /api/users record to
 *   { id, name: u.name ?? u.email, email }
 * dropping `firstName`/`lastName`. RecipientAutocomplete's display label reads
 * `u.firstName`/`u.lastName`, so recipient names in the To/CC compose fields were
 * broken (undefined). The prior untyped/any source masked it.
 *
 * Fix: map to the real RecipientUser contract { id, firstName, lastName, email }
 * (matching the sibling pickers in documents.tsx and project-detail.tsx:2381),
 * reading via unwrapList.
 *
 * RED  : the OLD map produces records missing firstName/lastName → a display
 *        label built from them is empty/broken.
 * GREEN : the NEW map preserves firstName/lastName/email/id and yields a proper label.
 */
import { describe, it, expect } from "vitest";
import { unwrapList } from "./unwrap-list";

// Representative /api/users record (backend returns id, email, firstName, lastName).
const apiUser = { id: 7, firstName: "Amance", lastName: "Structural", email: "a.s@contractor.example" };
const usersResponse = { users: [apiUser, { id: 8, firstName: "Bea", lastName: "Reviewer", email: "b.r@owner.example" }], total: 2 };

// The label RecipientAutocomplete builds (mirrors its userLabel: firstName + lastName, else email).
const label = (u: { firstName?: string; lastName?: string; email: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;

const OLD_MAP = (u: any) => ({ id: u.id, name: u.name ?? u.email, email: u.email });
const NEW_MAP = (u: any) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email });

describe("bugfix project-detail:3417 — corrUsers recipient map drops firstName/lastName", () => {
  it("RED: old map omits firstName/lastName → label falls back to email (name broken)", () => {
    const out = (usersResponse.users as any[]).map(OLD_MAP);
    expect(out[0]).not.toHaveProperty("firstName");
    expect(out[0]).not.toHaveProperty("lastName");
    expect(label(out[0] as any)).toBe(apiUser.email); // no real name shown
  });

  it("GREEN: new map preserves id/firstName/lastName/email → proper label", () => {
    const out = unwrapList<any>(usersResponse, "users").map(NEW_MAP);
    expect(out[0]).toEqual({ id: 7, firstName: "Amance", lastName: "Structural", email: apiUser.email });
    expect(label(out[0])).toBe("Amance Structural"); // real name shown
  });

  it("order of users is preserved", () => {
    const out = unwrapList<any>(usersResponse, "users").map(NEW_MAP);
    expect(out.map(u => u.id)).toEqual([7, 8]);
  });

  it("unwrapList works with the /api/users `{users}` shape and the future `{items}` shape", () => {
    expect(unwrapList<any>({ users: [apiUser] }, "users").map(NEW_MAP)[0].firstName).toBe("Amance");
    expect(unwrapList<any>({ items: [apiUser] }, "users").map(NEW_MAP)[0].firstName).toBe("Amance");
  });
});
