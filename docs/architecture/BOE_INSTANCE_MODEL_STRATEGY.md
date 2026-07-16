# BOE Instance Model — Strategy (Hybrid)

> **Purpose:** fix the strategic decision for how a Business Object Instance is identified and how
> its values are stored. This is a **strategy document only** — **no tables, no columns, no schema,
> no SQL, no code.** It sets the constraints the Data Model must satisfy. Component design (Definition,
> Field Engine, Relationships, Workflow binding, Document-backed relation, projection strategy)
> follows, one component at a time, after this is approved.

---

## Decision (fixed)

> **ArcScale BOE adopts a Hybrid Instance Model: a fixed tenant-safe instance core, version-pinned
> dynamic definition values, and policy-driven query/index projections for selected hot fields,
> without runtime schema creation.**

Rationale (from the alternatives comparison): the Hybrid model is the only option that delivers
unified tenant isolation, DDL-free customization, easy definition versioning, and a unified subject
for Workflow/Relationships — while restoring register/reporting performance through projections and
**avoiding the highest risk, runtime DDL / schema drift** (the class of failure behind the
2026-05-08 restart-loop). It also extends a pattern ArcScale already runs in production
(`documents.metadata` value blob + server-side paginated registers), rather than inventing a new one.

---

## Constraint 1 — Core System Fields live in the fixed instance core

A set of **system fields is part of the instance core** — fixed, tenant-safe, and **never stored as
dynamic definition values**, because isolation, permissions, Workflow, Registers, and audit all
depend on them being reliably present and queryable. Conceptually they include:

- **Identity** (the instance's own identity).
- **Organization** and **Project** (the tenancy coordinates).
- **Definition** and **Definition Version** (which blueprint, and which version this instance is
  pinned to).
- **Reference Number** (the human/official identifier).
- **Status** (the lifecycle state — see the Workflow status contract in BOE Core Concepts).
- **Revision.**
- **Created By / Created At / Updated At.**
- **Lifecycle / archival fields** when needed (e.g. soft-delete / retention markers).

These are the interface the platform services operate through; a Definition can never move them into
the dynamic layer or remove them.

## Constraint 2 — Dynamic Definition Values

All fields specific to a **form, an organization, or a project** remain **dynamic values governed by
the Definition**. Adding, removing, or reordering such a field produces **no DDL and no separate
table** — it is a change to the Definition, not to the database shape.

## Constraint 3 — What "Promotion" means

> **Promotion means making a field efficiently queryable, sortable, filterable, or reportable through
> an approved indexing or projection strategy; it does not automatically mean adding a physical
> column.**

**Future implementation options, in preference order:**
1. **JSONB / expression indexing** — index the value in place.
2. **Query projection or search projection** — project selected fields into a queryable/derived form.
3. **External / search index** — when scale or search semantics require it.
4. **Physical column via a governed migration** — only in exceptional, performance-proven cases.

**Hard rules:** **no runtime DDL**, and **no per-organization or per-project schema.** Promotion is a
policy-driven capability, chosen per hot field by evidence, never an automatic column-per-field.

## Constraint 4 — No migration of current modules now

The existing **NCR / MIR / WIR** (and other hand-coded modules) are **not migrated now**. The correct
approach:

1. **Build BOE alongside** the current modules.
2. **Prove it** with a new Business Object or a limited **Pilot**.
3. **Then evaluate migrating each module individually.**
4. **No big-bang migration, and no permanent duplication** — migration is a later, per-module,
   evidence-based decision.

## Constraint 5 — This decision is architectural, not implementation

This document fixes **strategy and constraints only**. It authorizes **no** schema, migration, ADR,
or code. Component design proceeds conceptually first.

---

## What comes next (conceptual component design, one at a time)

After this strategy is approved, we design these components on paper, each approved before the next,
still with no schema/migration/code until explicitly authorized:

1. **Definition model.**
2. **Definition Versioning and inheritance** (Base → Org → Project).
3. **One Field Engine.**
4. **Object Instance model.**
5. **Relationship Engine.**
6. **Workflow subject binding.**
7. **Document-backed Business Object relation.**
8. **Register / query projection strategy.**
