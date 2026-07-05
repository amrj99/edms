/**
 * Party Model Ceiling — Phase 5 Minimum, extended in Phase 6B
 *
 * PARTY_CEILING_V1 defines the maximum permissions for each party role.
 * Ceilings are static and role-level (not per-user, not per-resource).
 *
 * Versioning: if the ceiling philosophy changes in a future phase (e.g. APF
 * introduces negotiated ceilings), define PARTY_CEILING_V2 alongside this
 * constant. Routes will reference whichever version applies to their context.
 *
 * Keys: only actions that are ceiling-controlled need an entry.
 * Default for unlisted actions: allowed (subject to normal intra-org rules).
 *
 * Phase 6B additions:
 *   read_transmittal      — observer gets read-only transmittal visibility;
 *                           this is consistent with read_document access and
 *                           allows observers to understand why a document
 *                           arrived (the transmittal is its delivery context).
 *   acknowledge_transmittal — contributor only; also requires Gate 3 (recipient
 *                             org check via recipientOrganizationId) in the route.
 */

import type { PartyRole } from "@workspace/db";

/** Actions that are ceiling-controlled for party members. */
export type PartyAction =
  | "upload_document"        // POST /projects/:id/documents
  | "create_transmittal"     // POST /projects/:id/transmittals
  | "read_transmittal"       // GET  /projects/:id/transmittals[/:id]
  | "acknowledge_transmittal"// POST /projects/:id/transmittals/:id/acknowledge
  | "read_correspondence"    // GET  /projects/:id/correspondence
  | "create_correspondence"  // POST /projects/:id/correspondence
  | "submit_review";         // POST /projects/:id/documents/:id/submit-review

type CeilingMap = Record<PartyRole, Record<PartyAction, boolean>>;

export const PARTY_CEILING_V1 = {
  observer: {
    upload_document:         false,
    create_transmittal:      false,
    read_transmittal:        true,  // Phase 6B: read-only transmittal visibility
    acknowledge_transmittal: false,
    read_correspondence:     false,
    create_correspondence:   false,
    submit_review:           false,
  },
  contributor: {
    upload_document:         true,
    create_transmittal:      true,
    read_transmittal:        true,  // Phase 6B
    acknowledge_transmittal: true,  // Phase 6B: recipient org only (Gate 3 in route)
    read_correspondence:     false,
    create_correspondence:   false,
    submit_review:           false,
  },
} as const satisfies CeilingMap;

/**
 * Returns true if the given party role is permitted to perform the action.
 * Use this in route handlers to enforce party ceiling after canAccessProject()
 * has confirmed party access (mode === 'party').
 */
export function isWithinPartyCeiling(partyRole: PartyRole, action: PartyAction): boolean {
  return PARTY_CEILING_V1[partyRole][action];
}
