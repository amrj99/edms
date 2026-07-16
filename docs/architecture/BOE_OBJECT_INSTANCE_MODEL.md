# BOE — Object Instance Model (Conceptual)

> **Purpose:** define what an Object Instance is, its identity, state, history, scope, and how it
> connects to the platform — conceptually. **No tables, no columns, no SQL, no technology.** Component
> design only; nothing here authorizes schema, migration, ADR, or code. The Relationship Engine and
> Workflow Subject Binding are separate later components; only their connection points appear here.

---

## Pinned rules (fixed above everything below)
- **Instance Revision ≠ Definition Version.**
- Changing record data does not automatically create a Definition Version.
- Upgrading a record never erases its prior interpretation.
- **Status is not an ordinary dynamic field.**
- **The Reference Number is not the database identity.**
- A related Document never becomes the Instance.
- A historical record is never re-composed from Base/Org/Project at display time.
- Soft delete / archive never erases audit, revisions, or historical relationships.

---

## 1. Stable Instance Identity
**Instance Identity** is an internal, immutable identifier that never changes — not the Reference
Number, not a display code. It stays constant across every edit, revision, upgrade, archive, and
restore. Everything else (values, status, pinned version, reference number) changes around it; the
identity does not.

## 2. Instance Identity vs Instance Revision vs Definition Version vs Workflow State
Four independent axes:
- **Instance Identity** — *who* the record is (permanent).
- **Instance Revision** — an immutable snapshot of record **content** at a governed event (§4);
  belongs to the record.
- **Definition Version** — the type contract the record is **pinned to**; belongs to the definition,
  not the record.
- **Workflow State (Status)** — *where* the record is in its lifecycle; owned by the single lifecycle
  authority (§7), not a dynamic field.

One record (Identity), with a content history (Revisions), pinned to a contract (Definition Version),
positioned in its lifecycle (State).

## 3. Fixed core vs dynamic values
- **Fixed core (System Fields):** Identity · Organization · Project *(per Scope Contract, §5)* ·
  Definition + Version · Reference Number · Status · Created/Updated By/At · Lifecycle/archival.
  These live in the core, not the dynamic layer.
- **Dynamic values:** the field values declared by the Effective Definition Version — stored pinned to
  that version.

*(Note: "Revision" is not a universal core field. Content history is Audit + Formal Instance
Revisions (§4); a document-style "reissue" is a domain concern declared by the type, not a universal
System Field. Reference numbering is disambiguated in §16.)*

## 4. Working State / Audit History / Formal Instance Revision
Three distinct concepts:
- **Working State** — the current, editable content.
- **Audit History** — the record of every change operation.
- **Formal Instance Revision** — an **immutable snapshot** created at a **governed event** (e.g.
  Submit, Resubmit, official issuance, Definition-Version upgrade, or an event the type declares).

> **Not every save creates a formal revision, and not every audit event is a revision.**

The policy of which events create a Formal Instance Revision may be declared by the Definition, within
platform limits.

## 5. Ownership & Scope Contract
**Organization / tenant is mandatory.** Project association is **not** universal — the Definition
declares a **Scope Contract**:
- **Organization-scoped** — exists at the org level (e.g. Vendor Registration, Prequalification),
  independent of any project.
- **Project-scoped** — must belong to a project (e.g. NCR, RFI).

> **Multi-project Scope — declared future scope type, not enabled in v1.**

Multi-project is deferred: it needs its own design for isolation, Party Ceiling, register visibility,
and cross-project permission conflicts.

Explicit consequence:

> **Organization-scoped Instances do not use `requireProjectAccess`; they require a separate
> fail-closed organization-level authorization path governed by tenant and role ceilings.**

## 6. Pinning to the Effective Definition Version
At creation, the effective contract (Base→Org→Project) is resolved once into a **frozen Effective
Definition Version**, and the Instance is pinned to it **directly**. A later definition upgrade does
not move this pin except through an explicit, governed record-upgrade (§9).

## 7. Lifecycle authority — exactly one at a time

> **An Object Instance has exactly one lifecycle authority at any point in time.**

- Before workflow activation: the **Simple Lifecycle** is the authoritative source.
- At Submit / the binding event: a **governed, atomic transfer** of authority occurs.
- After activation: the **Workflow alone** changes status.

No period has both authorities active; **no direct API bypasses the authority.** Status is not
directly writable; only the current authority moves it (a governed transition). A direct status
assignment is rejected (fail-closed).

### 7a. Workflow binding & activation

> **The Definition declares the workflow binding, but the workflow instance is created and activated
> atomically at submission. Lifecycle authority transfers from the Simple Lifecycle to the Workflow
> only when that activation succeeds.**

- The Definition declares the binding; the Draft stays under the Simple Lifecycle; **no live workflow
  instance exists during Draft.**
- At Submit, the workflow instance is created and activated atomically, transferring status authority.
- **If creation/activation fails, the record does not become Submitted and no intermediate state
  occurs.**

## 8. Validation timing
- **On save (Draft):** light structural validation (types/formats of entered values); does not enforce
  full requiredness.
- **On Submit:** full validation of the version's contract (Required, cross-field, referential).
- **On stage transition:** Required-at-stage and stage-bound rules (e.g. a required "Verified By"
  relationship). A gate may block the transition until satisfied.
The single validation source (Field Engine) is server-authoritative and fail-closed at every point.

## 9. Editing vs new Revision vs record upgrade
- **Editing:** changing values within the same pinned version; may be captured as a Formal Instance
  Revision **only at a governed event** (§4). Never touches the Definition Version.
- **New Formal Revision:** an immutable content snapshot, with prior revisions preserved in full.
- **Record upgrade to a newer Definition Version:** an explicit, governed operation that maps values
  onto a newer contract **without erasing prior interpretation** — prior values, prior pinned version,
  mapping decisions, and audit are all preserved; it produces a new revision / upgrade snapshot under
  the newer contract.

## 10. History preservation
Every revision and upgrade preserves the prior values, the prior pinned version, mapping decisions,
and audit. No history is overwritten in place. The record is always interpretable as it was at any
point in time.

## 11. Every formal revision pinned to its historical contract

> **Every formal Instance Revision is pinned to the immutable Effective Definition Version under which
> that revision was created or interpreted.**

Instance Identity is permanent; the Instance has a current revision; each historical revision retains
its own values and its own Effective Definition Version; a record upgrade creates a new
revision/upgrade snapshot under a newer contract; **prior revisions' pins are never changed or
re-interpreted.**

## 12. Managed Reference Data snapshots

> **A formal Instance Revision preserves both the live reference identity and an immutable
> audit-relevant reference snapshot representing what was displayed and relied upon at that point in
> time.**

- The **reference source declares the minimum snapshot** it requires — not always just a display
  label — e.g. **display name, stable code, licence/reference number, revision designation**, per
  reference type.
- **Historical display relies on the snapshot** (what was shown/relied upon then).
- **Current navigation and querying may rely on the live reference** (the current entity).
- Later changes to the referenced entity **never rewrite the historical snapshot.**
- The full referenced entity is **not copied** without need — only the declared minimum snapshot.

This reconciles frozen historical interpretation (§6) with live Managed Reference Data (Field Engine).

## 13. Party access & permissions
The Instance is governed by the platform authorization substrate (`requireProjectAccess` for
project-scoped, the org-level path for org-scoped — §5; plus party ceiling and Party Policy v1), and
above it the Definition's object/field/surface permission matrix. **The Definition matrix only narrows;
it never exceeds the platform ceiling.** Parties touch only what an explicit capability grants.

## 14. Connection points (declared here, detailed in their own components)
- **Documents / Document Revisions** — referenced via References/relationships; a specific revision may
  be targeted.
- **Semantic Relationships** — the Instance is a node in the Relationship Engine (component 5 — points
  only here).
- **Workflow** — the Instance is the subject of the binding (component 6; §7a).
- **Audit** — every event (create / edit / revision / transition / delete / restore / upgrade) is an
  audit event.
- **Comments** — a shared comment service linked to the Instance.
- **Tasks** — workflow/operations may generate Tasks linked to the Instance (Tasks is a platform
  service).

## 15. Document-backed Business Object — no merged identity
Two records, two independent identities: the Instance owns the structured data, status, workflow,
relationships, and permissions; the Document owns the file, revisions, storage, and controlled
distribution; a **formal relationship** joins them (Official Rendition Of / Evidence For / Generated
From / Attached To). Neither becomes the other; no dual identity.

## 16. Reference numbering — three distinct concepts
- **Stable Record Reference Number** — the record's human/official identity; created via the
  Definition's Numbering Policy; **stable across revisions and upgrades**; **not** the database
  identity (§1).
- **Instance Revision Designation / Revision Code** — the record's revision marker (e.g. a resubmission
  designation).
- **Official Document / Rendition Number** — the number of a related official Document/rendition, if
  any.

These are kept separate so the business record's identity, the record's revision, and its official
file's revision are never conflated.

*(Assignment timing: the Stable Record Reference Number is a core slot but is assigned at Submit — or a
Definition-declared point — not at Draft creation, to avoid wasted numbers / sequence gaps. It stays
empty during Draft.)*

## 17. Soft Delete / Archive / Restore / Legal Hold — without erasing history
- **Soft Delete** — hidden from lists/operations; record, revisions, relationships, and audit remain;
  restorable.
- **Archive** — removed from active circulation; fully retained for read/audit.
- **Restore** — returns a soft-deleted/archived record to activity with no history loss.
- **Legal Hold — a governed preservation overlay:**

> **Legal Hold always prevents purge, destructive deletion, and loss or rewriting of historical
> evidence. Whether it also blocks content edits, lifecycle transitions, upgrades, or new attachments
> is determined by the applicable hold policy.**

None of these erase audit, revisions, or historical relationships.

## 18. Clone / Copy — what is and isn't copied
- **Copied:** copyable field values + the type (Definition) — as a **new Draft with a new identity.**
- **Not copied:** Instance Identity, Reference Number (newly generated), Status (starts fresh), prior
  Revisions/Audit, historical relationships (which relationships to re-establish is an explicit
  decision, never automatic), and any unique fields.
The copy is an independent record, not a continuation of the original.

## 19. Concurrency — preventing silent overwrite (conceptual)
**Optimistic concurrency:** every edit carries the version/stamp it was built on; on save, if the
record changed since it was read, the write is **rejected and reconciliation is made explicit** rather
than overwriting another's change. No silent last-write-wins.

## 20. What the Instance does NOT own (stays a Platform Service)
Workflow execution, the Relationship Engine, document bytes/revisions (DM), storage, audit,
notifications, search/indexing, numbering, the ListResponse contract, the rendering/print engine, the
comment service, the task service. The Instance **consumes** these and declares its needs to them.
