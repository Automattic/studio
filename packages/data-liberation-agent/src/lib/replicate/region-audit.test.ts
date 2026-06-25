import { describe, it, expect } from 'vitest';
import { reconcileRegions } from './region-audit.js';
import type { SourceLandmark } from './section-extract.js';

const L = (o: Partial<SourceLandmark>): SourceLandmark =>
  ({ role: 'section', tag: 'section', selector: 'section', textLength: 200, mediaCount: 1, ...o });

describe('reconcileRegions', () => {
  it('flags an actionable nav that was not placed as chrome', () => {
    const census = [L({ role: 'nav', tag: 'nav', selector: 'nav.site-nav', textLength: 60, mediaCount: 0 })];
    const r = reconcileRegions(census, []); // no header_part placed → nav dropped
    expect(r.unassignedRegions.map((x) => x.role)).toEqual(['nav']);
    expect(r.counts.unassigned).toBe(1);
  });
  it('assigns a nav when a header_part was placed (role join)', () => {
    const census = [L({ role: 'nav', tag: 'nav', selector: 'nav.site-nav', textLength: 60, mediaCount: 0 })];
    const r = reconcileRegions(census, [{ kind: 'header_part', role: 'header' }]);
    expect(r.unassignedRegions).toEqual([]);
    expect(r.assignments[0].kind).toBe('header_part');
  });
  it('marks a skip-link / empty region non_actionable', () => {
    const census = [L({ role: 'nav', tag: 'nav', selector: 'nav.skip', textLength: 14, mediaCount: 0 })];
    const r = reconcileRegions(census, []);
    expect(r.unassignedRegions).toEqual([]);
    expect(r.counts.nonActionable).toBe(1);
  });
  it('assigns main when any body section was placed', () => {
    const census = [L({ role: 'main', tag: 'main', selector: 'main' })];
    const r = reconcileRegions(census, [{ kind: 'page_body_section', selector: 'section#hero' }]);
    expect(r.assignments[0].kind).toBe('page_body_section');
  });
  it('assigns a standalone section by exact selector', () => {
    const census = [L({ selector: 'section#promo' })];
    const r = reconcileRegions(census, [{ kind: 'page_body_section', selector: 'section#promo' }]);
    expect(r.assignments[0].kind).toBe('page_body_section');
    expect(r.unassignedRegions).toEqual([]);
  });

  it('assigns aside and complementary landmarks when their placement is present', () => {
    const census = [
      L({ role: 'aside', tag: 'aside', selector: 'aside#rail', textLength: 80, mediaCount: 0 }),
      L({ role: 'complementary', tag: 'div', selector: 'div#tools', textLength: 80, mediaCount: 0 }),
    ];
    const r = reconcileRegions(census, [
      { kind: 'header_part', role: 'aside' },
      { kind: 'header_part', role: 'complementary' },
    ]);
    expect(r.unassignedRegions).toEqual([]);
    expect(r.assignments.map((a) => a.kind)).toEqual(['header_part', 'header_part']);
  });

  it('reports aside and complementary landmarks as unassigned when placed nowhere', () => {
    const census = [
      L({ role: 'aside', tag: 'aside', selector: 'aside#rail', textLength: 80, mediaCount: 0 }),
      L({ role: 'complementary', tag: 'div', selector: 'div#tools', textLength: 80, mediaCount: 0 }),
    ];
    const r = reconcileRegions(census, []);
    expect(r.unassignedRegions.map((x) => x.role)).toEqual(['aside', 'complementary']);
    expect(r.counts.unassigned).toBe(2);
  });

  it('does not assign a dropped complementary rail to an unrelated roleless normalized body placement', () => {
    const census = [
      L({
        role: 'complementary',
        tag: 'div',
        selector: 'div:nth-of-type(2)',
        textLength: 80,
        mediaCount: 0,
        linkCount: 2,
      }),
    ];
    const r = reconcileRegions(census, [{ kind: 'page_body_section', selector: 'div:nth-of-type(1)' }]);
    expect(r.assignments[0].kind).toBe('unassigned');
    expect(r.unassignedRegions.map((x) => x.selector)).toEqual(['div:nth-of-type(2)']);
  });

  it('keeps exact selector body-section joins for roleless placed complementary regions', () => {
    const census = [
      L({
        role: 'complementary',
        tag: 'div',
        selector: 'div:nth-of-type(2)',
        textLength: 80,
        mediaCount: 0,
        linkCount: 2,
      }),
    ];
    const r = reconcileRegions(census, [{ kind: 'page_body_section', selector: 'div:nth-of-type(2)' }]);
    expect(r.assignments[0].kind).toBe('page_body_section');
    expect(r.unassignedRegions).toEqual([]);
  });

  // Regression: a source page with a real nav whose content was DROPPED by the
  // build (chrome extraction yielded no header → no header_part placed) must
  // surface the nav as the one unassigned region, while the placed main + footer
  // reconcile cleanly. This is the failure item-level content-diffing misses.
  it('catches a dropped source nav while main/footer survive (corneliusholmes regression)', () => {
    const census = [
      L({ role: 'nav', tag: 'nav', selector: 'nav.main-nav', textLength: 90, mediaCount: 0 }),
      L({ role: 'main', tag: 'main', selector: 'main' }),
      L({ role: 'footer', tag: 'footer', selector: 'footer.site-footer', textLength: 120, mediaCount: 0 }),
    ];
    // Body sections placed + a footer part placed, but NO header part (nav dropped).
    const placed = [
      { kind: 'page_body_section' as const, selector: 'section#hero' },
      { kind: 'footer_part' as const, role: 'footer' as const },
    ];
    const r = reconcileRegions(census, placed);
    expect(r.counts.unassigned).toBe(1);
    expect(r.unassignedRegions.map((x) => x.role)).toEqual(['nav']);
    // main assigned (body placed) + footer assigned (footer_part) → only nav dropped.
    expect(r.counts.assigned).toBe(2);
  });
});
