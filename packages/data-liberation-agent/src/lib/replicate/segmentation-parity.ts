// src/lib/replicate/segmentation-parity.ts
//
// An OBJECTIVE parity score for the section segmentation, used to tune a generic
// layout-analysis ruleset against a fixture corpus instead of eyeballing one page.
//
// It compares the extractor's SectionSpec[] against an INDEPENDENT structural read
// of the same snapshot — the page's real full-width background BANDS (sampled in
// the browser, separate from extractFull). The two should agree: a source band
// boundary that the extractor did not reproduce is a MERGE (the bug behind
// "Journey + Specialties" collapsing into one section); a section whose captured
// background is far (ΔE) from the source band it sits on is a color-fidelity miss.
//
// measureSourceBands runs in the browser (needs layout); scoreSegmentation is a
// pure function (unit-tested) so the scoring math is verifiable without a browser.

import type { Page } from 'playwright';
import { colorDeltaE2000 } from './color-delta.js';
import type { SectionSpec } from './section-extract.js';

export interface SourceBand {
  /** Absolute top/bottom (px from document top) of a constant-background stripe. */
  top: number;
  bottom: number;
  /** The band's effective opaque background as `rgb(r, g, b)`. */
  bg: string;
}

/** A uniform repeated-sibling group in the source (a card row, pill row, icon
 *  row, logo strip) — the structure that must reconstruct as a multi-track grid,
 *  not flatten to a single stacked column. */
export interface SourceRepeat {
  top: number;
  bottom: number;
  /** Number of uniform repeated siblings (the row/grid track count). */
  count: number;
}

export interface ParityScore {
  sourceBandCount: number;
  sectionCount: number;
  /** Fraction of interior source-band boundaries the extractor reproduced (±tol). */
  boundaryRecall: number;
  /** Fraction of sections whose captured bg is within ΔE<=10 of its source band. */
  bgFidelity: number;
  /** Mean ΔE2000 between each section's bg and the source band at its y-center. */
  avgBgDeltaE: number;
  /** Number of uniform repeated-sibling groups detected in the source. */
  sourceRepeatCount: number;
  /** Fraction of source repeat-groups the extractor reproduced as a multi-track
   *  section (columnCount or cells >= the source track count). Flatten → low. */
  repetitionRecall: number;
  /** Weighted composite in [0,1] (higher = closer to the source structure). */
  composite: number;
}

/**
 * Read the snapshot's real visual bands: full-width, opaque-background stripes.
 * Geometry-only and independent of extractFull — at scroll 0 every element's
 * getBoundingClientRect is already in absolute document coordinates. For each
 * sampled y the band color is the INNERMOST (smallest-area) full-width opaque
 * block covering it (that's the layer the viewer sees); gaps read as white.
 * Adjacent equal-color samples compress into bands; sub-minBand stripes drop.
 */
export async function measureSourceBands(
  page: Page,
  opts: { stepPx?: number; minBandPx?: number; widthFrac?: number } = {},
): Promise<SourceBand[]> {
  const stepPx = opts.stepPx ?? 24;
  const minBandPx = opts.minBandPx ?? 120;
  const widthFrac = opts.widthFrac ?? 0.9;
  return page.evaluate(
    ({ stepPx, minBandPx, widthFrac }) => {
      // A background BAND is a SOLID fill. Overlay scrims (modal/cart/menu
      // backdrops) are semi-transparent tints over content — they darken what's
      // behind them, they aren't the page background — so require near-solid
      // alpha. A 0.5 threshold let a rgba(0,0,0,0.7) popup scrim register as a
      // full-width black band the page never actually shows.
      const opaque = (v: string): string | null => {
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v || '');
        if (!m) return null;
        const a = m[4] === undefined ? 1 : Number(m[4]);
        if (a < 0.85) return null;
        return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
      };
      const vw = window.innerWidth;
      const pageH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const blocks: Array<{ top: number; bottom: number; bg: string; area: number }> = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const he = el as HTMLElement;
        const cs = getComputedStyle(el);
        // Background bands come from IN-FLOW block backgrounds. Out-of-flow chrome
        // (fixed/sticky modal, cart-drawer and menu scrims, sticky bars) is not a
        // document background — and in a scripts-stripped snapshot these render
        // full-width, fabricating a dark band that isn't part of the page.
        if (cs.position === 'fixed' || cs.position === 'sticky') continue;
        if (he.offsetParent === null) continue; // not rendered (e.g. display:none)
        const r = el.getBoundingClientRect();
        if (r.width < vw * widthFrac || r.height < 40) continue;
        const bg = opaque(cs.backgroundColor);
        if (!bg) continue;
        blocks.push({ top: r.top, bottom: r.top + r.height, bg, area: r.width * r.height });
      }
      blocks.sort((a, b) => a.area - b.area); // innermost (smallest) wins a y
      const colorAt = (y: number): string => {
        for (const b of blocks) if (y >= b.top && y < b.bottom) return b.bg;
        return 'rgb(255, 255, 255)';
      };
      const bands: Array<{ top: number; bottom: number; bg: string }> = [];
      for (let y = 0; y < pageH; y += stepPx) {
        const bg = colorAt(y);
        const last = bands[bands.length - 1];
        if (last && last.bg === bg) last.bottom = y + stepPx;
        else bands.push({ top: y, bottom: y + stepPx, bg });
      }
      return bands.filter((b) => b.bottom - b.top >= minBandPx);
    },
    { stepPx, minBandPx, widthFrac },
  );
}

/**
 * Detect uniform repeated-sibling groups (card/pill/icon/logo rows) — the source
 * structures that must reconstruct as a multi-track grid, not flatten to one
 * stacked column. Generic + geometry-based: a container with >=3 visible direct
 * children sharing a structural signature and a uniform width, arranged across a
 * row. trackCount = how many share the top row (the grid's columns).
 */
export async function measureSourceRepeats(
  page: Page,
  opts: { minItems?: number; widthTolFrac?: number } = {},
): Promise<SourceRepeat[]> {
  const minItems = opts.minItems ?? 3;
  const widthTolFrac = opts.widthTolFrac ?? 0.3;
  return page.evaluate(
    ({ minItems, widthTolFrac }) => {
      const visible = (el: Element): boolean => {
        const he = el as HTMLElement;
        if (he.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      // Structural signature: tag + direct-child count bucket + has img / heading / link.
      const sig = (el: Element): string => {
        const kids = Array.from(el.children);
        const hasImg = !!el.querySelector('img,svg,picture');
        const hasH = !!el.querySelector('h1,h2,h3,h4,h5,h6');
        const hasA = !!el.querySelector('a,button');
        return `${el.tagName}|${Math.min(kids.length, 6)}|${hasImg ? 'i' : ''}${hasH ? 'h' : ''}${hasA ? 'a' : ''}`;
      };
      const vw = window.innerWidth;
      const groups: Array<{ top: number; bottom: number; count: number }> = [];
      for (const parent of Array.from(document.body.querySelectorAll('*'))) {
        // Skip site chrome — nav menus and footer link columns are uniform
        // repeated siblings too, but they're not content grids to reconstruct.
        if (parent.closest('nav,header,footer,[role="navigation"],[role="contentinfo"],[role="banner"]')) continue;
        const kids = Array.from(parent.children).filter(visible);
        if (kids.length < minItems) continue;
        const sigs = kids.map(sig);
        const counts: Record<string, number> = {};
        for (const s of sigs) counts[s] = (counts[s] || 0) + 1;
        const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!dom || dom[1] < minItems) continue;
        const matched = kids.filter((_k, i) => sigs[i] === dom[0]);
        const rects = matched.map((k) => k.getBoundingClientRect());
        const avgW = rects.reduce((s, r) => s + r.width, 0) / rects.length;
        if (avgW < 120) continue; // ignore tiny repeated chips (bullets, tag pills in nav)
        if (!rects.every((r) => Math.abs(r.width - avgW) <= avgW * widthTolFrac)) continue;
        // The row must span a real content width — a grid row is wide; a small
        // 3-item cluster in a corner is not a section-level grid.
        const span = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
        if (span < vw * 0.45) continue;
        // track count = max siblings sharing a row (top within 24px)
        let tracks = 1;
        for (const a of rects) {
          const row = rects.filter((b) => Math.abs(b.top - a.top) <= 24).length;
          if (row > tracks) tracks = row;
        }
        if (tracks < 2) continue; // a vertical stack isn't a grid row
        // A multi-track row's columns are NARROWER than the viewport (they sit
        // side-by-side). Page builders (Wix) stack several full-bleed section
        // layers at the same top; those read as N "tracks" each ~viewport-wide,
        // but you can't fit 2+ viewport-wide columns side-by-side — they overlap,
        // so they're stacked layers, not a grid. Reject them. Without this, one
        // whole-page false grid swallows the real card rows in the de-nest below.
        // (Genuinely wide repeated rows are single-track and already dropped above.)
        if (avgW > vw * 0.9) continue;
        const top = Math.min(...rects.map((r) => r.top));
        const bottom = Math.max(...rects.map((r) => r.top + r.height));
        groups.push({ top, bottom, count: tracks });
      }
      // De-nest: keep the OUTERMOST group when ranges overlap heavily (a card row
      // and the cards inside it both match) — the outer is the real grid.
      groups.sort((a, b) => b.bottom - b.top - (a.bottom - a.top));
      const kept: Array<{ top: number; bottom: number; count: number }> = [];
      for (const g of groups) {
        const overlaps = kept.some(
          (k) => Math.min(k.bottom, g.bottom) - Math.max(k.top, g.top) > (g.bottom - g.top) * 0.6,
        );
        if (!overlaps) kept.push(g);
      }
      return kept.sort((a, b) => a.top - b.top);
    },
    { minItems, widthTolFrac },
  );
}

/**
 * Score how well the extracted sections reproduce the source's visual bands and
 * repeated-grid structure. Pure: no browser, no I/O — unit-tested.
 */
export function scoreSegmentation(
  bands: SourceBand[],
  specs: SectionSpec[],
  opts: { boundaryTolPx?: number; repeatTolPx?: number; deltaEFloor?: number; repeats?: SourceRepeat[] } = {},
): ParityScore {
  // A band boundary within boundaryTolPx of a section top is the SAME boundary —
  // the extractor reproduced it, just not pixel-exact. 120px (= one minBandPx)
  // forgives sub-section rounding without letting one section's top match a
  // neighbouring band (real section tops are spaced hundreds of px apart). An
  // 80px window was too tight: it false-missed real boundaries off by 110–117px.
  const boundaryTol = opts.boundaryTolPx ?? 120;
  const repeatTol = opts.repeatTolPx ?? 80;
  const deFloor = opts.deltaEFloor ?? 10;
  const repeats = opts.repeats ?? [];
  // A section's TOP and its BOTTOM are both real visual boundaries. Matching only
  // tops misses a boundary reproduced by a section's bottom edge — e.g. a hero
  // ends and the next section starts after a gap, so the hero→content boundary is
  // its bottom, not the next top. A merge is still penalised: a section spanning
  // several bands has edges only at the merge's outer top/bottom, so the dropped
  // INTERIOR boundaries align with neither edge (and decorative sub-section bands
  // align with neither either, so they stay correctly unrecalled).
  const sectionEdges = specs.flatMap((s) => [s.top, s.top + s.height]);

  // Interior source boundaries (the top of each band after the first): each should
  // align with some extracted section EDGE. A merge drops a boundary → lower recall.
  const interior = bands.slice(1).map((b) => b.top);
  const matched = interior.filter((y) => sectionEdges.some((t) => Math.abs(t - y) <= boundaryTol));
  const boundaryRecall = interior.length ? matched.length / interior.length : 1;

  // Per-section background fidelity vs the source band at the section's y-center.
  const bandAt = (y: number): SourceBand | null =>
    bands.find((b) => y >= b.top && y < b.bottom) ?? null;
  let deSum = 0;
  let dePass = 0;
  let scored = 0;
  for (const s of specs) {
    const band = bandAt(s.top + s.height / 2);
    if (!band) continue;
    const de = colorDeltaE2000(s.backgroundColor, band.bg);
    deSum += de;
    if (de <= deFloor) dePass++;
    scored++;
  }
  const bgFidelity = scored ? dePass / scored : 1;
  const avgBgDeltaE = scored ? deSum / scored : 0;

  // Repetition fidelity: each source repeat-group (a card/pill/icon row) should be
  // reproduced by a section overlapping its y-range whose track count (columnCount,
  // or cells) is at least the source's. A flattened row (1 column) fails it.
  const sectionTracks = (s: SectionSpec): number =>
    Math.max(s.layout?.columnCount ?? 1, (s.cells ?? []).length ? Math.min((s.cells ?? []).length, 6) : 1);
  // Interaction models that carry the WHOLE repeated set without a fixed column
  // count: a carousel scrolls its items, a gallery is masonry, a strip wraps. Their
  // columnCount underrepresents the item count, so don't require tracks >= source —
  // the repetition IS reproduced, just not as a rigid grid. (A genuinely flattened
  // grid is classified static/columns and still fails, so this can't mask a flatten.)
  const REPEAT_MODELS = new Set(['gallery', 'horizontal-showcase', 'marquee-strip', 'logo-strip']);
  let repHit = 0;
  for (const rep of repeats) {
    const mid = (rep.top + rep.bottom) / 2;
    const covering = specs.filter((s) => mid >= s.top - repeatTol && mid <= s.top + s.height + repeatTol);
    if (covering.some((s) => REPEAT_MODELS.has(s.interactionModel) || sectionTracks(s) >= Math.min(rep.count, 4)))
      repHit++;
  }
  const repetitionRecall = repeats.length ? repHit / repeats.length : 1;

  // Composite: segmentation (boundary recall) + color fidelity + repetition fidelity.
  // Repetition only weighted when the page actually has repeated grids.
  const composite = repeats.length
    ? 0.4 * boundaryRecall + 0.3 * bgFidelity + 0.3 * repetitionRecall
    : 0.6 * boundaryRecall + 0.4 * bgFidelity;

  return {
    sourceBandCount: bands.length,
    sectionCount: specs.length,
    boundaryRecall: Number(boundaryRecall.toFixed(3)),
    bgFidelity: Number(bgFidelity.toFixed(3)),
    avgBgDeltaE: Number(avgBgDeltaE.toFixed(2)),
    sourceRepeatCount: repeats.length,
    repetitionRecall: Number(repetitionRecall.toFixed(3)),
    composite: Number(composite.toFixed(3)),
  };
}
