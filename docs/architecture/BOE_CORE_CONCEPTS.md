# BOE Core Concepts (Conceptual Model)

> **Purpose:** define *what the things are and how they relate* — before any table exists. This
> document contains **no tables, no SQL, no Drizzle, no schema, no technology**. It is the
> conceptual foundation the Data Model is built on. Data Model design begins only after this is
> approved.

---

## Governing principles

- **P1 — One Field Engine.** There is exactly **one** way to define a field in the whole system.
  Documents, Correspondence, and Business Objects all draw their fields from the same engine.
  *(Which existing mechanism becomes that engine — `metadata_fields` or a reorganization of it —
  is **not decided here**. `metadata_fields` is the **Primary Candidate**, confirmed only after
  this model is approved; we may reorganize it during Data Model design.)*
- **P2 — The Object Instance is the center.** We define the Instance first; Workflow,
  Relationships, and Surfaces **attach to it**. We never define a process first and hang an
  object off it.
- **P3 — A Relationship is a meaningful entity, not a link row.** Relationships have **semantic
  types with behavior** (Supports, References, Blocks, Generated From, Verified By, Supersedes…)
  — conceived as a **Relationship Engine** from the start, never a generic source/target table.
- **P4 — Strict Document ↔ Object boundary.** A Document and an Object Instance are **separate
  identities**. Neither becomes the other; **no record has a dual identity.** They are connected
  by an explicit, formal Relationship (see §6a), never merged.

---

## 1. What is a **Definition**?

A **Definition** is the **blueprint of a kind of Business Object** — the answer to *"what is an
NCR / Material Approval / RFI in this project?"*. It is **data, not code**.

A Definition declares:
- **Which Fields** the object has (drawn from the One Field Engine).
- **Which Relationships** it may have, and of what semantic types.
- **Whether and how it binds to a Workflow.**
- **Its four surfaces** — Input Form, Review Form, Register Columns, Print/PDF Template.
- **Its permissions** — who may create/read/edit/transition it, and field-level visibility.

A Definition is **layered and resolved** as **ArcScale Base → Organization → Project**, and is
**versioned**, so records created under an old version keep their original shape.

*Analogy:* a Definition is to an Object Instance what a blank official form plus its rules is to a
filled-in copy — but richer, because it also carries lifecycle, relationships, and permissions.

## 2. What is an **Object Instance**?

An **Object Instance** is **one concrete record** of a Definition — *this* Material Approval,
*that* NCR. It is **the unit of work** a person creates, fills, routes, reviews, and approves. Per
**P2, it is the center of the model.**

An Instance carries:
- **Its Field values** (the data entered for this record).
- **Its System Fields** — the immutable, engine-provided identity every object has: identity,
  organization, project, **status**, revision, who/when created, audit. These exist so the
  platform services can operate on any object uniformly.
- **Its Relationships** to other Instances, to Documents, and to Platform Entities.
- **Its current lifecycle state** (its status) — see §5 for who is authorized to change it.

Everything else in this model exists to describe, connect, process, or present an Object Instance.

## 3. What is a **Field**?

A **Field** is a **single piece of information** an object holds. A Field is defined **once, in the
One Field Engine**, and referenced by any Definition that needs it.

A Field has:
- **A meaning and a type** (text, number, date, choice, reference to another thing…).
- **Constraints** — required, validation rules.
- **Presentation** — label, the section it lives in, its order, and its visibility per surface and
  per role.

Two kinds of Fields:
- **System Fields** — provided by the engine, present on every object, **immutable / non-removable**
  (they are the interface the platform services depend on).
- **Definition Fields** — the customizable fields a Definition adds, per the Base → Org → Project
  layers.

**Field definitions belong to the Definition; Field values belong to the Instance.** Because of
**P1**, there is no second field mechanism — a Document's metadata field and a Business Object's
field are the same kind of thing from the same engine.

## 4. What is a **Relationship**?

A **Relationship** is a **first-class, meaningful, directional connection** between two
participants — Object ↔ Object, or Object ↔ Platform Entity (Document, Project, Entity). Per **P3,
it is a semantic entity, not a link row.**

Each Relationship has:
- **A semantic type that carries meaning and may drive behavior**, e.g.:
  - **Supports / References** — evidence or context (an object cites a Document).
  - **Blocks** — one object prevents another's progress/closure.
  - **Generated From** — lineage (this NCR was generated from that Inspection).
  - **Verified By** — one object's validity depends on another (can gate a workflow stage).
  - **Supersedes** — one object deprecates/replaces another.
- **A direction** (source → target) — "Blocks" and "Blocked-by" are not the same.
- **A place in the Definition** — each Definition declares which relationship types it may
  participate in, and with what cardinality.

Conceptually this is a **Relationship Engine**: it gives objects *meaning-in-context* —
traceability, impact/blocking, verification, lineage, supersession — the questions a bag of
attachments can never answer.

## 5. What is a **Workflow Binding**?

A **Workflow Binding** attaches a process to an Object Instance. Per **P2**:

> **The Object Instance is the subject of the Workflow Binding. The workflow operates on it and
> becomes the authoritative driver of lifecycle transitions when bound.**

The Instance already exists and already owns a **status** (a System Field). A Workflow, when bound,
is what **advances that status** through stages, approvals, and transitions.

**Status contract (explicit):**
- **Without a Workflow:** a **Simple Lifecycle** manages the status (the engine sets it directly).
- **With a Workflow:** the **Workflow is the authoritative source of status transitions.**
- **There is no parallel Status Engine, and no direct status change that bypasses the bound
  Workflow.** One status concept, one authority at a time.

Workflow stages may **read the object's Fields and Relationships** (e.g., a stage requires certain
fields filled, or a "Verified By" relationship present, before it can advance).

## 6. What is a **Document**?

A **Document** is a **Platform Entity** — a managed, controlled file with revisions and controlled
distribution. Per **P4, a Document is never a Business Object and never carries a dual identity.**
Its roles are:
- **A Relationship target** — Object Instances reference/attach Documents, and may reference **a
  specific Document Revision** (not just the document), so an object can point at "Drawing Rev C"
  precisely.
- **A consumer of the One Field Engine** — a Document's own classification metadata is defined by
  the *same* field engine (P1), so Documents and Business Objects share one field vocabulary.

Documents provide the **evidence / file layer** that Objects point to; Objects provide the
**records / process layer** that reference Documents.

### 6a. **Document-backed Business Object**

A Business Object may be **represented by, or produce, an official Document** — without either
losing its own identity (P4). This is a **Document-backed Business Object**: two separate records
joined by a formal Relationship.

- **The Object Instance owns:** the structured data, the status, the workflow, the relationships,
  and the permissions.
- **The Document owns:** the file, the revisions, the storage, and the controlled distribution.
- **The formal Relationship between them** is one of the semantic types, e.g.:
  - **Official Rendition Of** — the Document is the official/printed form of the Object.
  - **Evidence For** — the Document supports/evidences the Object.
  - **Generated From** — the Document (e.g. a PDF) was generated from the Object.
  - **Attached To** — the Document is attached to the Object.
- The Object may reference **a Document** or **a specific Document Revision**.

**Examples:**
- **Material Approval** = Business Object; its official PDF and datasheets = related **Documents**.
- **NCR** = Business Object; the official NCR report and site photos = related **Documents**.
- **Letter** = Business Object; the signed/official PDF copy = a related **Document**.
- **Drawing** = **Specialized Document** (a Platform Entity), **not** a Business Object.

## 7. How they interact (the whole picture in one narrative)

- A **Definition** describes a kind of object. Using the **One Field Engine** it declares its
  **Fields**; it declares the **Relationship** types it may have; it may declare a **Workflow
  Binding**; it declares its four surfaces and permissions — all resolved **Base → Org → Project**,
  and **versioned**.
- An **Object Instance** is created from a Definition. It holds **Field values** and the immutable
  **System Fields** (including **status**). It is the center.
- The Instance participates in **Relationships** — typed, directional, behavioral edges — to
  **Documents** (a document or a specific revision, including the Document-backed relationship of
  §6a), to **Platform Entities** (Projects, external Entities), and to **other Instances**. These
  edges are the **Relationship Engine**.
- If the Definition has a **Workflow Binding**, the Instance is the **subject** of that binding and
  the bound Workflow is the **authoritative driver** of its status transitions; without a binding, a
  **Simple Lifecycle** manages status. Never both, never a bypass.
- **Documents** sit at the edges: referenced by Instances as evidence or official renditions, and
  themselves described by the **same Field Engine** — one field vocabulary across the platform, with
  a **strict identity boundary** between an Object and a Document.

---

## Pinned decisions embedded in this model
1. **`metadata_fields` = Primary Candidate for the One Field Engine, NOT locked.** Confirmed only
   after this conceptual model is approved; may be reorganized during Data Model design.
2. **Workflow is generalized, but defined *after* the Object Instance.** The Instance is the
   subject; the bound Workflow is the authoritative driver of status transitions (P2, §5).
3. **Relationships are a Relationship Engine of semantic, behavioral types — never a generic
   source/target link table** (P3).
4. **Strict Document ↔ Object boundary** — separate identities, joined by a formal Relationship;
   **Document-backed Business Object** is the sanctioned pattern, **not** a dual identity (P4, §6a).
5. **One Field Engine** is the governing rule (P1); the concrete engine is chosen in the next phase.

---

## Boundaries carried into Data Model design
- Independent identity for the **Object Instance**.
- Independent identity for the **Document**.
- A clear **formal relationship** between them instead of a dual identity.
- **One Field Engine**, with `metadata_fields` a **Primary Candidate, not a final decision**.
