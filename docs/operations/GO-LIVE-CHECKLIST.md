# Go-Live Checklist — ArcScale EDMS (FROZEN until first-customer deploy)

> **Status:** FROZEN. These are **operational prerequisites executed on the day we decide to
> deploy for the first real customer** — not development work to do now. They are recorded
> here so nothing is forgotten at Go-Live, and deliberately deferred so we don't spend dev
> time on steps that may need redoing if launch slips.
>
> Fable review & remediation is considered **complete** (see the remediation history). The
> only thing standing between the codebase and production is this operational gate.

## Pre-Go-Live operational requirements (execute at launch, in order)

1. **Secret Escrow review & population** — complete the bracketed fields in
   `SECRET-RECOVERY-PACKAGE.md`, put every T1/T2 (and T3) value into the encrypted escrow,
   assign owner + backup custodian, and record **Last verified**. Confirm every key is
   present and decryptable.

2. **Real Restore Drill (isolated)** — run `restore-verify.sh` against the **latest real R2
   dump** into an **isolated** container/DB (never production). Verify: core-table row
   counts, `document_files` reachability, tenant-isolation on a two-org sample, and the
   **actual restore duration**. Write a real entry to `RESTORE-LOG.md` (date, dump used,
   results, gaps, measured RTO). If any part fails → stop, root-cause, fix, re-drill.

3. **Migration 0032 Production Gate** — the six-step gate in
   `docs/migrations/0032-backfill-document-files-org.md`: production read-only B1/B2/B3/D/E
   classification → shadow → pre-image artifact bound to prod DB identity → verify
   artifact count == B1 → confirm a fresh `pg_dump` exists → execute → post-execution
   verification. Owner assembles/approves the execution package; nothing runs without
   explicit owner approval.

4. **Lift the Production Deployment Hold** — only by **explicit owner approval** after
   steps 1–3 pass. Until then every merge to `main` carries `[skip deploy]`.

5. **Declare Production Ready v1** — final go/no-go once 1–4 are green and a post-deploy
   verification (health + smoke + rollback rehearsal) is confirmed.

## Freeze rules
- Do **not** spend development time on items 1–5 until we decide to launch.
- Do **not** run any production-changing operation or lift the Hold without the owner's
  explicit, per-step gate.
- Restore Drill and 0032 classification require production/R2 access the dev environment
  does not have — they are **owner-run** (or owner-granted sandbox), by design.

## What is NOT blocked by this freeze
Product development continues (next: Business Object / Dynamic Forms Engine — design first,
no code until approved). Scale/perf items (B-2/B-5/B-6/B-7) remain deferred and are
sequenced by the first customer's real size, not automatically.
