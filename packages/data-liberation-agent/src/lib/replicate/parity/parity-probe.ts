// src/lib/replicate/parity/parity-probe.ts
//
// Dual-side computed-style probe for the deterministic repair loop. The carry
// pipeline preserves source ids/classes onto the block DOM, so elements MATCH
// by selector on both sides — divergence detection is measurement, not vision.
// compareSnapshots is pure (unit-tested on literals); the Playwright capture
// is a thin wrapper. evaluate() closures run under tsx (the MCP server), so
// pages get the string-form __name polyfill (same as screenshotter.ts).
//
import type { Browser, Page } from 'playwright';
import type { DiffRegion } from './diff-regions.js';

export const PROP_BATTERY = [
  'display',
  'position',
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
  'fontFamily',
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
] as const;

export interface ElementSnapshot {
  /** Deterministic identity: '#id' or 'tag.cls1.cls2[occurrenceIndex]'. */
  match: string;
  rect: { top: number; left: number; width: number; height: number };
  props: Record<string, string>;
  /** Classes present on the replica element but absent from the match key —
   * wp-* contributions; the classifier uses these for cause attribution. */
  replicaOnlyClasses: string[];
}

export type ViewportId = 'desktop' | 'mobile';

export interface Divergence {
  match: string;
  viewport: ViewportId;
  kind: 'prop' | 'rect' | 'missing';
  prop: string;
  source: string;
  replica: string;
  replicaOnlyClasses: string[];
  /** Source pathname this divergence was measured on (e.g. '/', '/scent/').
   * Threaded from probePair so the classifier can detect page-conflicts —
   * the SAME selector|prop|viewport carrying different source values across
   * pages cannot be expressed as one global patch rule. Absent for pure-unit
   * divergences (back-compat: a lone single-page run has no conflict). */
  page?: string;
}

const RECT_TOLERANCE = 2;

/** Pure comparator — source order preserved, deterministic. `page` (optional)
 * stamps each divergence with the source pathname it was measured on so the
 * classifier can detect cross-page conflicts. */
export function compareSnapshots(
  source: ElementSnapshot[],
  replica: ElementSnapshot[],
  viewport: ViewportId,
  page?: string,
): Divergence[] {
  const byMatch = new Map(replica.map((s) => [s.match, s]));
  const out: Divergence[] = [];
  const stamp = page !== undefined ? { page } : {};
  for (const s of source) {
    const r = byMatch.get(s.match);
    if (!r) {
      out.push({ match: s.match, viewport, kind: 'missing', prop: 'element', source: 'present', replica: 'absent', replicaOnlyClasses: [], ...stamp });
      continue;
    }
    for (const prop of PROP_BATTERY) {
      const sv = s.props[prop];
      const rv = r.props[prop];
      if (sv !== undefined && rv !== undefined && sv !== rv) {
        out.push({ match: s.match, viewport, kind: 'prop', prop, source: sv, replica: rv, replicaOnlyClasses: r.replicaOnlyClasses, ...stamp });
      }
    }
    for (const axis of ['top', 'left', 'width', 'height'] as const) {
      if (Math.abs(s.rect[axis] - r.rect[axis]) > RECT_TOLERANCE) {
        out.push({
          match: s.match,
          viewport,
          kind: 'rect',
          prop: axis,
          source: String(s.rect[axis]),
          replica: String(r.rect[axis]),
          replicaOnlyClasses: r.replicaOnlyClasses,
          ...stamp,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playwright capture (thin)
// ---------------------------------------------------------------------------

/** Freeze-motion css — measure under the SAME frozen conditions the capture
 * used (probe-state == capture-state). The probe owns this; the handler's
 * freezeMotion prepareCapture imports it rather than duplicating the bytes. */
export const FREEZE_MOTION_CSS =
  '*,*::before,*::after{transition:none!important;animation:none!important}' +
  'html.js section{opacity:1!important;transform:none!important}' +
  // nativeBehaviors replica gate: force-reveal dla/reveal sections so below-
  // fold IO timing can't race the capture. Inert on non-behavior runs (the
  // .dla-reveal-js class only exists when the reveal view module ran).
  '.dla-reveal-js .wp-block-dla-reveal{opacity:1!important;transform:none!important}' +
  // Neutralize css smooth-scroll: a bare scrollTo on a scroll-behavior:smooth
  // site GLIDES and races the snap (walrus probe: the restore was still at
  // y=4 with the is-scrolled header compressed when the screenshot fired).
  // Belt to the helpers' explicit-instant scrollTo — parity captures/probes
  // stay immune even if a future capture path skips page-helpers.
  'html{scroll-behavior:auto!important}';

/** Clear every pending window interval — the JS sibling of FREEZE_MOTION_CSS.
 * CSS freezing cannot reach setInterval class-movers (slider autoplay,
 * tickers): source and replica timers start at their own load instants, so a
 * settle that crosses the interval boundary on ONE side flips the active
 * slide and diffs the section (same race class as the reveal/IO capture fix).
 * Injected AFTER the freeze style on both capture and probe pages — kills
 * autoplay identically on BOTH sides. Behavior verification lives in the
 * behavior probe, which asserts autoplay explicitly on live pages WITHOUT
 * the freeze. String-form evaluate (tsx __name gotcha): self-contained, no
 * closure captures. The trick: setInterval returns a monotonically increasing
 * id, so allocating one top id bounds every live timer below it. */
export const CLEAR_INTERVALS_SCRIPT = `(() => {
  const top = window.setInterval(() => {}, 9999);
  for (let i = top; i >= 0; i--) window.clearInterval(i);
})()`;

const NAME_POLYFILL = `
  if (typeof globalThis.__name === 'undefined') {
    globalThis.__name = function (fn) { return fn; };
  }
`;

// String-form function: bypasses tsx's keepNames transform entirely.
// Evaluated in-browser — must be self-contained (no closure captures).
// Identity classes exclude wp-*/is-*/has-*/alignfull/alignwide (WP-added).
const SNAPSHOT_FN = `(args) => {
  const { regions, battery } = args;
  const intersects = (r) => regions.some((g) => r.top <= g.bottom && r.bottom >= g.top);
  const counters = new Map();
  const out = [];
  for (const el of Array.from(document.querySelectorAll('[id], [class]'))) {
    const rect = el.getBoundingClientRect();
    const abs = { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
    if (rect.width === 0 && rect.height === 0) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') continue;
    const id = el.getAttribute('id');
    // Identity classes: source-authored only — wp-*, is-*, has-* are WP-added.
    const all = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean);
    const own = all.filter((c) => !/^(wp-|is-|has-|alignfull|alignwide)/.test(c));
    if (!id && own.length === 0) continue;
    const base = id ? '#' + id : tag + '.' + own.join('.');
    const n = counters.get(base) || 0;
    counters.set(base, n + 1);
    // Count EVERY qualifying element in document order, EMIT only the
    // intersecting ones — counting global keeps occurrence indices stable
    // across asymmetric region shapes on both sides.
    if (!intersects(abs)) continue;
    const cs = getComputedStyle(el);
    const props = {};
    for (const p of battery) props[p] = cs[p];
    out.push({
      match: base + '[' + n + ']',
      rect: { top: Math.round(abs.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
      props,
      replicaOnlyClasses: all.filter((c) => /^(wp-|is-|has-)/.test(c) || c === 'alignfull' || c === 'alignwide'),
    });
  }
  return out;
}`;

export async function snapshotPage(page: Page, regions: DiffRegion[]): Promise<ElementSnapshot[]> {
  // String-form function: bypasses tsx's keepNames transform entirely.
  return (await page.evaluate(`(${SNAPSHOT_FN})(${JSON.stringify({ regions, battery: PROP_BATTERY })})`)) as ElementSnapshot[];
}

export interface ProbePairOpts {
  browser: Browser;
  sourceUrl: string;
  replicaUrl: string;
  viewport: ViewportId;
  regions: DiffRegion[];
  /** Source pathname identity for cross-page conflict detection (e.g. '/scent/').
   * Defaults to the sourceUrl's pathname when omitted. */
  page?: string;
}

const VIEWPORTS: Record<ViewportId, { width: number; height: number; mobile: boolean }> = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
};

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Probe both sides for one viewport. Deterministic given stable pages. */
export async function probePair(opts: ProbePairOpts): Promise<Divergence[]> {
  const vp = VIEWPORTS[opts.viewport];
  const context = await opts.browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    ...(vp.mobile ? { isMobile: true, hasTouch: true, userAgent: MOBILE_UA } : {}),
  });
  await context.addInitScript(NAME_POLYFILL);
  try {
    const page = await context.newPage();
    const grab = async (url: string): Promise<ElementSnapshot[]> => {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.evaluate('document.fonts.ready');
      await page.addStyleTag({ content: FREEZE_MOTION_CSS });
      // An interval-moved active class between the source and replica grabs
      // would diff class-dependent props — same determinism contract as the
      // capture side (probe-state == capture-state).
      await page.evaluate(CLEAR_INTERVALS_SCRIPT);
      return snapshotPage(page, opts.regions);
    };
    const source = await grab(opts.sourceUrl);
    const replica = await grab(opts.replicaUrl);
    // Page identity: explicit opt, else the source URL's pathname (so the
    // classifier can detect the same selector measured differently per page).
    let pageId = opts.page;
    if (pageId === undefined) {
      try {
        pageId = new URL(opts.sourceUrl).pathname;
      } catch {
        pageId = opts.sourceUrl;
      }
    }
    return compareSnapshots(source, replica, opts.viewport, pageId);
  } finally {
    await context.close();
  }
}
