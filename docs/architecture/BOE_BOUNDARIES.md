# BOE Boundaries — Platform Services · Platform Entities · Business Objects

> **Status:** Approved conceptual boundary (v2). This is the **single foundation document** for
> the Business Object Engine. It answers exactly one question — *what belongs to the Business
> Object Engine, and what remains a platform capability* — and nothing else. **No ADR, no data
> model, no schema, no code** is decided here; those follow, and depend on, this boundary.

---

## 1. Governing principle — three tiers

The platform is cut into **three** layers, each with a distinct nature:

| Tier | Nature | Customizable per org/project? | One-line identity |
|------|--------|------------------------------|-------------------|
| **Platform Services** | *Verbs / cross-cutting mechanisms* | ❌ No | *How* things move, are processed, and are served |
| **Platform Entities** | *Structural backbone nouns* | ❌ No (fixed core schema) | *The coordinate system* every object references |
| **Business Objects** | *Domain records* | ✅ Yes (Base → Org → Project) | *What* people fill in, route, and approve |

**Litmus test:**
- Acts *on* other records, shape never varies → **Service**.
- A fixed backbone noun everything references, not a fill-in form → **Entity**.
- A domain record with customizable fields / forms / lifecycle → **Business Object**.

One-line: *"Does a customer fill this in and route it (Business Object), does it route/serve other things (Service), or is it the fixed backbone everything hangs off (Entity)?"*

---

## 2. Master classification

### 🟦 Platform Services — fixed mechanisms (never a Definition)
Workflow Engine · Audit Trail · Notifications · Search / Index · Numbering / Sequences ·
**Submission Chains (routing)** · **Correspondence Transport (delivery, recipients, read-receipts, threading)** ·
Transmittal transport · Tasks · Authorization (`requireProjectAccess`, party ceiling) · Storage adapters ·
Comments · Attachments mechanism · Revision mechanism · Register / List contract (`ListResponse`) ·
Rendering & Print engine · Relationship Engine (see §6) · Definition-Inheritance resolver (Base → Org → Project).

### 🟩 Platform Entities — fixed structural backbone (never a Definition)
**Documents** · **Projects** · **Organizations** · **Users** · **Parties**
(+ their fixed sub-structures: Folders, Memberships, Departments).

- **Documents are a Platform Entity** — not a mere capability, not a Business Object. They own files,
  revisions, transmittals, and registers. Business Objects *reference* Documents; the Document
  metadata layer *consumes the shared field engine*, but a Document is never a BOE definition.
- **Drawing is NOT a separate Platform Entity.** A Drawing is a **Specialized Document** inside
  Document Management, distinguished by document type + metadata + status + revisions, while keeping
  the **Document identity itself**. There is **no separate table or engine for drawings**.
  Relationships may point to a **Drawing Document**, or to a **specific Drawing Revision** *if the
  versioning system supports targeting a revision*.

### 🟧 Business Objects — customizable definitions (Base → Org → Project)
Material Approval · RFI · NCR · MIR · WIR · Inspection Request · Prequalification · Vendor Registration ·
Site Instruction · Method Statement · Technical Query · **Letter (and typed correspondence content:
memo, notice, formal letter)** · **Meeting** · … and any future construction record.

---

## 3. Refined splits (locked rulings)

**① Correspondence = Service + Object (split).**
- **Correspondence Transport** → Platform **Service**: recipients, delivery, read-receipts, threading — *how a record is sent*.
- **Letter** (and other typed correspondence content) → **Business Object**: its own fields, lifecycle,
  approval, and print template — *the record that is sent*, then carried over the transport.

**② Meetings = Business Object (from now).**
- Classified as a **Business Object** immediately (fields, attendees, minutes, action-items, lifecycle).
  The **current hand-coded implementation stays fixed and is not migrated now** — only the
  classification is settled, so future design stays consistent. Migration deferred.

---

## 4. Candidates — NOT locked (pending Data Model review)

These are recorded as examples / candidates only. They are **not** decided in this document and must be
resolved during Data Model review with an inventory of real usage.

- **Package — Project Structural Entity Candidate; classification pending Data Model review.**
  "Package" is ambiguous — it may mean *Design Package*, *Work Package*, *Procurement Package*,
  *Submission Package*, or *Contract Package*. Some senses may be a fixed structural entity; others may
  be a classification or a Business Object. **Requires a usage inventory before the decision is locked.**
  It may appear as a relationship example below, marked clearly as a candidate.
- **Vendor — not a new Platform Entity here.** Currently treated as a **Role / Type within the existing
  Party / Organization / Entity model**, until the actual model is examined in the Data Model phase.

---

## 5. System Fields contract (the platform ↔ definition seam)

Every Business Object **inherits immutable, non-deletable System Fields**, because the Services and
Entities depend on them:

`id` · `organization` · `project` · `status` · `revision` · `createdBy` · `createdAt` · `updatedAt` ·
`audit` · workflow binding (when bound).

Rationale — these are the interface to the platform: AuthZ needs `organization`/`project`; Workflow
needs `status`; Audit needs `createdBy`/timestamps; Registers need `id`/`revision`. **A definition can
never remove a System Field** — doing so would break a Service. Everything else is a **Definition Field**
(add / remove / reorder / require / validate / section / list / permission / workflow-bind).

---

## 6. Four customizable surfaces

Each Definition owns, per layer, four presentation surfaces — all customizable, all rendered by the
fixed rendering Service:

1. **Input Form** — data entry.
2. **Review Form** — reviewer/approver view (show/hide/lock fields by role & stage).
3. **Register Columns** — the list/table view (which fields become columns, order, filters).
4. **Print / PDF Template** — the company's official form layout.

The **surfaces are definitions** (customizable); the **renderer + PDF engine are Services** (fixed).

---

## 7. The Relationship Graph (future Relationship Engine)

Every Business Object is a **node in a project-wide relationship graph** — **not a bag of attachments**.

- **Edges (typed, directional, cardinality-constrained by definition):**
  - **BO → Platform Entity:** Material Approval → *Documents* (submittal, test certs), → *Project*,
    → *Vendor* (as a Party/Entity role, §4), → *Drawing Document / Drawing Revision* (§2),
    → *Package* (candidate, §4).
  - **BO → BO:** NCR → *Inspection Request*; NCR → *Material Approval*; RFI → *Drawing revision*;
    Site Instruction → *NCR*.
- **Why a graph, not attachments:** it enables **traceability, impact analysis, and rollups** —
  "show every NCR linked to this drawing revision", "what Material Approvals block this Package",
  "trace this Vendor's rejected submittals". Attachments cannot answer these.
- **Design direction:** a future first-class **Relationship Engine** (a Platform **Service**) that stores
  typed links and answers graph queries. **v1 scope:** a typed, constrained links model + basic
  traversal — **not** a full graph database, and **not** arbitrary user-defined edges (edges are declared
  in definitions). The *allowed relationships per object type* are **Definition** data.

---

## 8. What stays fixed vs becomes a Definition

- **Fixed — Services:** workflow, audit, notifications, search, numbering, submission chains,
  correspondence *transport*, transmittals, tasks, auth, storage, rendering/print, relationship engine,
  inheritance resolver.
- **Fixed — Entities:** Documents (incl. Drawing as a specialized Document), Projects, Organizations,
  Users, Parties.
- **Definitions — Business Objects:** every domain record (Material Approval, NCR, RFI, MIR, WIR,
  **Letter**, **Meeting**, …), their fields, four surfaces, permission matrix, workflow binding, and
  **allowed relationships** — resolved Base → Org → Project.

---

## 9. Anti-scope

BOE does **not** own file bytes/storage, workflow execution, message delivery, or authentication. It is
**not** a generic no-code platform and **not** a cross-tenant marketplace. It is a **construction-domain
Business Object runtime** sitting above the field runtime, beside the Workflow Engine, wired into the
Relationship Engine.

---

## 10. Open items deferred to Data Model review
- Package classification (§4).
- Vendor modeling within Party/Organization/Entity (§4).
- Whether relationships can target a specific Drawing Revision (depends on the versioning model, §2).

These do **not** block the boundary; they are the first questions the Data Model phase answers.
