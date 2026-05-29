import { Router } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable,
  usersTable,
  projectsTable,
  projectMembersTable,
  foldersTable,
  documentsTable,
  correspondenceTable,
  correspondenceRecipientsTable,
  correspondenceAttachmentsTable,
  meetingsTable,
  meetingAttendeesTable,
  meetingActionItemsTable,
  ncrRecordsTable,
  inspectionRequestsTable,
  nocRecordsTable,
  transmittalsTable,
  transmittalItemsTable,
  deliverablesTable,
  orgConfigTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { hashPassword, isSysAdmin, requireAuth } from "../lib/auth.js";

const router = Router();

// ── Defense-in-depth production guard ────────────────────────────────────────
// Primary guard: this router is only mounted when NODE_ENV !== "production"
// (see routes/index.ts). This secondary guard is a belt-and-suspenders check
// so that even if the mount guard is accidentally removed or NODE_ENV is wrong,
// no dev/seed endpoint is reachable in production.
router.use((req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not Found" });
    return;
  }
  next();
});

router.use(requireAuth);

const PLACEHOLDER_PDF_SIZE = 512; // bytes (simulated)
const PLACEHOLDER_PDF_KEY = "seed/placeholder-document.pdf";
const PLACEHOLDER_DOC_KEY = "seed/placeholder-drawing.pdf";

async function getPlaceholderUrls() {
  return { pdf: PLACEHOLDER_PDF_KEY, doc: PLACEHOLDER_DOC_KEY };
}

// ─── POST /api/dev/seed-full ───────────────────────────────────────────────────
router.post("/seed-full", async (req, res): Promise<void> => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }

  try {
    // Check if already seeded by looking for our sentinel org
    const sentinel = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.name, "ArcScale Infrastructure Ltd")).limit(1);
    if (sentinel.length > 0 && !req.query.force) {
      res.json({ message: "Already seeded. Use ?force=1 to re-seed.", skipped: true });
      return;
    }

    const { pdf: pdfKey, doc: docKey } = await getPlaceholderUrls();

    // ── 1. Organizations ─────────────────────────────────────────────────────
    const orgData = [
      { name: "ArcScale Infrastructure Ltd", type: "client" as const, contactEmail: "info@arcscale-infra.com", contactPhone: "+1-555-0101", address: "100 Engineering Blvd, Houston TX 77001" },
      { name: "Meridian Engineering Consultants", type: "consultant" as const, contactEmail: "contact@meridian-eng.com", contactPhone: "+1-555-0202", address: "200 Consultant Row, Dallas TX 75001" },
      { name: "BuildPro Contractors Inc.", type: "contractor" as const, contactEmail: "ops@buildpro.com", contactPhone: "+1-555-0303", address: "300 Construction Ave, Austin TX 78701" },
    ];

    const [org1, org2, org3] = await Promise.all(
      orgData.map(o => db.insert(organizationsTable).values(o).returning().then(r => r[0]))
    );
    const orgs = [org1, org2, org3];

    // ── 2. Org Configs (3 different storage types) ────────────────────────────
    await db.insert(orgConfigTable).values({
      organizationId: org1.id,
      storageType: "cloud",
      storageQuotaMb: 51200,
      storagePath: null,
      systemName: "ArcScale EDMS - Infrastructure",
    }).onConflictDoNothing();

    await db.insert(orgConfigTable).values({
      organizationId: org2.id,
      storageType: "s3",
      storageQuotaMb: 102400,
      storagePath: null,
      s3Endpoint: "https://s3.amazonaws.com",
      s3Bucket: "meridian-edms-documents",
      s3Region: "us-east-1",
      s3AccessKey: "AKIAIOSFODNN7EXAMPLE",
      systemName: "ArcScale EDMS - Meridian",
    }).onConflictDoNothing();

    await db.insert(orgConfigTable).values({
      organizationId: org3.id,
      storageType: "onpremise",
      storageQuotaMb: 204800,
      storagePath: "/mnt/nas/buildpro-edms",
      systemName: "ArcScale EDMS - BuildPro",
    }).onConflictDoNothing();

    // ── 3. Users (3 per org) ─────────────────────────────────────────────────
    const pwHash = await hashPassword("User123!");
    const usersRaw = [
      // Org 1
      { email: "pm.org1@arcscale-infra.com", firstName: "Alice", lastName: "Johnson", role: "project_manager" as const, organizationId: org1.id },
      { email: "dc.org1@arcscale-infra.com", firstName: "Bob", lastName: "Smith", role: "document_controller" as const, organizationId: org1.id },
      { email: "rv.org1@arcscale-infra.com", firstName: "Carol", lastName: "Davis", role: "reviewer" as const, organizationId: org1.id },
      // Org 2
      { email: "pm.org2@meridian-eng.com", firstName: "David", lastName: "Wilson", role: "project_manager" as const, organizationId: org2.id },
      { email: "dc.org2@meridian-eng.com", firstName: "Emma", lastName: "Brown", role: "document_controller" as const, organizationId: org2.id },
      { email: "rv.org2@meridian-eng.com", firstName: "Frank", lastName: "Taylor", role: "reviewer" as const, organizationId: org2.id },
      // Org 3
      { email: "pm.org3@buildpro.com", firstName: "Grace", lastName: "Martinez", role: "project_manager" as const, organizationId: org3.id },
      { email: "dc.org3@buildpro.com", firstName: "Henry", lastName: "Anderson", role: "document_controller" as const, organizationId: org3.id },
      { email: "rv.org3@buildpro.com", firstName: "Iris", lastName: "Thomas", role: "reviewer" as const, organizationId: org3.id },
    ];

    const insertedUsers = await Promise.all(
      usersRaw.map(u => db.insert(usersTable).values({ ...u, passwordHash: pwHash, isActive: true }).returning().then(r => r[0]))
    );

    // Group users by org
    const [u1a, u1b, u1c, u2a, u2b, u2c, u3a, u3b, u3c] = insertedUsers;
    const orgUsers = [[u1a, u1b, u1c], [u2a, u2b, u2c], [u3a, u3b, u3c]];

    // ── 4. Projects (3 per org) ───────────────────────────────────────────────
    const projectData = [
      // Org 1
      { name: "Gulf Coast Pipeline Expansion", code: "GCP-001", description: "Phase 2 expansion of 200km pipeline", organizationId: org1.id, status: "active" as const, startDate: new Date("2024-01-15"), endDate: new Date("2026-06-30") },
      { name: "Offshore Platform Refurbishment", code: "OPR-002", description: "Structural refurbishment of Platform B", organizationId: org1.id, status: "active" as const, startDate: new Date("2024-03-01"), endDate: new Date("2025-12-31") },
      { name: "Terminal Capacity Upgrade", code: "TCU-003", description: "Storage tank farm upgrade", organizationId: org1.id, status: "on_hold" as const, startDate: new Date("2024-06-01"), endDate: new Date("2027-03-31") },
      // Org 2
      { name: "Metro Rail Structural Review", code: "MRS-001", description: "Structural engineering review for metro rail", organizationId: org2.id, status: "active" as const, startDate: new Date("2024-02-01"), endDate: new Date("2025-08-31") },
      { name: "Airport Terminal Design", code: "ATD-002", description: "New terminal building structural design", organizationId: org2.id, status: "active" as const, startDate: new Date("2024-04-15"), endDate: new Date("2026-12-31") },
      { name: "Highway Bridge Assessment", code: "HBA-003", description: "Condition assessment of 12 highway bridges", organizationId: org2.id, status: "completed" as const, startDate: new Date("2023-09-01"), endDate: new Date("2024-08-31") },
      // Org 3
      { name: "Industrial Complex Construction", code: "ICC-001", description: "New petrochemical plant construction", organizationId: org3.id, status: "active" as const, startDate: new Date("2024-01-01"), endDate: new Date("2027-12-31") },
      { name: "Warehouse & Logistics Hub", code: "WLH-002", description: "Multi-level logistics facility", organizationId: org3.id, status: "active" as const, startDate: new Date("2024-05-01"), endDate: new Date("2025-11-30") },
      { name: "Residential Development Phase 1", code: "RDP-003", description: "240-unit residential complex Phase 1", organizationId: org3.id, status: "active" as const, startDate: new Date("2024-07-01"), endDate: new Date("2026-06-30") },
    ];

    const insertedProjects = await Promise.all(
      projectData.map(p => db.insert(projectsTable).values(p).returning().then(r => r[0]))
    );

    const [p1a, p1b, p1c, p2a, p2b, p2c, p3a, p3b, p3c] = insertedProjects;
    const orgProjects = [[p1a, p1b, p1c], [p2a, p2b, p2c], [p3a, p3b, p3c]];

    // ── 5. Project Members ────────────────────────────────────────────────────
    for (let oi = 0; oi < 3; oi++) {
      for (const proj of orgProjects[oi]) {
        for (const usr of orgUsers[oi]) {
          const role = usr.role === "project_manager" ? "project_manager" : usr.role === "document_controller" ? "document_controller" : "reviewer";
          await db.insert(projectMembersTable).values({ projectId: proj.id, userId: usr.id, role }).onConflictDoNothing();
        }
      }
    }

    // ── 6. Folders & Documents (3 docs per project) ───────────────────────────
    // Storage path helper
    function fileUrl(orgIdx: number, projCode: string, module: string, filename: string) {
      if (orgIdx === 0) return `seed/${projCode}/${module}/${filename}`; // cloud
      if (orgIdx === 1) return `s3://meridian-edms-documents/${projCode}/${module}/${filename}`; // s3
      return `/mnt/nas/buildpro-edms/org${orgIdx + 1}/${projCode}/${module}/${filename}`; // onprem
    }

    const disciplines = ["Structural", "Mechanical", "Civil"];
    const docTypes = ["Drawing", "Specification", "Report"];
    const docTitles = [
      ["Foundation Design Drawings", "Steel Frame Specifications", "Site Investigation Report"],
      ["Equipment Layout Plan", "Piping Specifications", "Geotechnical Report"],
      ["Electrical Single Line Diagram", "Instrumentation Spec", "Environmental Impact Report"],
    ];

    for (let oi = 0; oi < 3; oi++) {
      for (let pi = 0; pi < 3; pi++) {
        const proj = orgProjects[oi][pi];
        const users = orgUsers[oi];
        const creator = users[1]; // doc controller

        // Create folder
        const [folder] = await db.insert(foldersTable).values({
          name: "General Documents", projectId: proj.id,
        }).returning();

        // 3 documents per project
        for (let di = 0; di < 3; di++) {
          const docNum = `${proj.code}-${disciplines[di].substring(0, 3).toUpperCase()}-${docTypes[di].substring(0, 3).toUpperCase()}-00${di + 1}`;
          const filename = `${docNum}-Rev-A.pdf`;
          await db.insert(documentsTable).values({
            documentNumber: docNum,
            title: docTitles[oi][di],
            documentType: docTypes[di],
            discipline: disciplines[di],
            revision: "A",
            status: di === 0 ? "approved" : di === 1 ? "under_review" : "draft",
            description: `${docTypes[di]} for ${proj.name} - ${disciplines[di]} discipline`,
            projectId: proj.id,
            folderId: folder.id,
            createdById: creator.id,
            fileUrl: fileUrl(oi, proj.code, "documents", filename),
            fileName: filename,
            fileSize: PLACEHOLDER_PDF_SIZE,
            source: "ArcScale Seed",
            issuedBy: users[0].firstName + " " + users[0].lastName,
          });
        }
      }
    }

    // ── 7. Correspondence (3 threads per project, each with 1 reply) ──────────
    const corrSubjects = [
      "RFI-001: Anchor Bolt Specification Clarification",
      "Technical Query: Concrete Mix Design",
      "NCR Notice: Weld Inspection Failure",
    ];
    const corrTypes = ["rfi", "technical_query", "notice"] as const;

    for (let oi = 0; oi < 3; oi++) {
      for (let pi = 0; pi < 3; pi++) {
        const proj = orgProjects[oi][pi];
        const users = orgUsers[oi];
        const refBase = `${proj.code}-CORR`;

        for (let ci = 0; ci < 3; ci++) {
          // Parent correspondence
          const [parent] = await db.insert(correspondenceTable).values({
            subject: corrSubjects[ci],
            type: corrTypes[ci],
            folder: "sent",
            body: `Dear Team,\n\nPlease review the following ${corrTypes[ci].replace("_", " ")} regarding ${proj.name}.\n\nReference: ${refBase}-00${ci + 1}\n\nKind regards,\n${users[0].firstName} ${users[0].lastName}`,
            fromUserId: users[0].id,
            projectId: proj.id,
            referenceNumber: `${refBase}-00${ci + 1}`,
            status: "sent",
            priority: ci === 2 ? "high" : "medium",
            assignedToId: users[2].id,
            isRead: false,
            sentAt: new Date(Date.now() - (ci + 1) * 3 * 24 * 60 * 60 * 1000),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }).returning();

          // Recipient record
          await db.insert(correspondenceRecipientsTable).values({
            correspondenceId: parent.id, userId: users[2].id,
          }).onConflictDoNothing();

          // Attachment on parent
          await db.insert(correspondenceAttachmentsTable).values({
            correspondenceId: parent.id,
            fileName: `${parent.referenceNumber}-attachment.pdf`,
            fileUrl: fileUrl(oi, proj.code, "correspondence", `${parent.referenceNumber}-attachment.pdf`),
            fileSize: PLACEHOLDER_PDF_SIZE,
          });

          // Reply correspondence
          const [reply] = await db.insert(correspondenceTable).values({
            subject: `Re: ${corrSubjects[ci]}`,
            type: corrTypes[ci],
            folder: "inbox",
            body: `Thank you for your ${corrTypes[ci].replace("_", " ")}.\n\nWe have reviewed your query and provide the following response:\n\nThe specification referenced in ${refBase}-00${ci + 1} has been updated per the latest revision. Please refer to the attached documentation.\n\nBest regards,\n${users[2].firstName} ${users[2].lastName}`,
            fromUserId: users[2].id,
            projectId: proj.id,
            parentId: parent.id,
            referenceNumber: `${refBase}-00${ci + 1}-R`,
            status: "read",
            priority: "medium",
            isRead: true,
            sentAt: new Date(Date.now() - ci * 24 * 60 * 60 * 1000),
          }).returning();

          // Reply recipient
          await db.insert(correspondenceRecipientsTable).values({
            correspondenceId: reply.id, userId: users[0].id,
          }).onConflictDoNothing();
        }
      }
    }

    // ── 8. Meetings (3 per project) ────────────────────────────────────────────
    const meetingTitles = [
      "Weekly Progress Review",
      "Technical Coordination Meeting",
      "HSE Kick-off Meeting",
    ];
    const meetingLocations = ["Project Site Office", "Conference Room A", "Virtual - MS Teams"];

    for (let oi = 0; oi < 3; oi++) {
      for (let pi = 0; pi < 3; pi++) {
        const proj = orgProjects[oi][pi];
        const users = orgUsers[oi];

        for (let mi = 0; mi < 3; mi++) {
          const meetingDate = new Date(Date.now() + (mi - 1) * 7 * 24 * 60 * 60 * 1000);
          const status = mi === 0 ? "completed" : mi === 1 ? "scheduled" : "scheduled";

          const [meeting] = await db.insert(meetingsTable).values({
            title: meetingTitles[mi],
            projectId: proj.id,
            organizedById: users[0].id,
            status: status as any,
            location: meetingLocations[mi],
            meetingDate,
            duration: 60,
            agenda: `1. Review progress on ${proj.name}\n2. Identify blockers\n3. Action items\n4. AOB`,
            minutes: mi === 0 ? `Meeting held as scheduled.\n\nAttendees: ${users.map(u => u.firstName).join(", ")}\n\nKey decisions:\n- Progress on track\n- Next milestone confirmed for upcoming month` : null,
            referenceNumber: `${proj.code}-MTG-00${mi + 1}`,
          }).returning();

          // Attendees
          for (const usr of users) {
            await db.insert(meetingAttendeesTable).values({
              meetingId: meeting.id, userId: usr.id, name: null, email: null, attended: mi === 0,
            }).onConflictDoNothing();
          }

          // Action items on completed meeting
          if (mi === 0) {
            await db.insert(meetingActionItemsTable).values({
              meetingId: meeting.id,
              title: "Submit revised structural calculations",
              assignedToId: users[1].id,
              dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
              status: "open",
              notes: "Include load cases for seismic zone 4",
            });
          }
        }
      }
    }

    // ── 9. NCR Records (3 per org, spread across projects) ────────────────────
    const ncrDescriptions = [
      "Weld quality does not meet AWS D1.1 requirements at grid line C-7",
      "Concrete compressive strength below 28 MPa per cylinder test results",
      "Incorrect bolt grade installed – M24 Grade 8.8 required, Grade 4.6 found",
    ];

    for (let oi = 0; oi < 3; oi++) {
      for (let ni = 0; ni < 3; ni++) {
        const proj = orgProjects[oi][ni];
        const users = orgUsers[oi];
        await db.insert(ncrRecordsTable).values({
          reportNumber: `NCR-${proj.code}-00${ni + 1}`,
          type: "ncr",
          description: ncrDescriptions[ni],
          location: `Grid Line ${String.fromCharCode(65 + ni)}-${ni + 1}`,
          raisedBy: users[0].firstName + " " + users[0].lastName,
          status: ni === 0 ? "closed" : ni === 1 ? "in_progress" : "open",
          correctiveAction: ni === 0 ? "Defective welds ground out and re-welded per approved WPS. UT inspection passed." : null,
          closeDate: ni === 0 ? new Date() : null,
          remarks: `NCR raised during routine inspection on ${proj.name}`,
          projectId: proj.id,
          createdById: users[1].id,
          approvalStatus: ni === 0 ? "approved" : "none",
        });
      }
    }

    // ── 10. ITR Records (3 per org) ────────────────────────────────────────────
    const itrDescriptions = [
      "Structural steel erection inspection – Level 3 Beams",
      "Concrete pour inspection – Foundation slab zone B",
      "Electrical cable tray installation – Level 2 MCC room",
    ];

    for (let oi = 0; oi < 3; oi++) {
      for (let ii = 0; ii < 3; ii++) {
        const proj = orgProjects[oi][ii];
        const users = orgUsers[oi];
        const itrDate = new Date(Date.now() + (ii - 1) * 5 * 24 * 60 * 60 * 1000);
        await db.insert(inspectionRequestsTable).values({
          requestNumber: `ITR-${proj.code}-00${ii + 1}`,
          type: "itr",
          description: itrDescriptions[ii],
          location: `Zone ${ii + 1}`,
          date: itrDate,
          status: ii === 0 ? "passed" : ii === 1 ? "scheduled" : "pending",
          contractor: ii === 0 ? "Apex Steel Erectors" : ii === 1 ? "ConcretePro Ltd" : "ElecBuild Inc",
          remarks: `Inspection request for ${proj.name} – ${itrDescriptions[ii]}`,
          projectId: proj.id,
          createdById: users[0].id,
          approvalStatus: ii === 0 ? "approved" : "none",
        });
      }
    }

    // ── 11. NOC Records (3 per org) ────────────────────────────────────────────
    const nocAuthorities = ["Municipal Fire Department", "Environmental Protection Agency", "Civil Aviation Authority"];
    const nocRemarks = [
      "NOC required for hot work activities on site",
      "Environmental clearance for earthworks and soil disposal",
      "Crane operation height clearance for airspace zone",
    ];

    for (let oi = 0; oi < 3; oi++) {
      for (let ni = 0; ni < 3; ni++) {
        const proj = orgProjects[oi][ni];
        const users = orgUsers[oi];
        const nocDate = new Date(Date.now() - ni * 30 * 24 * 60 * 60 * 1000);
        await db.insert(nocRecordsTable).values({
          nocNumber: `NOC-${proj.code}-00${ni + 1}`,
          authority: nocAuthorities[ni],
          date: nocDate,
          status: ni === 0 ? "approved" : ni === 1 ? "pending" : "expired",
          remarks: nocRemarks[ni],
          projectId: proj.id,
          createdById: users[0].id,
        });
      }
    }

    // ── 12. Transmittals (3 per org) ──────────────────────────────────────────
    for (let oi = 0; oi < 3; oi++) {
      for (let ti = 0; ti < 3; ti++) {
        const proj = orgProjects[oi][ti];
        const users = orgUsers[oi];
        const sentAt = ti === 0 ? new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) : null;

        // Get first doc from this project
        const docs = await db.select().from(documentsTable)
          .where(eq(documentsTable.projectId, proj.id)).limit(1);

        const [trs] = await db.insert(transmittalsTable).values({
          transmittalNumber: `TRS-${proj.code}-00${ti + 1}`,
          subject: ti === 0 ? "Structural Drawings for Review" : ti === 1 ? "Updated Specifications Package" : "Final As-Built Documents",
          description: `Transmittal of ${ti === 0 ? "structural" : ti === 1 ? "specification" : "as-built"} documents for ${proj.name}`,
          status: ti === 0 ? "acknowledged" : ti === 1 ? "sent" : "draft",
          projectId: proj.id,
          createdById: users[1].id,
          toUserId: users[2].id,
          purpose: ti === 0 ? "for_review" : ti === 1 ? "for_approval" : "for_information",
          sentAt,
          dueDate: ti < 2 ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
          acknowledgedAt: ti === 0 ? new Date() : null,
        }).returning();

        // Add transmittal item if we have a doc
        if (docs.length > 0) {
          await db.insert(transmittalItemsTable).values({
            transmittalId: trs.id,
            documentId: docs[0].id,
            revision: "A",
            copies: 1,
            purpose: "For Review",
          }).onConflictDoNothing();
        }
      }
    }

    // ── 13. Deliverables (3 per project) ──────────────────────────────────────
    const deliverableTitles = [
      "Preliminary Design Report",
      "Detailed Engineering Drawings Package",
      "Final Commissioning Report",
    ];
    const deliverableTypes = ["Report", "Drawing Package", "Report"];

    for (let oi = 0; oi < 3; oi++) {
      for (let pi = 0; pi < 3; pi++) {
        const proj = orgProjects[oi][pi];
        const users = orgUsers[oi];

        for (let di = 0; di < 3; di++) {
          const plannedDate = new Date(Date.now() + (di + 1) * 30 * 24 * 60 * 60 * 1000);
          const actualDate = di === 0 ? new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) : null;
          await db.insert(deliverablesTable).values({
            deliverableId: `${proj.code}-DEL-00${di + 1}`,
            title: deliverableTitles[di],
            type: deliverableTypes[di],
            plannedDate,
            actualDate,
            status: di === 0 ? "approved" : di === 1 ? "in_progress" : "not_started",
            responsible: users[0].firstName + " " + users[0].lastName,
            remarks: `${deliverableTitles[di]} for ${proj.name}`,
            projectId: proj.id,
            createdById: users[0].id,
          });
        }
      }
    }

    // ── 14. Drawings (3 per project - special document type) ──────────────────
    const drawingTitles = [
      "General Arrangement Plan",
      "Structural Framing Layout",
      "P&ID - Process Flow Diagram",
    ];

    for (let oi = 0; oi < 3; oi++) {
      for (let pi = 0; pi < 3; pi++) {
        const proj = orgProjects[oi][pi];
        const users = orgUsers[oi];
        const creator = users[1];

        for (let di = 0; di < 3; di++) {
          const drawNum = `${proj.code}-DWG-${String(di + 1).padStart(3, "0")}`;
          const filename = `${drawNum}-Rev-A.pdf`;
          await db.insert(documentsTable).values({
            documentNumber: drawNum,
            title: drawingTitles[di],
            documentType: "Drawing",
            discipline: di === 0 ? "Civil" : di === 1 ? "Structural" : "Mechanical",
            revision: "A",
            status: di === 0 ? "issued" : di === 1 ? "approved" : "under_review",
            description: `${drawingTitles[di]} for ${proj.name}`,
            projectId: proj.id,
            createdById: creator.id,
            fileUrl: fileUrl(oi, proj.code, "drawings", filename),
            fileName: filename,
            fileSize: PLACEHOLDER_PDF_SIZE,
            source: "ArcScale Seed",
            issuedBy: users[0].firstName + " " + users[0].lastName,
          });
        }
      }
    }

    res.json({
      success: true,
      message: "Full test data seeded successfully",
      summary: {
        organizations: 3,
        storageTypes: { cloud: 1, s3: 1, onpremise: 1 },
        usersCreated: 9,
        passwords: "User123!",
        projectsCreated: 9,
        documentsCreated: 27,
        drawingsCreated: 27,
        correspondenceThreads: 27,
        correspondenceReplies: 27,
        meetingsCreated: 27,
        ncrRecords: 9,
        itrRecords: 9,
        nocRecords: 9,
        transmittals: 9,
        deliverables: 27,
        placeholderPdfKey: pdfKey,
        storageStructure: {
          cloud: "seed/{projectCode}/{module}/{filename}",
          s3: "s3://meridian-edms-documents/{projectCode}/{module}/{filename}",
          onpremise: "/mnt/nas/buildpro-edms/org3/{projectCode}/{module}/{filename}",
        },
      },
    });
  } catch (err: any) {
    console.error("Seed failed:", err);
    res.status(500).json({ error: "Seed failed", details: err?.message });
  }
});

// ─── POST /api/dev/clear-seed ─────────────────────────────────────────────────
router.post("/clear-seed", async (req, res): Promise<void> => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }

  try {
    // Find the 3 seeded orgs
    const seedOrgs = await db.select().from(organizationsTable)
      .where(inArray(organizationsTable.name, [
        "ArcScale Infrastructure Ltd",
        "Meridian Engineering Consultants",
        "BuildPro Contractors Inc.",
      ]));

    if (seedOrgs.length === 0) {
      res.json({ message: "No seed data found" });
      return;
    }

    const orgIds = seedOrgs.map(o => o.id);
    const orgUsersList = await db.select().from(usersTable)
      .where(inArray(usersTable.organizationId, orgIds));
    const userIds = orgUsersList.map(u => u.id);
    const projList = await db.select().from(projectsTable)
      .where(inArray(projectsTable.organizationId, orgIds));
    const projIds = projList.map(p => p.id);

    // Delete in cascade-safe order
    if (projIds.length) {
      await db.delete(ncrRecordsTable).where(inArray(ncrRecordsTable.projectId, projIds));
      await db.delete(inspectionRequestsTable).where(inArray(inspectionRequestsTable.projectId, projIds));
      await db.delete(nocRecordsTable).where(inArray(nocRecordsTable.projectId, projIds));
      await db.delete(deliverablesTable).where(inArray(deliverablesTable.projectId, projIds));
      await db.delete(transmittalsTable).where(inArray(transmittalsTable.projectId, projIds));
      await db.delete(correspondenceTable).where(inArray(correspondenceTable.projectId, projIds));
      await db.delete(meetingsTable).where(inArray(meetingsTable.projectId, projIds));
      await db.delete(documentsTable).where(inArray(documentsTable.projectId, projIds));
      await db.delete(projectMembersTable).where(inArray(projectMembersTable.projectId, projIds));
      await db.delete(projectsTable).where(inArray(projectsTable.id, projIds));
    }

    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));

    await db.delete(orgConfigTable).where(inArray(orgConfigTable.organizationId, orgIds));
    await db.delete(organizationsTable).where(inArray(organizationsTable.id, orgIds));

    res.json({ success: true, message: "Seed data cleared" });
  } catch (err: any) {
    res.status(500).json({ error: "Clear failed", details: err?.message });
  }
});

// ─── POST /api/dev/seed-linked-scenario ────────────────────────────────────────
// Creates one fully-linked end-to-end demo scenario:
//   Project → Document → Transmittal → Correspondence (chain) → Meeting → Action Items
router.post("/seed-linked-scenario", async (req, res): Promise<void> => {
  if (!isSysAdmin(req.user!)) { res.status(403).json({ error: "Forbidden" }); return; }

  try {
    // Find the primary seed organisation and its admin user
    const [seedOrg] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.name, "ArcScale Infrastructure Ltd"))
      .limit(1);
    if (!seedOrg) { res.status(400).json({ error: "Run seed data first — ArcScale Infrastructure Ltd not found" }); return; }

    const [adminUser] = await db.select().from(usersTable)
      .where(eq(usersTable.organizationId, seedOrg.id))
      .limit(1);
    if (!adminUser) { res.status(400).json({ error: "No users found in ArcScale Infrastructure Ltd" }); return; }

    // Grab a second user if available for realistic assignments
    const orgUsers = await db.select().from(usersTable)
      .where(eq(usersTable.organizationId, seedOrg.id));
    const secondUser = orgUsers.length > 1 ? orgUsers[1] : adminUser;

    // 1. Project — use a timestamped code to avoid collisions on repeat runs
    const codeTag = Date.now().toString(36).toUpperCase().slice(-4);
    const [project] = await db.insert(projectsTable).values({
      name: "Meridian Tower — Structural Refurbishment",
      code: `MTR-${codeTag}`,
      status: "active",
      organizationId: seedOrg.id,
      description: "Full structural assessment and remediation of the Meridian Tower, including facade works, slab strengthening, and MEP upgrade. Client: Meridian Holdings Group, Sydney CBD.",
      startDate: new Date("2025-02-01"),
      endDate: new Date("2026-06-30"),
    }).returning();

    // 2. Project Member
    await db.insert(projectMembersTable).values([
      { projectId: project.id, userId: adminUser.id, role: "project_manager" },
      ...(secondUser.id !== adminUser.id ? [{ projectId: project.id, userId: secondUser.id, role: "document_controller" }] : []),
    ]);

    // 3. Document
    const [doc] = await db.insert(documentsTable).values({
      documentNumber: "MTR-STR-001",
      title: "Structural Assessment Report — Meridian Tower",
      documentType: "Structural Report",
      discipline: "Structural",
      revision: "B",
      status: "approved",
      description: "Comprehensive structural assessment identifying critical remediation zones, load capacity analysis, and recommended intervention strategies.",
      projectId: project.id,
      createdById: adminUser.id,
      issuedBy: "ArcScale Infrastructure Ltd",
    }).returning();

    // 4. Transmittal
    const [transmittal] = await db.insert(transmittalsTable).values({
      transmittalNumber: "TRS-MTR-0001",
      subject: "Transmittal: Structural Assessment Report for Client Review",
      description: "Please find enclosed the Structural Assessment Report (Rev B) for your review and approval. Comments required within 10 business days.",
      status: "sent",
      projectId: project.id,
      createdById: adminUser.id,
      toExternal: "Meridian Holdings Group — Project Director",
      purpose: "for_review",
      sentAt: new Date("2025-03-10T09:00:00Z"),
      dueDate: new Date("2025-03-24T17:00:00Z"),
    }).returning();

    // 4a. Link document to transmittal
    await db.insert(transmittalItemsTable).values({
      transmittalId: transmittal.id,
      documentId: doc.id,
      revision: "B",
      copies: 1,
      purpose: "For Review and Comment",
    });

    // 5. Initial Correspondence — cover letter sent with transmittal
    const [corrLetter] = await db.insert(correspondenceTable).values({
      subject: `Cover Letter — ${transmittal.transmittalNumber}: Structural Assessment Report`,
      type: "letter",
      folder: "sent",
      body: `Dear Project Director,\n\nPlease find enclosed our Structural Assessment Report (Document No. MTR-STR-001, Rev B) for the Meridian Tower Structural Refurbishment project.\n\nThe report identifies three critical remediation zones and outlines our recommended intervention strategies, including slab strengthening at Levels 14–17 and facade anchor replacement on the eastern elevation.\n\nWe kindly request your review and formal approval within 10 business days (by 24 March 2025). Please direct any comments to the undersigned.\n\nKind regards,\n${adminUser.firstName ?? "Project"} ${adminUser.lastName ?? "Manager"}\nArcScale Infrastructure Ltd`,
      fromUserId: adminUser.id,
      projectId: project.id,
      referenceNumber: "CORR-MTR-001",
      status: "sent",
      priority: "high",
      linkedDocumentId: doc.id,
      sentAt: new Date("2025-03-10T09:30:00Z"),
    }).returning();

    // 6. Client Reply — RFI raised in response
    const [corrRfi] = await db.insert(correspondenceTable).values({
      subject: `RE: ${corrLetter.subject} — Request for Information`,
      type: "rfi",
      folder: "inbox",
      body: `Dear ${adminUser.firstName ?? "Project"} ${adminUser.lastName ?? "Manager"},\n\nThank you for submitting the Structural Assessment Report. Following our internal review, we require clarification on the following:\n\n1. The load capacity analysis assumptions at Level 15 appear to use 2018 code values — please confirm compliance with AS 1170.1:2022.\n2. Can you provide the raw deflection data referenced in Section 4.3?\n3. The eastern facade anchor replacement scope — are spandrel panels included?\n\nWe request your response by 28 March 2025.\n\nRegards,\nMeridian Holdings Group`,
      fromUserId: secondUser.id,
      projectId: project.id,
      referenceNumber: "CORR-MTR-002",
      status: "sent",
      priority: "urgent",
      parentId: corrLetter.id,
      sentAt: new Date("2025-03-18T14:15:00Z"),
      dueDate: new Date("2025-03-28T17:00:00Z"),
    }).returning();

    // 7. Response to RFI
    const [corrResponse] = await db.insert(correspondenceTable).values({
      subject: `RE: CORR-MTR-002 — Response to RFI on Structural Assessment`,
      type: "letter",
      folder: "sent",
      body: `Dear Project Director,\n\nThank you for your queries regarding the Structural Assessment Report. Please find our responses below:\n\n1. **AS 1170.1:2022 compliance**: Confirmed. The analysis was performed under AS 1170.1:2022 — the 2018 values noted in Appendix C are historical comparators only and do not affect design loads.\n\n2. **Raw deflection data (Section 4.3)**: Full dataset is appended to this correspondence as Addendum A.\n\n3. **Spandrel panels**: Yes, the eastern facade scope includes full spandrel panel replacement at Levels 6–22, as detailed in our updated schedule of works.\n\nWe trust these responses are satisfactory. Please advise if further information is required.\n\nKind regards,\n${adminUser.firstName ?? "Project"} ${adminUser.lastName ?? "Manager"}\nArcScale Infrastructure Ltd`,
      fromUserId: adminUser.id,
      projectId: project.id,
      referenceNumber: "CORR-MTR-003",
      status: "responded",
      priority: "high",
      parentId: corrRfi.id,
      sentAt: new Date("2025-03-26T11:00:00Z"),
    }).returning();

    // 8. Meeting
    const [meeting] = await db.insert(meetingsTable).values({
      title: "Meridian Tower — Structural Assessment Review Meeting",
      projectId: project.id,
      organizedById: adminUser.id,
      status: "completed",
      location: "ArcScale Board Room, Level 12, 333 George St, Sydney",
      meetingDate: new Date("2025-03-28T10:00:00Z"),
      duration: 90,
      referenceNumber: "MTG-MTR-001",
      agenda: "1. Review of Structural Assessment Report (MTR-STR-001 Rev B)\n2. Client RFI responses (CORR-MTR-002 / CORR-MTR-003)\n3. Revised remediation programme and key milestones\n4. Risk register review — Level 15 slab works\n5. Action items and next steps",
      minutes: "Meeting opened at 10:00 AM. All attendees confirmed receipt of the Structural Assessment Report and RFI responses.\n\nItem 1: The report was accepted with minor comments. Client requested an updated executive summary by 4 April.\n\nItem 2: RFI responses were reviewed and accepted. No further technical queries outstanding.\n\nItem 3: Revised programme presented — slab strengthening commences 15 April, targeted completion 30 June 2025.\n\nItem 4: Level 15 slab risk rated HIGH due to construction sequencing. Risk to be reviewed at next meeting.\n\nItem 5: Action items allocated — see below.\n\nMeeting closed at 11:35 AM.",
    }).returning();

    // 9. Meeting Attendees
    await db.insert(meetingAttendeesTable).values([
      { meetingId: meeting.id, userId: adminUser.id, attended: true },
      { meetingId: meeting.id, userId: secondUser.id, attended: true },
      { meetingId: meeting.id, name: "David Chen", email: "d.chen@meridian-holdings.com.au", attended: true },
      { meetingId: meeting.id, name: "Sarah Nguyễn", email: "s.nguyen@meridian-holdings.com.au", attended: true },
    ]);

    // 10. Meeting Action Items
    await db.insert(meetingActionItemsTable).values([
      {
        meetingId: meeting.id,
        title: "Issue updated Executive Summary for Structural Assessment Report (Rev B)",
        assignedToId: adminUser.id,
        dueDate: new Date("2025-04-04T17:00:00Z"),
        status: "done",
        priority: "high",
        notes: "Include revised risk matrix and updated remediation programme overview.",
      },
      {
        meetingId: meeting.id,
        title: "Submit Addendum A (Level 15 deflection dataset) to client via transmittal",
        assignedToId: secondUser.id,
        dueDate: new Date("2025-03-31T17:00:00Z"),
        status: "done",
        priority: "high",
        notes: "Reference CORR-MTR-003. Use standard transmittal format TRS-MTR-XXXX.",
      },
      {
        meetingId: meeting.id,
        title: "Update risk register — Level 15 slab works rated HIGH",
        assignedToId: adminUser.id,
        dueDate: new Date("2025-04-07T17:00:00Z"),
        status: "in_progress",
        priority: "high",
        notes: "Escalate to steering committee if risk cannot be mitigated below MEDIUM by 7 April.",
      },
      {
        meetingId: meeting.id,
        title: "Confirm eastern facade spandrel panel contractor and issue LOA",
        assignedToId: secondUser.id,
        dueDate: new Date("2025-04-10T17:00:00Z"),
        status: "open",
        priority: "medium",
        notes: "Three quotes received — pending procurement approval.",
      },
    ]);

    res.json({
      success: true,
      message: "Linked scenario created successfully",
      scenario: {
        project: { id: project.id, name: project.name, code: project.code },
        document: { id: doc.id, number: doc.documentNumber, title: doc.title },
        transmittal: { id: transmittal.id, number: transmittal.transmittalNumber },
        correspondence: [
          { id: corrLetter.id, ref: corrLetter.referenceNumber, type: "Cover Letter" },
          { id: corrRfi.id, ref: corrRfi.referenceNumber, type: "RFI (reply)", parentId: corrRfi.parentId },
          { id: corrResponse.id, ref: corrResponse.referenceNumber, type: "Response to RFI", parentId: corrResponse.parentId },
        ],
        meeting: { id: meeting.id, ref: meeting.referenceNumber, title: meeting.title },
        actionItems: 4,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Seed failed", details: err?.message });
  }
});

export default router;
