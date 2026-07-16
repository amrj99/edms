# BOE Definition Versioning & Inheritance (Conceptual)

> **Purpose:** define how Definition versions are published/frozen, how `Base → Organization →
> Project` inheritance resolves, and how customization never breaks system contracts. **No tables,
> no columns, no SQL, no technology.** Component design only; nothing here authorizes schema,
> migration, ADR, or code.

---

## Governing principle (fixed above everything below)

> **Inheritance must not mean live mutation of published definitions.**

Changing a Base or Organization definition never automatically alters a published version in use by a
project or by existing Instances. Any sync or upgrade is **explicit, reviewable, and captured as a new
version** — never a live change.

---

## 1. Version lifecycle
- **Draft** — editable; creates no Instances; not visible in production.
- **Published** — **immutable/frozen**; can create Instances; visible.
- **Superseded** — a previously published version for which a newer published version now exists.
- **Withdrawn** — a published version pulled from use; no new Instances; existing Instances continue
  (no forced freeze, consistent with Retired semantics).

## 2. When a version becomes immutable
**At the Draft → Published transition.** After that, no part of its contract (fields / rules /
surfaces / permissions / relationships / numbering) is ever edited in place. Immutability is what
gives an Instance's version pin a trustworthy historical meaning.

## 3. Creating a new version from a published version
Via **New Draft from Published**: the published version is copied into a new editable **Draft**; the
change is made on the Draft; **Publish** then produces a new published version and moves the previous
one to **Superseded**. The original published version is **never touched** — the Instances created
under it keep their contract.

## 4. Definition identity vs multiple versions
One stable identity (Active / Deprecated / Retired) **owns an ordered chain of versions**. The
identity is "NCR as a type"; the versions are snapshots of its contract over time. An Instance refers
to (the identity + its pinned version).

## 5. Base → Organization → Project
Three **definition layers**, each with its own independently published versions:
- **Base** (ArcScale) — the standard reference template for the type.
- **Organization** — the company's customization above Base.
- **Project** — the project's customization above the Organization version.

The **effective version** for a project is the resolution across the three layers (§10). Each layer
publishes its versions independently and under governance.

## 6. Override / Extension / Fork
- **Extension** — a lower layer **adds** (a field / section / relationship rule / list value) without
  touching what it inherited. Lowest risk.
- **Override** — a lower layer **adjusts an inherited element where the parent's customization
  envelope explicitly permits it** (see §7). It never removes a system element or widens authority.
- **Fork** — a lower layer **leaves the inheritance chain** (see §6a).

### 6a. Fork = Independent Lineage

> **A Fork creates an independent definition lineage derived from a known source version. It retains
> origin/lineage metadata for traceability, but no longer participates in automatic inheritance or
> upgrade proposals from the original chain.**

A Fork is never left in an ambiguous middle state between an Override and a standalone definition: it
is a clean, independent version chain that keeps origin metadata for audit but receives no automatic
Base/Org upgrades. *(Whether a Fork keeps the same semantic object type or takes a new Definition
identity is decided in the Data Model; conceptually it has an independent version chain.)*

## 7. The customization envelope (per element)

> **The parent layer declares a permitted customization envelope. A child may relax, tighten,
> relabel, reorder, or extend only where that envelope explicitly permits it; authorization ceilings
> and System Fields can never be relaxed.**

There is **no absolute "tighten-only" rule.** Each element in the parent contract carries an explicit
customization policy — e.g. `Locked`, `Override-allowed (with the allowed adjustments)`,
`Extension-point`. A Base may, for instance, make a field Required by default **and explicitly allow
the Organization to relax it to optional**; whether relaxing is permitted is decided by the parent
element's policy, not by a blanket rule. **Authorization ceilings and System Fields are always
`Locked` and can never be relaxed by any layer.**

## 8. What can be changed at each layer
- **Base:** sets the ground contract and declares each element's customization envelope.
- **Organization:** Extension + Override **within the envelope Base declared**.
- **Project:** Extension + Override **within the envelope the Organization declared**.
Each layer acts only inside the envelope it was granted; none widens authorization or breaks the
parent contract.

## 9. What can never be overridden or removed
System Fields, the tenant-isolation contract, the authorization substrate and its ceilings, status
ownership (Workflow / Simple), and any element the parent declares `Locked`. A lower layer neither
removes nor bypasses these; attempts fail closed (§11).

## 10. Effective Definition Version — resolved once, then frozen

> **Resolution produces an immutable, published Effective Definition Version. Every new Object
> Instance is pinned directly to that effective version, which contains the fully resolved contract
> used at creation time.**

Resolution composes **Base(published) → Organization(published) → Project(published)**, enforcing each
element's customization envelope (§7), and yields an **immutable, published Effective Definition
Version**. Key consequences:
- **The Effective Version is the final historical reference** — even if the merge algorithm or the
  Override rules later change, an Instance's interpretation does not.
- **Instance display and validation never re-resolve at runtime.** They read the pinned Effective
  Version's fully-resolved contract.
- The Effective Version **may retain references to its contributing Base/Org/Project versions** for
  **lineage and audit**, but those references are informational — they are not re-merged to interpret
  the Instance.

## 11. Preventing a project customization from breaking an org/System contract
- Every contract element carries a parent-declared customization policy (`Locked` /
  `Override-allowed` / `Extension-point`) — §7.
- A lower layer is applied **only** within those policies; any attempt to override a `Locked` element,
  relax a ceiling, or touch a System Field is **rejected at resolution (fail-closed)** — never applied
  silently.
- System Fields and authorization ceilings are globally fixed above all layers.

## 12. When the Base template changes after customizations exist
Nothing automatic (the governing principle): publishing a new Base does **not** alter published
Org/Project versions or any Instances. Lower layers only see an **available upgrade** offer.

## 13. Automatic propagation vs governed Rebase/Merge
**Governed and explicit Rebase/Merge — never live propagation.** When a newer Base/Org is available, a
lower layer creates a **new Draft** that merges the parent's changes with its own customizations
(surfacing conflicts — e.g. a field removed upstream but customized downstream), is reviewed, and is
then **published as a new version**. No live change reaches existing published versions or Instances.

## 14. Instance creation policy
- **Published / current effective version:** creation of Instances is allowed.
- **Superseded:** creating new Instances is **not allowed by default**.
- **Existing Instances continue normally** regardless.
- **Any exception** to create a record from a Superseded (or otherwise non-current) version requires an
  **explicit, audited operational policy.**
- No Instance is ever created from a Draft or a Withdrawn version.
- Every Instance is pinned to the Effective Version in force at creation time.

## 15. Upgrading an old Instance to a newer version — history-preserving

> **Instance upgrade never overwrites its historical interpretation in place. It creates a governed
> new instance revision or upgrade snapshot, while preserving the prior values, prior pinned
> definition version, mapping decisions, and audit history.**

Upgrade is **optional, explicit, and governed** (never automatic). The record's identity may continue,
but its prior history is not erased: the previous values, the previously pinned version, the explicit
field mapping decisions, and the audit trail are all preserved.

## 16. When upgrade is prevented (fail-closed)
- **Data loss** — a field required by the target version has no acceptable source/mapping.
- **Workflow conflict** — an in-flight status/stage does not permit reshaping.
- **Target not eligible** — the target version is Withdrawn, or an operational policy / Legal Hold
  forbids reshaping the record.
A prevented upgrade **fails closed and is explained** — never partially applied.

## 17. Preserving audit & historical interpretation
- Every Instance carries its **pinned Effective Version**; it is always displayed and interpreted by
  that version's contract, even as the type evolves.
- **Published versions (and Effective Versions) are retained permanently** (immutable) because they
  are the interpretive reference for the records created under them.
- Every publish / supersede / withdraw / Instance upgrade is a **documented audit event** (from/to
  version, by whom, when), with mapping decisions retained for upgrades.

---

## The governing principle (restated, fixed)
> **Inheritance must not mean live mutation of published definitions.** Changing Base or Organization
> never automatically alters a published version used by a project or Instances; any sync/upgrade is
> explicit, reviewable, and captured as a new version.

## Deferred to Data Model (noted, not decided here)
- Whether a Fork keeps the same semantic object type or takes a new Definition identity.
- The concrete representation of Effective Versions, lineage references, and instance upgrade
  snapshots.
