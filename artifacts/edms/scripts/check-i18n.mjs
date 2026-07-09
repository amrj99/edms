#!/usr/bin/env node
/**
 * check-i18n.mjs — Phase 8A-5 hardcoded-text guard (warn-only)
 *
 * Zero-dependency static advisory. Flags likely hardcoded UI strings so new
 * ones don't creep in while Phase 8B translation is in progress.
 *
 * DESIGN CONSTRAINTS (locked by product owner):
 *   - Warn only. ALWAYS exits 0 in default mode — never fails build, tests, or CI.
 *   - Does not touch source, translations, or UI. Read-only.
 *   - Ratchet via baseline: legacy findings are recorded in i18n-baseline.json
 *     and stay silent; only NEW/increased findings per file are surfaced.
 *
 * Two problems detected (per the audit):
 *   1. Hardcoded LATIN UI text outside t()  — the main gap.
 *   2. Hardcoded ARABIC text outside dictionaries/ — the reverse gap
 *      (e.g. admin.tsx AI section shows Arabic even to English users).
 *
 * Usage:
 *   node scripts/check-i18n.mjs            # warn against baseline, exit 0
 *   node scripts/check-i18n.mjs --update   # rewrite baseline to current state
 *   node scripts/check-i18n.mjs --all      # list every finding (ignore baseline)
 *
 * Heuristic, not a compiler. False positives are expected and acceptable for a
 * warn-only advisory; when in doubt it is better to nudge toward t().
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "src");
const BASELINE = join(__dirname, "i18n-baseline.json");
const EDMS = join(__dirname, "..");

const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const ALL = args.has("--all");

const ARABIC = /[؀-ۿݐ-ݿ]/;
// JSX text node: >Some Words< with >=3 consecutive Latin letters, no braces/tags inside.
const JSX_LATIN = />\s*([A-Za-z][A-Za-z ,.:'!?()/&-]{2,}?)\s*</g;
// User-facing string attributes worth translating.
const ATTR_LATIN = /\b(?:placeholder|title|aria-label|label|alt)\s*=\s*"([A-Za-z][^"]{2,})"/g;

// Files/dirs that legitimately contain literal strings — excluded entirely.
const SKIP_DIR = new Set(["i18n", "__tests__"]);
const SKIP_FILE = /\.(test|spec)\.tsx?$|\.d\.ts$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out);
    } else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip // line and block comments so comment text isn't flagged. */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function scanFile(file) {
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  let latin = 0;
  let arabic = 0;

  for (const m of code.matchAll(JSX_LATIN)) {
    const txt = m[1].trim();
    // ignore single tokens that are almost always non-UI (identifiers, enums)
    if (/^[A-Z][A-Za-z]+$/.test(txt) && !txt.includes(" ")) continue;
    latin++;
  }
  for (const m of code.matchAll(ATTR_LATIN)) {
    void m;
    latin++;
  }
  // Arabic characters anywhere in code (outside i18n/, which is skipped by dir).
  for (const line of code.split("\n")) {
    if (ARABIC.test(line)) arabic++;
  }
  return { latin, arabic };
}

const files = walk(SRC);
const current = {};
for (const f of files) {
  const { latin, arabic } = scanFile(f);
  if (latin || arabic) current[relative(EDMS, f).replace(/\\/g, "/")] = { latin, arabic };
}

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  const totL = Object.values(current).reduce((a, b) => a + b.latin, 0);
  const totA = Object.values(current).reduce((a, b) => a + b.arabic, 0);
  console.log(`[i18n] baseline written: ${Object.keys(current).length} files, ${totL} latin + ${totA} arabic findings.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};

let newLatin = 0;
let newArabic = 0;
const regressions = [];
for (const [file, cur] of Object.entries(current)) {
  const base = baseline[file] ?? { latin: 0, arabic: 0 };
  const dL = cur.latin - base.latin;
  const dA = cur.arabic - base.arabic;
  if (ALL || dL > 0 || dA > 0) {
    regressions.push({ file, cur, base, dL, dA });
    if (dL > 0) newLatin += dL;
    if (dA > 0) newArabic += dA;
  }
}

if (regressions.length === 0) {
  console.log("[i18n] ✓ no new hardcoded UI text vs baseline. (warn-only advisory)");
  process.exit(0);
}

console.log("[i18n] hardcoded-text advisory (warn only — nothing is blocked):");
console.log("[i18n] use t('key') for UI text; Arabic belongs in src/lib/i18n/dictionaries/.\n");
for (const r of regressions.sort((a, b) => (b.dL + b.dA) - (a.dL + a.dA))) {
  const parts = [];
  if (ALL) {
    if (r.cur.latin) parts.push(`${r.cur.latin} latin`);
    if (r.cur.arabic) parts.push(`${r.cur.arabic} arabic`);
  } else {
    if (r.dL > 0) parts.push(`+${r.dL} latin`);
    if (r.dA > 0) parts.push(`+${r.dA} arabic`);
  }
  console.log(`  ${r.file}: ${parts.join(", ")}`);
}
console.log(`\n[i18n] ${ALL ? "total" : "new vs baseline"}: ${newLatin} latin, ${newArabic} arabic.`);
console.log("[i18n] to accept these into the baseline: pnpm run lint:i18n:update");
// Warn-only: always succeed so build/CI are never blocked.
process.exit(0);
