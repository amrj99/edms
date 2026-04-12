import React from "react";
import { Check, Minus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * Role Matrix — read-only governance reference.
 * Rows = permission capabilities. Columns = role tiers.
 * Source of truth: usePermissions hook + backend permissions.ts rank logic.
 *
 * Symbols:
 *   ✓  = always permitted at this role and above
 *   A  = assignment-based (must also be the designated assignee)
 *   –  = not permitted
 */

interface MatrixRow {
  category: string;
  action: string;
  description: string;
  /** Minimum role that can perform the action (or special marker) */
  minRole?: string;
  /** If assignment-based, the minimum role when NOT admin */
  assignedMinRole?: string;
  isAssignmentBased?: boolean;
  /** Roles that are explicitly forbidden even if they meet rank */
  blockedRoles?: string[];
}

const ROLES = [
  { key: "viewer",             label: "Viewer",      rank: 0  },
  { key: "member",             label: "Member",      rank: 10 },
  { key: "reviewer",           label: "Reviewer",    rank: 20 },
  { key: "document_controller",label: "DC",          rank: 40 },
  { key: "project_manager",    label: "PM",          rank: 60 },
  { key: "admin",              label: "Admin",       rank: 80 },
  { key: "system_owner",       label: "Sys Owner",   rank: 100 },
] as const;

const ROLE_RANK: Record<string, number> = Object.fromEntries(ROLES.map(r => [r.key, r.rank]));

const ROWS: MatrixRow[] = [
  // ── Correspondence
  {
    category: "Correspondence",
    action: "View assigned correspondence",
    description: "See correspondence items addressed to or shared with the user.",
    minRole: "viewer",
  },
  {
    category: "Correspondence",
    action: "Create / compose correspondence",
    description: "Open a new correspondence thread (RFI, TQ, letter, etc.)",
    minRole: "member",
  },
  {
    category: "Correspondence",
    action: "Reply / Reply All / Forward",
    description: "Send a reply or forward an existing thread.",
    minRole: "member",
  },
  {
    category: "Correspondence",
    action: "View all project correspondence",
    description: "DC+ can opt-in to view all threads across the project (not just their own).",
    minRole: "document_controller",
  },
  {
    category: "Correspondence",
    action: "Close / archive threads",
    description: "Mark a thread as closed or archive it.",
    minRole: "document_controller",
  },
  {
    category: "Correspondence",
    action: "Hard-delete correspondence",
    description: "Permanently remove a correspondence record (audit-logged).",
    minRole: "admin",
  },

  // ── Documents
  {
    category: "Documents",
    action: "View documents",
    description: "Read-only access to documents and their metadata.",
    minRole: "viewer",
  },
  {
    category: "Documents",
    action: "Upload / create documents",
    description: "Add new documents or revisions to the project.",
    minRole: "document_controller",
  },
  {
    category: "Documents",
    action: "Edit document metadata",
    description: "Modify document title, number, status, or other fields.",
    minRole: "document_controller",
  },
  {
    category: "Documents",
    action: "Delete documents (draft / under review)",
    description: "Remove documents that are not yet issued or approved.",
    minRole: "document_controller",
  },
  {
    category: "Documents",
    action: "Delete documents (approved / issued / archived)",
    description: "Admin override to remove locked documents with mandatory reason.",
    minRole: "admin",
  },
  {
    category: "Documents",
    action: "Submit document for review workflow",
    description: "Initiate a formal approval or review workflow on a document.",
    minRole: "document_controller",
  },

  // ── Transmittals
  {
    category: "Transmittals",
    action: "View transmittals",
    description: "View transmittals in the project.",
    minRole: "viewer",
  },
  {
    category: "Transmittals",
    action: "Create transmittals",
    description: "Prepare a new transmittal package.",
    minRole: "document_controller",
  },
  {
    category: "Transmittals",
    action: "Send transmittals",
    description: "Dispatch a transmittal for review.",
    minRole: "document_controller",
  },
  {
    category: "Transmittals",
    action: "Set review code on assigned items",
    description: "Set ABCD review code — only when formally designated as the reviewer.",
    isAssignmentBased: true,
    assignedMinRole: "reviewer",
    minRole: "admin",
  },
  {
    category: "Transmittals",
    action: "Complete review cycle (assigned)",
    description: "Mark transmittal review complete — only when formally responsible.",
    isAssignmentBased: true,
    assignedMinRole: "document_controller",
    minRole: "admin",
  },
  {
    category: "Transmittals",
    action: "Admin approve / reject transmittal",
    description: "Override to approve or reject a transmittal directly.",
    minRole: "admin",
  },

  // ── Workflows
  {
    category: "Workflows",
    action: "View workflow history",
    description: "See the status of document approval workflows.",
    minRole: "viewer",
  },
  {
    category: "Workflows",
    action: "Approve / reject workflow step",
    description: "Act on a step the user has been assigned to in a workflow.",
    isAssignmentBased: true,
    assignedMinRole: "reviewer",
    minRole: "admin",
  },

  // ── Audit & Governance
  {
    category: "Audit & Governance",
    action: "View governance dashboard",
    description: "Access the project-level governance and SLA overview.",
    minRole: "document_controller",
  },
  {
    category: "Audit & Governance",
    action: "View audit log",
    description: "See the audit trail of all system events.",
    minRole: "document_controller",
  },
  {
    category: "Audit & Governance",
    action: "Export audit log",
    description: "Download the audit log as CSV or XLSX.",
    minRole: "document_controller",
  },

  // ── Role & Member Management
  {
    category: "Role & Member Management",
    action: "View project members",
    description: "See the list of project members and their roles.",
    minRole: "viewer",
  },
  {
    category: "Role & Member Management",
    action: "Add / remove project members",
    description: "Manage project membership.",
    minRole: "project_manager",
  },
  {
    category: "Role & Member Management",
    action: "Grant project-level role override",
    description: "Temporarily elevate a member's role within a project.",
    minRole: "project_manager",
  },
  {
    category: "Role & Member Management",
    action: "Manage org-level roles",
    description: "Assign or change organisational roles for users.",
    minRole: "admin",
  },
  {
    category: "Role & Member Management",
    action: "System administration",
    description: "Full system access including tenant management.",
    minRole: "system_owner",
  },
];

type CellState = "yes" | "assigned" | "no";

function getCell(row: MatrixRow, roleKey: string): CellState {
  const rank = ROLE_RANK[roleKey] ?? 0;

  if (row.isAssignmentBased) {
    // Admin+ always yes
    if (rank >= (ROLE_RANK[row.minRole ?? "system_owner"] ?? 100)) return "yes";
    // Meets assignedMinRole → assignment-based
    if (rank >= (ROLE_RANK[row.assignedMinRole ?? "reviewer"] ?? 20)) return "assigned";
    return "no";
  }

  const minRank = ROLE_RANK[row.minRole ?? "viewer"] ?? 0;
  return rank >= minRank ? "yes" : "no";
}

function Cell({ state }: { state: CellState }) {
  if (state === "yes") return (
    <td className="text-center px-2 py-3">
      <div className="flex items-center justify-center">
        <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center">
          <Check className="h-3.5 w-3.5 text-emerald-700 stroke-[2.5]" />
        </div>
      </div>
    </td>
  );
  if (state === "assigned") return (
    <td className="text-center px-2 py-3">
      <div className="flex items-center justify-center">
        <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
          <span className="text-[9px] font-bold text-amber-700">A</span>
        </div>
      </div>
    </td>
  );
  return (
    <td className="text-center px-2 py-3">
      <div className="flex items-center justify-center">
        <Minus className="h-3.5 w-3.5 text-slate-300" />
      </div>
    </td>
  );
}

export function RoleMatrix() {
  const categories = Array.from(new Set(ROWS.map(r => r.category)));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Users className="h-5 w-5" /> Role Permissions Matrix
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Read-only reference showing which roles can perform each action. Reflects the live permission model.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center">
            <Check className="h-3.5 w-3.5 text-emerald-700 stroke-[2.5]" />
          </div>
          <span>Permitted</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-amber-100 flex items-center justify-center">
            <span className="text-[9px] font-bold text-amber-700">A</span>
          </div>
          <span>Assignment-based (must be formally designated)</span>
        </div>
        <div className="flex items-center gap-2">
          <Minus className="h-4 w-4 text-slate-300" />
          <span>Not permitted</span>
        </div>
      </div>

      {/* Matrix table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-semibold w-[280px] min-w-[220px]">Action</th>
                {ROLES.map(r => (
                  <th key={r.key} className="text-center px-2 py-3 font-semibold min-w-[80px]">
                    <span className="whitespace-nowrap">{r.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map(category => {
                const catRows = ROWS.filter(r => r.category === category);
                return (
                  <React.Fragment key={category}>
                    {/* Category separator */}
                    <tr className="bg-primary/5 border-t">
                      <td colSpan={ROLES.length + 1} className="px-4 py-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary/80">{category}</span>
                      </td>
                    </tr>

                    {catRows.map(row => (
                      <tr key={row.action} className="border-t hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-sm">{row.action}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{row.description}</div>
                          {row.isAssignmentBased && (
                            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100 text-[10px] text-amber-700 font-medium">
                              Assignment-based
                            </div>
                          )}
                        </td>
                        {ROLES.map(r => (
                          <Cell key={r.key} state={getCell(row, r.key)} />
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Role hierarchy (ascending): Viewer → Member → Reviewer → Document Controller → Project Manager → Admin → System Owner.
        Each role inherits all permissions of roles below it. Assignment-based permissions require both the minimum role AND formal designation to the item.
      </p>
    </div>
  );
}
