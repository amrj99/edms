/**
 * Frontend mirror of the backend PARTY_CEILING_V1
 * (artifacts/api-server/src/lib/party-ceiling.ts — Phase 5, extended Phase 6B).
 *
 * Used only to show/hide UI actions for party members (Phase 6C).
 * The backend remains the sole enforcer — nothing here grants access.
 * Keep in sync with the backend constant whenever the ceiling changes.
 */

export type PartyRole = "observer" | "contributor";

export type PartyAction =
  | "upload_document"
  | "create_transmittal"
  | "read_transmittal"
  | "acknowledge_transmittal";

const PARTY_CEILING_MIRROR: Record<PartyRole, Record<PartyAction, boolean>> = {
  observer: {
    upload_document:         false,
    create_transmittal:      false,
    read_transmittal:        true,
    acknowledge_transmittal: false,
  },
  contributor: {
    upload_document:         true,
    create_transmittal:      true,
    read_transmittal:        true,
    acknowledge_transmittal: true,
  },
};

export function partyAllows(role: PartyRole, action: PartyAction): boolean {
  return PARTY_CEILING_MIRROR[role]?.[action] ?? false;
}
