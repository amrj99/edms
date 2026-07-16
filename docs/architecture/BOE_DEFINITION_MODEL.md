# BOE Definition Model (Conceptual)

> **Purpose:** define what a **Definition** is, conceptually. A Definition is **not** a form
> template — it is **the complete contract for a kind of Business Object**. This document contains
> **no tables, no columns, no SQL, no technology.** It is the conceptual foundation for the
> Definition. `Base → Org → Project` inheritance and detailed version transitions are **out of scope
> here** — they are the next component (Definition Versioning & Inheritance).

---

## 1. Identity & purpose

A **Definition** is a **data object (not code)** that defines a *kind* of Business Object. Its purpose
is to make adding a new object type (Material Approval, NCR, WIR…) a **managed definition**, not a
hand-coded feature. The Definition is **the contract** every Instance of its type obeys: what it
carries, how it validates, how it moves, who may see it, and how it is presented, printed, and numbered.

## 2. Definition vs Definition Version

- **Definition** = the **stable identity** of the type (e.g. "NCR"); it lives over time.
- **Definition Version** = a **frozen snapshot** of the contract (fields / rules / surfaces / …) at a
  moment of publication.
- Every **Instance is pinned to the Definition Version** it was created under → historical records
  keep their original shape even as the type evolves.

> **A published Definition Version is immutable. Any change creates a new Draft Version; a published
> version is never edited in place.**

(Version transition details — publishing, superseding, upgrading — are the next component.)

## 3. System Fields the engine imposes

Fixed fields the engine injects on **every** Instance, non-removable and never moved to the dynamic
layer (they are the interface for isolation / permissions / Workflow / Registers / audit):
Identity · Organization · Project · Definition + Version · Reference Number · Status · Revision ·
Created By/At · Updated At · Lifecycle/archival. **The Definition consumes them; it does not define
or remove them.**

## 4. Definition Fields & sections

The type-specific fields (drawn from the **One Field Engine**): each field has meaning / type /
constraints / presentation, organized into **Sections** with order. This is the customizable layer
(add / remove / reorder / required / validation) — with **no DDL**.

## 5. Simple Lifecycle (when there is no Workflow)

If the Definition binds no Workflow, it defines a **Simple Lifecycle** for its status (a set of states
and transitions the engine manages directly). This is the authoritative source of status **in the
absence of** a Workflow.

## 6. Workflow Binding (when present)

A Definition may declare a **Workflow Binding**; then the Workflow becomes the **authoritative driver
of status transitions**, and the Instance is the **subject** of that binding (per BOE Core Concepts).
With a Workflow bound, there is no Simple Lifecycle and no direct status change that bypasses it.
(Binding details = component 6.)

## 7. Allowed relationship types & rules

The Definition declares **which semantic relationship types** its objects may participate in
(Supports / References / Blocks / Generated From / Verified By / Supersedes / Official Rendition Of…),
with **direction, cardinality rules, and allowed targets** (Objects / Documents / Entities). The
engine forbids any relationship not declared. (Relationship Engine details = component 5.)

## 8. Permission Model (object / field / surface)

The Definition carries a permission matrix at **three levels**:
- **Object:** who may create / read / edit / transition.
- **Field:** visibility / editability of a given field by role and stage.
- **Surface:** what is shown on Input vs Review vs Register vs Print, per role.

It is built on the platform authorization substrate (`requireProjectAccess` + party ceiling) and
respects Party Policy v1 (explicit capability, never a permissive default).

> **Definition permissions may restrict access further, but can never grant access beyond the
> platform's tenant, project, party, role, or authorization ceilings.**

A Definition can only **narrow** access; it can never override `requireProjectAccess`, Party Policy,
or organization boundaries.

## 9. The four surfaces

The Definition defines **four surfaces** (rendered by the platform rendering/print service):
**Input Form** · **Review Form** (show/hide/lock fields by role & stage) · **Register View**
(columns / filters / sort in the list) · **Print / PDF** (the company's official form).

## 10. Numbering Policy

The Definition declares a **numbering policy** for its objects' Reference Number (pattern, scope —
system / org / project, sequence), executed by the platform numbering service; the engine does not
re-invent numbering.

## 11. Lifecycle — separated: Definition identity vs Definition Version

**Definition identity lifecycle** (the stable type):
- **Active** — the type is in use; its published versions can create Instances.
- **Deprecated** — discouraged; existing versions/Instances continue, new adoption is steered away.
- **Retired** — end-of-life for the type (see §12 for the precise, non-freezing meaning).

**Definition Version lifecycle** (each snapshot):
- **Draft** — under authoring; cannot create Instances.
- **Published** — active and **immutable**; can create Instances.
- **Superseded** — a newer published version exists; typically no new Instances, existing continue.
- **Withdrawn** — a published version pulled from use (if needed), existing Instances continue.

(Exact transitions between these states are the next component.)

## 12. Retiring a Definition — precise meaning

> **Retiring a Definition prevents new Instances and new Versions, but does not automatically freeze
> or terminate existing Instances. Existing Instances remain pinned to their Definition Version and
> continue through their valid lifecycle until completion, unless a separate governed operational
> policy explicitly says otherwise.**

Retiring a type must never silently disable open, in-flight records.

## 13. What happens to old Instances when a new Version is issued

Nothing is forced on them: each Instance stays **pinned to its version** and is presented/validated by
that version's contract. A new version governs **new Instances only**. (Optional upgrade / migration
policies = the next component.)

## 14. Customizable vs protected

- **Customizable:** Definition Fields, Sections, the four Surfaces, allowed relationship rules, the
  permission matrix (narrowing only), numbering policy, Workflow binding, the Simple Lifecycle.
- **Protected (untouchable):** System Fields, the tenant-isolation contract, the authorization
  substrate and its ceilings, status ownership (Workflow or Simple only), version pinning.

## 15. Boundaries — what the Definition does NOT own (stays a Platform Service)

The Definition **declares and consumes**, but never owns or rebuilds: Workflow execution, the
Relationship Engine itself, document bytes/revisions (DM), storage, audit, notifications,
search/indexing, numbering, the ListResponse contract, and the rendering/print engine.

---

## Deferred (by intent)
**Base → Organization → Project inheritance** is **not** detailed here — it is the next component
(**Definition Versioning & Inheritance**), which will settle: version publishing & freezing;
supersession; Base → Org → Project; what is an **Override** vs a **Fork**; how customization is
prevented from breaking system contracts; the policy for creating Instances from published versions;
and optional upgrade of old records.
