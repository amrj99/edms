# BOE — One Field Engine (Conceptual)

> **Purpose:** define the single mechanism and contract for defining fields across the platform —
> serving Documents, Correspondence, and Business Objects with **one** field engine, never three
> competing definition stores. **No tables, no columns, no SQL, no technology.** Component design
> only; nothing here authorizes schema, migration, ADR, or code.
>
> **Not decided here:** the technical fate of `metadata_fields`. Option (2) — reorganize it into a
> Shared Field Engine — remains the strongest candidate, but the final decision comes **after** the
> Relationship Engine and the Object Instance Model (References depend on the former).

---

## 0. What "One Field Engine" means (and does not)

> **One Field Engine means one mechanism and one contract for defining fields across the platform;
> it does not mean every field must belong to one global shared vocabulary.**

The engine supports two ownership scopes for a field, both using the same engine:
- **Shared Field Identity** — a field with a unified, reusable meaning (e.g. "Discipline"), reusable
  across Definitions.
- **Definition-local Field Identity** — a field that belongs to a single Definition.

**Local fields create no coupling with other Definitions.** Reuse is **explicit, never automatic** —
two fields are never merged just because they share a name or type.

## 1. What is a Field Definition?

A **reusable definition of a field**: a semantic description of a piece of information (meaning, type,
constraints, presentation), living in the one field engine that serves all object kinds. A Definition
**consumes** a field; it does not own the field's intrinsic contract.

## 2. Field Identity vs Field Version vs Field Configuration

Three explicit layers, to avoid conflation:
- **Field Identity** — the field as a stable concept (e.g. "Discipline"); a stable key. May be
  **Shared** or **Definition-local** (§0).
- **Field Version** — a frozen snapshot of the field's **intrinsic contract** (type, base constraints,
  values it owns as a Closed Option Set — §7). Immutable once published; an intrinsic change creates a
  new Field Version.
- **Field Configuration** — **how a field is used inside one Definition**: local label, section,
  order, Required/Visible/Editable per surface/role/stage, a narrowed value subset. Configuration is
  about usage, not the field.

**Rule:** changing the **Field Version** (the intrinsic contract) is the engine's concern; changing
the **Configuration** is the concern of the Definition that uses it.

## 3. Reusing a field across Definitions without unwanted coupling

Via §2: several Definitions **reference the same Shared Field Identity** but each owns its own
**Configuration**. They share meaning/type (unifying reporting and search) without any of them
imposing its display or requiredness on the others. Definition-local fields share nothing. Reuse is
explicit.

## 4. Does changing a shared field affect all Definitions, or need a new version?

- Changing **Configuration** (label/section/required within a Definition) → affects that Definition
  only.
- Changing the **field's intrinsic contract** (type, a base constraint) → a **new Field Version**;
  Definitions are **not** auto-upgraded — they adopt a newer Field Version through governed
  **Rebase/Merge** (same "no live mutation" principle). Old records stay pinned to the Effective
  Version they were created under.

## 5. Base field types

Text · Number · Date/DateTime · Boolean · Single-Select · Multi-Select · **Reference** (§6).
*(Computed/Derived = §11. Richer types are a future declared Extension that does not break the
contract.)*

## 6. Reference fields — and the split from Semantic Relationships

A **Reference** is a field type pointing to another entity, with rules the field declares
(allowed target: Document / Document Revision / Entity / Business Object Instance; cardinality).

> **Reference Value:** a structured value pointing to a Document, Entity, or Object Instance for
> input, filtering, and display purposes.
>
> **Semantic Relationship:** an independent relationship entity with a type, direction, and behavior
> (e.g. Blocks, Verified By, Supersedes).

**A Reference field is NOT automatically executed as a Relationship.** A Definition **may explicitly
declare** that a particular Reference **creates or requires** a Semantic Relationship — but that is an
explicit decision, **not** the default behavior of every Reference. (The Relationship Engine — the
next-but-one component — owns semantic relationships.)

## 7. Closed Options vs Managed Reference Data

Two distinct kinds of "list", explicitly separated:
- **Closed Option Set** — a **fixed part of the field's contract**, exported and **frozen with the
  Field Version** (e.g. a small fixed status vocabulary owned by the field).
- **Managed Reference Data Source** — a **live list managed by the organization or project** (e.g.
  Vendors, Disciplines, Locations, Packages). A field of this kind **points to the data source**; it
  does **not** copy all its values into the Field Version each time the list changes.

This keeps live business lists out of frozen field versions, while still freezing genuinely-contractual
option sets.

## 8. Validation & conditional rules

- **Field-level constraints:** type, range/length, pattern (regex), value-from-set.
- **Contextual requiredness:** Required by role / status / stage (not necessarily absolute).
- **Cross-field conditional rules:** show/require a field based on another's value (e.g. "rejection
  reason" required when status = rejected).
- **One validation source** consumed by both the renderer (FE) and the service (BE); the service is
  authoritative and fail-closed. Same mechanism for Documents, Correspondence, and Business Objects.

## 9. Section / order / display — field-intrinsic vs per-Surface

- **Field-intrinsic:** meaning, type, base constraints, field-owned Closed Option Sets.
- **Configuration (within a Definition):** section, order, local label.
- **Per-Surface:** what appears on **Input** vs **Review** vs **Register** vs **Print** — a field may
  show in Register and hide in Print, or be locked in Review. **A field's display is not singular; it
  is per surface.**

## 10. Required / Visible / Editable by role, status, and stage

An independent triple resolved per field within a context (Role × Status/Stage × Surface): a field can
be Visible-not-Editable for a reviewer at one stage, Required-Editable for the author at another. The
engine **declares** the rule; enforcement applies it; the platform **permission ceiling stays above it**
(a field never widens authority).

## 11. Computed & derived fields

Fields whose **value is derived** from other fields/relationships by a declared rule (e.g. days
overdue, sum of line items). **Read-only, never entered manually.** v1: simple deterministic
derivations; complex/cross-object formulas are a future declared Extension (added later without
breaking the contract).

## 12. Translation (AR/EN) of labels and options

Every **label and every option value** carries translations (AR/EN at minimum); display picks by the
user's language. **The meaning/key is stable; translation is a presentation layer** — consistent with
the existing i18n system. (Official/legal text keeps its own policy.)

## 13. One engine for Documents, Correspondence, and Business Objects — no three competing stores

**One field-definition mechanism** + **one binding mechanism** (Field Configuration inside any
Definition — whether a document type, a correspondence type, or a Business Object). "Dynamic Forms" is
the **renderer** of this engine, not a second store. This is the Discovery rule that prevents the three
competing field layers (Document Metadata / BOE Fields / Dynamic Forms).

## 14. Preserving old records when a field definition changes

A record is pinned to its **Effective Definition Version** (which contains the field contract as it
was). A later field change does not re-interpret the old record; it is displayed and validated by its
version. Field Versions are retained as an interpretive reference (like Definition versions).

## 15. What stays a System Field (outside the dynamic field engine)

Identity · Organization · Project · Definition + Version · Reference Number · Status · Revision ·
Created By/At · Updated At · Lifecycle/archival. These are **not** Field Definitions; the core engine
imposes them and they stay outside the dynamic field layer.

## 16. Base → Organization → Project for fields, respecting the Customization Envelope

Fields follow the same three-layer inheritance: Base places the field plus an **envelope**
(`Locked` / `Override-allowed` / `Extension-point` per attribute: label / section / required / values /
visibility); Org then Project **add or adjust only where permitted**; authorization ceilings and
System Fields are always `Locked`; the result is frozen into the Effective Version (no runtime
re-resolution).

## 17. Versioning rules — to prevent version explosion

- **A new Field Version** is created only when the field's **meaning, type, or a base intrinsic
  constraint** changes.
- **Changing label, section, order, or surface visibility inside a Definition** creates a **new
  Definition Version only — not a new Field Version.**
- **The Effective Definition Version is the final historical reference**, containing the resolved
  contract of the fields **and the Configurations** in use.
- **Displaying and validating an old Instance never re-composes Field Versions at runtime.**

## 18. Engine boundaries

The engine **declares rules only**; it does not contain: **Workflow execution** (it declares
Required-at-stage; execution is the Workflow's), **Permission ceiling** (it declares Visible/Editable;
the ceiling is the platform's), **Rendering engine** (it declares section/order/display; drawing is the
rendering/print service's), or **Relationship execution** (it declares References; semantic
relationships are the Relationship Engine's — §6). These services consume the field's declarations.

---

## `metadata_fields` — comparison recorded, NOT decided

| Option | Meaning | Fit to this model |
|--------|---------|-------------------|
| (1) Extend current `metadata_fields` | add what's missing to the existing table | 🟠 partial — lacks explicit Identity/Version/Configuration separation (§2) |
| **(2) Reorganize into a shared Field Engine** | restructure to separate Identity/Version/Configuration and generalize to all kinds | 🟢 highest fit; keeps proven `appliesTo` + validation runtime; needs a compatibility bridge, no big-bang |
| (3) Replace with a new primitive + migration | new engine from scratch | 🔴 highest risk/cost; live-data migration; violates "build alongside, no big-bang" |

**Not decided here.** Option (2) is the strongest candidate; the final technical decision comes **after
the Relationship Engine and the Object Instance Model.**

---

## Deferred / dependent
- Reference execution as Semantic Relationships → Relationship Engine (component 5).
- Concrete representation of Field Identity/Version/Configuration and Managed Reference Data → Data Model.
