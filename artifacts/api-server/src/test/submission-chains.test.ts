/**
 * submission-chains.test.ts
 *
 * Phase 3 — Submittal Lifecycle
 *
 * Coverage:
 *   - Create chain with/without explicit type
 *   - setup-parties: happy path, validation (foreign project, unassigned strategy, missing stepOrder 1)
 *   - forward: happy path, sequence enforcement, custodian-only access
 *   - review: sets reviewCode without moving the chain, custodian-only access
 *   - return: changes status to 'returned', rejects code A, rejects from stepOrder=1
 *   - resubmit: increments revisionCycle, status → 'active', rejects non-originator
 *   - GET / with status filter
 *
 * Test topology:
 *   orgA (Contractor) ← organisationId of contractorAdmin
 *     entityA linked to orgA (organisations.entity_id)
 *     participantContractor: entityA, role='main_contractor', project=testProject
 *
 *   orgB (Consultant) ← organisationId of consultantAdmin
 *     entityB linked to orgB
 *     participantConsultant: entityB, role='consultant', project=testProject
 *
 *   Setup parties: [contractor=step1, consultant=step2]
 *   Full flow:  contractor → forward → consultant → review → return → contractor → resubmit
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  api,
  authHeader,
  createOrg,
  createUser,
  createProject,
  getTestDb,
  truncateAllTables,
} from "./helpers/index.js";
import {
  orgConfigTable,
  organizationsTable,
  entitiesTable,
  projectParticipantsTable,
  projectMembersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const db = getTestDb();

describe("submission chains API — Phase 3", () => {
  let orgA: { id: number };
  let orgB: { id: number };

  // Inferred from createUser return type (organizationId: number | null in schema)
  let contractorAdmin: Awaited<ReturnType<typeof createUser>>;
  let consultantAdmin:  Awaited<ReturnType<typeof createUser>>;

  let projectId: number;
  let entityAId: number;
  let entityBId: number;
  let participantContractorId: number;
  let participantConsultantId: number;

  // IDs created during tests (shared across describe blocks via closure)
  let chainId: number;

  beforeAll(async () => {
    await truncateAllTables();

    // ── Orgs ────────────────────────────────────────────────────────────────────
    orgA = await createOrg({ name: "SC Contractor Org", code: "SCCOA" });
    orgB = await createOrg({ name: "SC Consultant Org", code: "SCCOB" });

    // ── Enable registers module for both orgs ────────────────────────────────────
    await db.insert(orgConfigTable).values([
      { organizationId: orgA.id, modules: { registers: true, dashboard: true, notifications: true } },
      { organizationId: orgB.id, modules: { registers: true, dashboard: true, notifications: true } },
    ]);

    // ── Users ────────────────────────────────────────────────────────────────────
    contractorAdmin = await createUser({
      organizationId: orgA.id,
      role: "admin",
      email: "sc-contractor@test.edms",
    });
    consultantAdmin = await createUser({
      organizationId: orgB.id,
      role: "admin",
      email: "sc-consultant@test.edms",
    });

    // ── Entities (linked to orgs via organisations.entity_id) ───────────────────
    const [eA] = await db
      .insert(entitiesTable)
      .values({ name: "Contractor Co.", type: "company", organizationId: orgA.id })
      .returning();
    entityAId = eA.id;

    const [eB] = await db
      .insert(entitiesTable)
      .values({ name: "Consultant Ltd.", type: "company", organizationId: orgB.id })
      .returning();
    entityBId = eB.id;

    // Link entity to org so resolveCallerParticipant can find the participant
    await db
      .update(organizationsTable)
      .set({ entityId: entityAId })
      .where(eq(organizationsTable.id, orgA.id));

    await db
      .update(organizationsTable)
      .set({ entityId: entityBId })
      .where(eq(organizationsTable.id, orgB.id));

    // ── Project ──────────────────────────────────────────────────────────────────
    const project = await createProject({ organizationId: orgA.id, name: "SC Test Project", code: "SCTP" });
    projectId = project.id;

    // Both users are project members
    await db.insert(projectMembersTable).values([
      { projectId, userId: contractorAdmin.id, role: "admin" },
      { projectId, userId: consultantAdmin.id, role: "admin" },
    ]);

    // ── Participants ─────────────────────────────────────────────────────────────
    const [pC] = await db
      .insert(projectParticipantsTable)
      .values({ projectId, entityId: entityAId, role: "main_contractor" })
      .returning();
    participantContractorId = pC.id;

    const [pQ] = await db
      .insert(projectParticipantsTable)
      .values({ projectId, entityId: entityBId, role: "consultant" })
      .returning();
    participantConsultantId = pQ.id;
  });

  afterAll(async () => {
    await truncateAllTables();
  });

  // ─── Create ──────────────────────────────────────────────────────────────────

  describe("POST /api/projects/:id/submission-chains", () => {
    it("creates chain with default type 'submittal'", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Shop Drawings — Structure" });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("submittal");
      expect(res.body.title).toBe("Shop Drawings — Structure");
      expect(res.body.currentStatus).toBe("active");
      expect(res.body.activeRevisionCycle).toBe(1);
      chainId = res.body.id;
    });

    it("creates chain with explicit type", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "RFI-001 Beam Connection", type: "rfi" });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe("rfi");
    });

    it("rejects unknown type", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Bad Type Chain", type: "letter" });

      expect(res.status).toBe(400);
    });
  });

  // ─── Setup parties ────────────────────────────────────────────────────────────

  describe("POST /:id/setup-parties", () => {
    it("sets up parties and assigns currentParticipantId to stepOrder=1", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            {
              participantId: participantContractorId,
              stepOrder: 1,
              label: "Main Contractor",
              assignmentStrategy: "role_based",
            },
            {
              participantId: participantConsultantId,
              stepOrder: 2,
              label: "Consultant",
              assignmentStrategy: "role_based",
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.parties).toHaveLength(2);
      expect(res.body.chain.currentParticipantId).toBe(participantContractorId);
      expect(res.body.parties[0].stepOrder).toBe(1);
      expect(res.body.parties[1].stepOrder).toBe(2);
    });

    it("rejects participantId from a different project", async () => {
      // Create a second project and participant in it
      const otherProject = await createProject({ organizationId: orgA.id, code: "SCTP2" });
      const [otherPP] = await db
        .insert(projectParticipantsTable)
        .values({ projectId: otherProject.id, entityId: entityAId, role: "consultant" })
        .returning();

      // Create a fresh chain for this test to avoid CHAIN_IN_MOTION
      const chainRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Cross-project guard test" });

      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainRes.body.id}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: otherPP.id, stepOrder: 1, assignmentStrategy: "role_based" },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not belong to project/);
    });

    it("rejects assignmentStrategy 'unassigned'", async () => {
      const chainRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Unassigned strategy test" });

      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainRes.body.id}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            {
              participantId: participantContractorId,
              stepOrder: 1,
              assignmentStrategy: "unassigned",
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("UNASSIGNED_NOT_SUPPORTED");
    });

    it("rejects when stepOrder 1 is missing", async () => {
      const chainRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "No stepOrder1 test" });

      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainRes.body.id}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            {
              participantId: participantConsultantId,
              stepOrder: 2,
              assignmentStrategy: "role_based",
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/stepOrder 1/);
    });

    it("rejects modification after chain has steps", async () => {
      // Forward the chain first to make it "in motion"
      await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/forward`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ toParticipantId: participantConsultantId });

      // Now try setup-parties on the same chain
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: participantContractorId, stepOrder: 1, assignmentStrategy: "role_based" },
            { participantId: participantConsultantId, stepOrder: 2, assignmentStrategy: "role_based" },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CHAIN_IN_MOTION");
    });
  });

  // ─── Forward ─────────────────────────────────────────────────────────────────
  // Note: chainId is already forwarded to consultant from the test above.

  describe("POST /:id/forward", () => {
    it("accepts toParticipantId and updates currentParticipantId", async () => {
      // Verify state from previous forward
      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${chainId}`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));

      expect(detail.body.chain?.currentParticipantId ?? detail.body.currentParticipantId)
        .toBe(participantConsultantId);
      expect(detail.body.steps).toHaveLength(1);
      expect(detail.body.steps[0].toParticipantId).toBe(participantConsultantId);
      expect(detail.body.steps[0].action).toBe("forward");
    });

    it("updates currentStepStartedAt on forward", async () => {
      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${chainId}`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id));

      expect(detail.status).toBe(200);
      const chain = detail.body.currentParticipantId !== undefined ? detail.body : detail.body.chain;
      expect(chain?.currentStepStartedAt ?? detail.body.currentStepStartedAt).toBeTruthy();
    });

    it("rejects forward from non-current-custodian", async () => {
      // contractor tries to forward even though consultant is the custodian
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/forward`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ toParticipantId: participantContractorId });

      expect(res.status).toBe(403);
    });

    it("rejects out-of-sequence toParticipantId", async () => {
      // consultant is at stepOrder=2 — trying to forward back to stepOrder=1 violates sequence
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/forward`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ toParticipantId: participantContractorId });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("SEQUENCE_VIOLATION");
    });
  });

  // ─── Review ──────────────────────────────────────────────────────────────────

  describe("POST /:id/review", () => {
    it("records reviewCode without moving the chain", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/review`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ reviewCode: "B", comments: "Revise per structural comments" });

      expect(res.status).toBe(200);
      expect(res.body.step.reviewCode).toBe("B");
      expect(res.body.step.comments).toBe("Revise per structural comments");
      expect(res.body.step.reviewedById).toBe(consultantAdmin.id);

      // Chain must still be at consultantId (not moved)
      const chainDetail = res.body.chain;
      expect(chainDetail.currentParticipantId).toBe(participantConsultantId);
      expect(chainDetail.currentStatus).toBe("active");
    });

    it("rejects invalid reviewCode", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/review`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ reviewCode: "X" });

      expect(res.status).toBe(400);
    });

    it("rejects review from non-current-custodian", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/review`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ reviewCode: "A" });

      expect(res.status).toBe(403);
    });
  });

  // ─── Return ───────────────────────────────────────────────────────────────────

  describe("POST /:id/return", () => {
    it("rejects reviewCode 'A' on return", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/return`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ reviewCode: "A", comments: "Approved" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_REVIEW_CODE");
    });

    it("rejects return from non-current-custodian", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/return`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ reviewCode: "B", comments: "Must revise" });

      expect(res.status).toBe(403);
    });

    it("returns chain to previous party, status becomes 'returned'", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/return`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ reviewCode: "C", comments: "Revise and resubmit with corrections" });

      expect(res.status).toBe(200);
      expect(res.body.chain.currentStatus).toBe("returned");
      expect(res.body.chain.currentParticipantId).toBe(participantContractorId);
      expect(res.body.step.action).toBe("return");
      expect(res.body.step.reviewCode).toBe("C");
      expect(res.body.step.fromParticipantId).toBe(participantConsultantId);
      expect(res.body.step.toParticipantId).toBe(participantContractorId);
    });

    it("rejects return from stepOrder=1 (originator cannot return)", async () => {
      // Need a separate chain where contractor is current custodian and at stepOrder=1
      const newChainRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Return from step1 guard test" });
      const newChainId = newChainRes.body.id;

      await api()
        .post(`/api/projects/${projectId}/submission-chains/${newChainId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: participantContractorId, stepOrder: 1, assignmentStrategy: "role_based" },
            { participantId: participantConsultantId, stepOrder: 2, assignmentStrategy: "role_based" },
          ],
        });

      // Contractor is at stepOrder=1 — return should be rejected
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${newChainId}/return`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ reviewCode: "B", comments: "Should not work" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("CANNOT_RETURN_FROM_ORIGINATOR");
    });
  });

  // ─── Resubmit ────────────────────────────────────────────────────────────────

  describe("POST /:id/resubmit", () => {
    it("rejects resubmit from non-originator", async () => {
      // consultantAdmin is not the originator (stepOrder=1)
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/resubmit`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("rejects resubmit when status is not 'returned'", async () => {
      // Create a fresh active chain (status = 'active', not 'returned')
      const freshRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Resubmit on active chain test" });
      const freshId = freshRes.body.id;

      await api()
        .post(`/api/projects/${projectId}/submission-chains/${freshId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: participantContractorId, stepOrder: 1, assignmentStrategy: "role_based" },
            { participantId: participantConsultantId, stepOrder: 2, assignmentStrategy: "role_based" },
          ],
        });

      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${freshId}/resubmit`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("CHAIN_NOT_RETURNED");
    });

    it("increments revisionCycle and sets status to 'active'", async () => {
      // chainId is currently 'returned' at contractorAdmin
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${chainId}/resubmit`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.chain.activeRevisionCycle).toBe(2);
      expect(res.body.chain.currentStatus).toBe("active");
      expect(res.body.chain.currentParticipantId).toBe(participantConsultantId);
      expect(res.body.step.action).toBe("forward");
      expect(res.body.step.revisionCycle).toBe(2);
    });
  });

  // ─── GET /:id — actions field ─────────────────────────────────────────────────
  // Verifies that the backend correctly computes which actions are available to
  // the current caller based on chain state + party sequence (not org guessing).

  describe("GET /:id — actions field", () => {
    let actionsChainId: number;

    it("fresh chain (no parties, no steps): originator sees canSetupParties=true", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "Actions test chain" });
      actionsChainId = res.body.id;

      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));

      expect(detail.status).toBe(200);
      expect(detail.body.actions.canSetupParties).toBe(true);
      expect(detail.body.actions.canReview).toBe(false);
      expect(detail.body.actions.canForward).toBe(false);
      expect(detail.body.actions.canReturn).toBe(false);
      expect(detail.body.actions.canResubmit).toBe(false);
    });

    it("fresh chain: non-originator org gets 403 (no access before parties are configured)", async () => {
      // orgB has no claim on this chain yet: it's not the originator, not the
      // current org, and has no steps. 403 is correct — this also proves that
      // canSetupParties is only computable by the originating org.
      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id));

      expect(detail.status).toBe(403);
    });

    it("after setup-parties: originator (stepOrder=1) is custodian → canForward+canReview=true, canReturn=false", async () => {
      await api()
        .post(`/api/projects/${projectId}/submission-chains/${actionsChainId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: participantContractorId, stepOrder: 1, assignmentStrategy: "role_based" },
            { participantId: participantConsultantId, stepOrder: 2, assignmentStrategy: "role_based" },
          ],
        });

      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));

      expect(detail.status).toBe(200);
      expect(detail.body.actions.canSetupParties).toBe(false);
      expect(detail.body.actions.canForward).toBe(true);
      expect(detail.body.actions.canReview).toBe(true);
      expect(detail.body.actions.canReturn).toBe(false); // originator cannot return
      expect(detail.body.actions.canResubmit).toBe(false);
    });

    it("after setup-parties: non-custodian sees canForward=false, canReview=false", async () => {
      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id));

      expect(detail.status).toBe(200);
      expect(detail.body.actions.canForward).toBe(false);
      expect(detail.body.actions.canReview).toBe(false);
      expect(detail.body.actions.canReturn).toBe(false);
      expect(detail.body.actions.canResubmit).toBe(false);
    });

    it("after forward to consultant: consultant is custodian → canReturn=true, canReview=true", async () => {
      await api()
        .post(`/api/projects/${projectId}/submission-chains/${actionsChainId}/forward`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ toParticipantId: participantConsultantId });

      const detail = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id));

      expect(detail.status).toBe(200);
      expect(detail.body.actions.canForward).toBe(true);
      expect(detail.body.actions.canReview).toBe(true);
      expect(detail.body.actions.canReturn).toBe(true); // non-originator can return
      expect(detail.body.actions.canResubmit).toBe(false);
    });

    it("after return: originator sees canResubmit=true; consultant sees canResubmit=false", async () => {
      await api()
        .post(`/api/projects/${projectId}/submission-chains/${actionsChainId}/return`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id))
        .send({ reviewCode: "C", comments: "Revise structural details" });

      const contractorView = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));
      expect(contractorView.body.actions.canResubmit).toBe(true);
      expect(contractorView.body.actions.canForward).toBe(false);
      expect(contractorView.body.actions.canReturn).toBe(false);

      const consultantView = await api()
        .get(`/api/projects/${projectId}/submission-chains/${actionsChainId}`)
        .set(authHeader("admin", consultantAdmin.id, orgB.id));
      expect(consultantView.body.actions.canResubmit).toBe(false);
    });
  });

  // ─── system_owner bypass ──────────────────────────────────────────────────────

  describe("system_owner bypass — requireMinRole + custodian check", () => {
    let soChainId: number;

    beforeAll(async () => {
      // Contractor creates and sets up a chain, forwards it to consultant.
      // system_owner (no effective org) will then act on the chain.
      const createRes = await api()
        .post(`/api/projects/${projectId}/submission-chains`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ title: "system_owner bypass test chain" });
      soChainId = createRes.body.id;

      await api()
        .post(`/api/projects/${projectId}/submission-chains/${soChainId}/setup-parties`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({
          parties: [
            { participantId: participantContractorId, stepOrder: 1, assignmentStrategy: "role_based" },
            { participantId: participantConsultantId, stepOrder: 2, assignmentStrategy: "role_based" },
          ],
        });

      await api()
        .post(`/api/projects/${projectId}/submission-chains/${soChainId}/forward`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id))
        .send({ toParticipantId: participantConsultantId });
    });

    it("system_owner passes requireMinRole and custodian check on /review (no orgId)", async () => {
      // orgId=0 → falsy → callerParticipant resolves to null inside the handler.
      // Before fix: requireRole blocked with 403.
      // After fix: requireMinRole passes (rank 100) and isSystemOwner bypass skips custodian check.
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${soChainId}/review`)
        .set(authHeader("system_owner", contractorAdmin.id, 0))
        .send({ reviewCode: "B", comments: "system_owner override review" });

      expect(res.status).toBe(200);
      expect(res.body.step.reviewCode).toBe("B");
      expect(res.body.chain.currentParticipantId).toBe(participantConsultantId);
    });

    it("system_owner passes requireMinRole and custodian check on /return (no orgId)", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${soChainId}/return`)
        .set(authHeader("system_owner", contractorAdmin.id, 0))
        .send({ reviewCode: "C", comments: "system_owner override return" });

      expect(res.status).toBe(200);
      expect(res.body.chain.currentStatus).toBe("returned");
      expect(res.body.chain.currentParticipantId).toBe(participantContractorId);
    });

    it("system_owner passes requireMinRole and originator check on /resubmit (no orgId)", async () => {
      const res = await api()
        .post(`/api/projects/${projectId}/submission-chains/${soChainId}/resubmit`)
        .set(authHeader("system_owner", contractorAdmin.id, 0))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.chain.currentStatus).toBe("active");
      expect(res.body.chain.activeRevisionCycle).toBe(2);
    });
  });

  // ─── GET / with filters ───────────────────────────────────────────────────────

  describe("GET /api/projects/:id/submission-chains — filters", () => {
    it("filters by status=returned (returns empty after resubmit moved chain to active)", async () => {
      const res = await api()
        .get(`/api/projects/${projectId}/submission-chains?status=returned`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));

      expect(res.status).toBe(200);
      // chainId is now 'active' (just resubmitted), so it should NOT appear
      const ids = res.body.map((c: { id: number }) => c.id);
      expect(ids).not.toContain(chainId);
    });

    it("filters by type=rfi", async () => {
      const res = await api()
        .get(`/api/projects/${projectId}/submission-chains?type=rfi`)
        .set(authHeader("admin", contractorAdmin.id, orgA.id));

      expect(res.status).toBe(200);
      expect(res.body.every((c: { type: string }) => c.type === "rfi")).toBe(true);
    });
  });
});
