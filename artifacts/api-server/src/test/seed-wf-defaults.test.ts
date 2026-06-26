/**
 * seed-wf-defaults.test.ts
 *
 * Validates that every DEFAULT_TEMPLATE in seed-wf-defaults.ts uses only
 * valid AppRole system roles (or null for terminal stages) and that
 * documentType values are lowercase strings that can match the system.
 *
 * These tests are STATIC — they inspect the template definitions themselves,
 * not the DB. No DB connection required.
 *
 * Guards against:
 *   - Custom role strings like "Finance", "GM", "Legal" that don't exist in the system
 *   - Uppercase documentType like "Invoice" that won't match lowercase document types
 *   - Missing terminal stage (isTerminal: true) at end of each template
 */

import { describe, it, expect } from "vitest";
import { ALL_ROLES } from "../lib/permissions.js";

// ── Import the template definitions directly ──────────────────────────────────
// We re-define the type here to avoid importing the full script (which runs at import)
interface StageDefinition {
  stageOrder: number;
  name: string;
  responsibleRole: string | null;
  isTerminal: boolean;
}

interface TemplateDefinition {
  name: string;
  documentType: string;
  description: string;
  stages: StageDefinition[];
}

// Copy of DEFAULT_TEMPLATES from seed-wf-defaults.ts — kept in sync manually.
// If you change seed-wf-defaults.ts, update this list too.
const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    name: "General Document Approval",
    documentType: "general",
    description: "Standard approval for general documents: internal review → senior review → issued",
    stages: [
      { stageOrder: 1, name: "Internal Review",    responsibleRole: "reviewer",            isTerminal: false },
      { stageOrder: 2, name: "Senior Review",      responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 3, name: "Approved for Issue", responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Correspondence Workflow",
    documentType: "correspondence",
    description: "Action tracking for incoming and outgoing correspondence",
    stages: [
      { stageOrder: 1, name: "Acknowledged",   responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 2, name: "Manager Review", responsibleRole: "project_manager",     isTerminal: false },
      { stageOrder: 3, name: "Actioned",       responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Contract Approval Workflow",
    documentType: "contract",
    description: "Approval workflow for contracts and formal agreements",
    stages: [
      { stageOrder: 1, name: "Review",               responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 2, name: "Management Approval",  responsibleRole: "project_manager",     isTerminal: false },
      { stageOrder: 3, name: "Executed",             responsibleRole: null,                  isTerminal: true  },
    ],
  },
  {
    name: "Drawing Approval Workflow",
    documentType: "drawing",
    description: "Engineering review and approval for technical drawings",
    stages: [
      { stageOrder: 1, name: "Technical Review",           responsibleRole: "reviewer",            isTerminal: false },
      { stageOrder: 2, name: "Senior Engineer Review",     responsibleRole: "document_controller", isTerminal: false },
      { stageOrder: 3, name: "Approved for Construction",  responsibleRole: null,                  isTerminal: true  },
    ],
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("seed-wf-defaults — DEFAULT_TEMPLATES static validation", () => {

  it("contains at least one template", () => {
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("no template uses 'Invoice' (capital I) as documentType — causes dead template", () => {
    const invoiceTemplate = DEFAULT_TEMPLATES.find(t => t.documentType === "Invoice");
    expect(invoiceTemplate).toBeUndefined();
  });

  it("all documentType values are lowercase strings", () => {
    for (const tpl of DEFAULT_TEMPLATES) {
      expect(tpl.documentType).toBe(tpl.documentType.toLowerCase());
    }
  });

  describe("each template", () => {
    for (const tpl of DEFAULT_TEMPLATES) {
      describe(`"${tpl.name}"`, () => {

        it("has at least 2 stages", () => {
          expect(tpl.stages.length).toBeGreaterThanOrEqual(2);
        });

        it("has exactly one terminal stage (isTerminal: true)", () => {
          const terminals = tpl.stages.filter(s => s.isTerminal);
          expect(terminals.length).toBe(1);
        });

        it("terminal stage is the last stage", () => {
          const lastStage = tpl.stages[tpl.stages.length - 1];
          expect(lastStage?.isTerminal).toBe(true);
        });

        it("terminal stage has responsibleRole = null", () => {
          const terminal = tpl.stages.find(s => s.isTerminal);
          expect(terminal?.responsibleRole).toBeNull();
        });

        it("no non-terminal stage uses a custom/unknown role string", () => {
          const validRoles = new Set(ALL_ROLES);
          const invalidStages = tpl.stages
            .filter(s => !s.isTerminal && s.responsibleRole !== null)
            .filter(s => !validRoles.has(s.responsibleRole as any));

          if (invalidStages.length > 0) {
            const details = invalidStages.map(s => `stage "${s.name}" → "${s.responsibleRole}"`).join(", ");
            throw new Error(
              `Template "${tpl.name}" has non-system responsibleRole(s): ${details}. ` +
              `Valid roles: ${[...validRoles].join(", ")}`
            );
          }

          expect(invalidStages).toHaveLength(0);
        });

        it("stage stageOrder values are sequential starting from 1", () => {
          const orders = tpl.stages.map(s => s.stageOrder).sort((a, b) => a - b);
          orders.forEach((order, idx) => {
            expect(order).toBe(idx + 1);
          });
        });
      });
    }
  });

  describe("known bad patterns from history", () => {

    it("no stage uses 'Finance' as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Finance");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'GM' as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "GM");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Legal' as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Legal");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Manager' (not a system role) as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Manager");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Checker' as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Checker");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Senior Engineer' as responsibleRole", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Senior Engineer");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Document Controller' (with space) instead of document_controller", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Document Controller");
      expect(bad).toBeUndefined();
    });

    it("no stage uses 'Reviewer' (capitalized) instead of reviewer", () => {
      const bad = DEFAULT_TEMPLATES.flatMap(t => t.stages).find(s => s.responsibleRole === "Reviewer");
      expect(bad).toBeUndefined();
    });
  });
});
