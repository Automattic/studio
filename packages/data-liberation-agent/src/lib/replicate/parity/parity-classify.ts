// src/lib/replicate/parity/parity-classify.ts
//
// The divergence catalog as code — the deterministic heart of the repair
// loop. Ordered rules; first match wins; anything not provably patchable is
// REPORTED, never guessed (determinism directive: AI/manual is a separate,
// opt-in escalation). Patch css is byte-stable: sorted, marker-wrapped, no
// timestamps.
//
import { createHash } from 'node:crypto';
import type { Divergence, ViewportId } from './parity-probe.js';

export type { Divergence } from './parity-probe.js';

export interface PatchOverride {
  /** Source-authored selector (identity part of the match key). */
  selector: string;
  occurrence: number;
  /** kebab-case css property. */
  prop: string;
  /** The SOURCE's measured value — restore authorial intent. */
  value: string;
  viewports: ViewportId[];
  cause: string;
}

export interface UnresolvedDivergence extends Divergence {
  cause: string;
}

export interface RepairPlan {
  overrides: PatchOverride[];
  unresolved: UnresolvedDivergence[];
}

/** Props we can safely override per-site with a measured value. */
const PATCHABLE = new Set([
  'display',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'maxWidth',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'color',
  'backgroundColor',
  'gap',
  'justifyContent',
  'flexWrap',
  'borderBottomWidth',
]);

/** Props whose divergence signals a PRODUCT-level cause — patching the value
 * would mask the real defect. Reported with a named cause instead. */
const PRODUCT_CAUSES: Record<string, string> = {
  fontFamily: 'font-authority',
};

const kebab = (p: string): string => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function splitMatch(match: string): { selector: string; occurrence: number } {
  const m = /^(.*)\[(\d+)\]$/.exec(match);
  return m ? { selector: m[1], occurrence: Number(m[2]) } : { selector: match, occurrence: 0 };
}

/** Live-DOM ids can carry characters that make an emitted selector invalid
 * css (#weird:id) or a silently wrong target (#foo[data] — the greedy
 * splitMatch keeps the bracket in the selector). Escaping has spec edge
 * cases — reject deterministically instead; rejected divergences are
 * reported, never emitted. */
const UNSAFE_IN_SELECTOR = /[:\[\]{}()"'\\]/;

function selectorIsSafe(sel: string): boolean {
  if (UNSAFE_IN_SELECTOR.test(sel)) return false;
  // '#foo.bar' passes the char class but is semantically wrong: the source id
  // is the literal 'foo.bar', while emitted css would target id 'foo' with
  // class 'bar'. Ids must be standalone; class-chain selectors (tag.a.b)
  // keep their dots legitimately.
  if (sel.startsWith('#') && sel.slice(1).includes('.')) return false;
  return true;
}

export function classifyDivergences(divergences: Divergence[]): RepairPlan {
  const overrides = new Map<string, PatchOverride>();
  const unresolved: UnresolvedDivergence[] = [];

  // First pass: gate. Non-candidates route to unresolved immediately;
  // candidates (prop-kind, patchable, safe selector, occurrence 0) are
  // collected so page-conflict detection can run BEFORE any override is
  // emitted.
  const candidates: Array<{ div: Divergence; selector: string; occurrence: number }> = [];
  for (const div of divergences) {
    if (div.kind !== 'prop') {
      unresolved.push({ ...div, cause: 'structural' });
      continue;
    }
    const productCause = PRODUCT_CAUSES[div.prop];
    if (productCause) {
      unresolved.push({ ...div, cause: productCause });
      continue;
    }
    const { selector, occurrence } = splitMatch(div.match);
    if (!selectorIsSafe(selector)) {
      unresolved.push({ ...div, cause: 'unsafe-selector' });
      continue;
    }
    if (!PATCHABLE.has(div.prop)) {
      unresolved.push({ ...div, cause: 'unpatchable-prop' });
      continue;
    }
    // NOTE: occurrence > 0 needs :nth structural targeting we cannot derive
    // deterministically from the identity key alone — occurrence 0 is the
    // only emittable target (the common case). Routing higher occurrences
    // here keeps plan.overrides an honest mirror of what renderPatchCss
    // emits.
    if (occurrence !== 0) {
      unresolved.push({ ...div, cause: 'occurrence-ambiguous' });
      continue;
    }
    candidates.push({ div, selector, occurrence });
  }

  // Page-conflict detection. The patch selector space is page-blind: a global
  // rule `selector { prop: value }` (optionally inside one media query) cannot
  // hold two values. One element has exactly one computed value per viewport,
  // so the SAME selector|occurrence|prop|viewport carrying DIFFERENT source
  // values can ONLY arise across pages (different page heroes sharing a class).
  // Emitting both yields last-wins paint — the maison scent-hero navy-on-navy
  // bug. Route every conflicting tuple to unresolved 'page-conflict' (honest,
  // no wrong paint). Keyed per VIEWPORT so a clean breakpoint still patches
  // even when the other viewport conflicts; legitimate desktop≠mobile values
  // live in distinct media queries and never collide.
  const sourcesByTuple = new Map<string, Set<string>>();
  for (const c of candidates) {
    const tuple = `${c.selector}|${c.occurrence}|${c.div.prop}|${c.div.viewport}`;
    let set = sourcesByTuple.get(tuple);
    if (!set) {
      set = new Set();
      sourcesByTuple.set(tuple, set);
    }
    set.add(c.div.source);
  }
  const conflictTuples = new Set(
    [...sourcesByTuple.entries()].filter(([, s]) => s.size > 1).map(([t]) => t),
  );

  for (const c of candidates) {
    const { div, selector, occurrence } = c;
    const tuple = `${selector}|${occurrence}|${div.prop}|${div.viewport}`;
    if (conflictTuples.has(tuple)) {
      unresolved.push({ ...div, cause: 'page-conflict' });
      continue;
    }
    const key = `${selector}|${occurrence}|${div.prop}|${div.source}`;
    const existing = overrides.get(key);
    if (existing) {
      if (!existing.viewports.includes(div.viewport)) existing.viewports.push(div.viewport);
    } else {
      overrides.set(key, {
        selector,
        occurrence,
        prop: kebab(div.prop),
        value: div.source,
        viewports: [div.viewport],
        cause: div.replicaOnlyClasses.length > 0 ? 'wp-interference' : 'cascade-divergence',
      });
    }
  }

  const sorted = [...overrides.values()].sort(
    (a, b) => a.selector.localeCompare(b.selector) || a.prop.localeCompare(b.prop),
  );
  // Deterministic viewport order.
  for (const o of sorted) o.viewports.sort();
  return { overrides: sorted, unresolved };
}

export interface PageConflict {
  selector: string;
  occurrence: number;
  prop: string;
  viewport: ViewportId;
  /** The distinct source values that collided on this viewport. */
  values: string[];
}

const ALL_VIEWPORTS: ViewportId[] = ['desktop', 'mobile'];

/**
 * Cross-round union safety net. The per-round classifier already suppresses
 * within-round page-conflicts, but the repair loop UNIONS overrides across
 * rounds, and pages fail at different times: a page that passes round 1 (no
 * override) can BREAK under round 1's global patch and emit a conflicting
 * value in round 2 — reintroducing two `selector { prop: value }` rules that
 * last-wins-collide (the maison scent-hero bug across rounds).
 *
 * Group by selector|occurrence|prop; per VIEWPORT, gather the distinct values
 * among overrides whose viewports include it. A viewport with >1 distinct
 * value is unpatchable globally — strip THAT viewport from every override in
 * the group (an override left with no viewports is dropped). Per-viewport so a
 * clean breakpoint survives even when the other collides. Deterministic:
 * stable group order, stable viewport order, no mutation of inputs.
 */
export function suppressPageConflicts(overrides: PatchOverride[]): {
  overrides: PatchOverride[];
  conflicts: PageConflict[];
} {
  const groups = new Map<string, PatchOverride[]>();
  for (const o of overrides) {
    const gk = `${o.selector}|${o.occurrence}|${o.prop}`;
    const arr = groups.get(gk);
    if (arr) arr.push(o);
    else groups.set(gk, [o]);
  }

  const conflicts: PageConflict[] = [];
  const out: PatchOverride[] = [];
  for (const [, group] of groups) {
    // Which viewports collide within this selector|occurrence|prop group?
    const collidingViewports = new Set<ViewportId>();
    for (const vp of ALL_VIEWPORTS) {
      const values = new Set<string>();
      for (const o of group) if (o.viewports.includes(vp)) values.add(o.value);
      if (values.size > 1) {
        collidingViewports.add(vp);
        conflicts.push({
          selector: group[0].selector,
          occurrence: group[0].occurrence,
          prop: group[0].prop,
          viewport: vp,
          values: [...values].sort(),
        });
      }
    }
    if (collidingViewports.size === 0) {
      out.push(...group);
      continue;
    }
    // Strip the colliding viewports from each override; keep what survives.
    for (const o of group) {
      const kept = o.viewports.filter((vp) => !collidingViewports.has(vp));
      if (kept.length > 0) out.push({ ...o, viewports: kept });
    }
  }
  return { overrides: out, conflicts };
}

const MOBILE_MEDIA = '@media (max-width: 767px)';
const DESKTOP_MEDIA = '@media (min-width: 768px)';

export function renderPatchCss(plan: RepairPlan): string {
  if (plan.overrides.length === 0) return '';
  const bare: string[] = [];
  const mobile: string[] = [];
  const desktop: string[] = [];
  // Everything in plan.overrides is emitted — classification already routed
  // unemittable divergences (unsafe selectors, occurrence > 0) to unresolved.
  for (const o of plan.overrides) {
    const rule = `${o.selector} { ${o.prop}: ${o.value}; }`;
    const both = o.viewports.length === 2;
    if (both) bare.push(rule);
    else if (o.viewports[0] === 'mobile') mobile.push(rule);
    else desktop.push(rule);
  }
  const parts = [
    '/* parity-patch: generated deterministically by the repair loop — same',
    '   divergence inputs produce identical bytes. Source-measured values',
    '   restoring authorial intent over residual WP interference. */',
    ...bare,
  ];
  if (desktop.length) parts.push(`${DESKTOP_MEDIA} {\n  ${desktop.join('\n  ')}\n}`);
  if (mobile.length) parts.push(`${MOBILE_MEDIA} {\n  ${mobile.join('\n  ')}\n}`);
  return parts.join('\n') + '\n';
}

/** Order-insensitive fingerprint of a divergence set — the loop's convergence
 * test (same fingerprint two rounds running → stop; patching is not helping).
 * Known limitation: the loop compares against the LAST round only, so an
 * oscillation cycle longer than 1 round is not detected here — maxRounds is
 * the bound that catches it. */
export function divergenceFingerprint(divergences: Divergence[]): string {
  const keys = divergences
    .map((d) => `${d.match}|${d.viewport}|${d.kind}|${d.prop}|${d.source}|${d.replica}`)
    .sort();
  return createHash('sha1').update(keys.join('\n')).digest('hex');
}
