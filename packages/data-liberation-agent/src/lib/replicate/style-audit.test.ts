// src/lib/replicate/style-audit.test.ts
import { describe, expect, it } from 'vitest';
import { auditStyleUsage } from './style-audit.js';

// Fictional emitted markup (no real-site data).
const STYLED_PAGE = `<!-- wp:heading {"style":{"typography":{"fontSize":"44px"},"spacing":{"margin":{"bottom":"12px"}}}} -->
<h2 class="wp-block-heading" style="font-size:44px;margin-bottom:12px">Tide Charts</h2>
<!-- /wp:heading -->
<!-- wp:paragraph {"fontSize":"large"} -->
<p class="has-large-font-size">Daily walrus forecasts.</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph {"textColor":"accent-primary"} -->
<p class="has-accent-primary-color has-text-color">Book a splash.</p>
<!-- /wp:paragraph -->`;

const BARE_PAGE = `<!-- wp:heading -->
<h2 class="wp-block-heading">Plain Heading</h2>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>Plain paragraph.</p>
<!-- /wp:paragraph -->`;

const HEAVY_CSS = `/* theme styles */
h2 { font-size: 44px; margin-bottom: 12px; }
p { color: #123456; }
@media (min-width: 768px) {
  h2 { font-size: 56px; }
}`;

describe('auditStyleUsage', () => {
  it('fully supports-styled markup scores 100 with an empty css budget', () => {
    const audit = auditStyleUsage([{ slug: 'home', markup: STYLED_PAGE }], '');
    expect(audit.supportStyledPercent).toBe(100);
    expect(audit.styledViaSupports).toBe(3);
    expect(audit.styledViaCss).toBe(0);
    expect(audit.cssBytes).toBe(0);
    expect(audit.cssRules).toBe(0);
  });

  it('bare blocks + heavy theme css scores 0 and reports the css budget', () => {
    const audit = auditStyleUsage([{ slug: 'home', markup: BARE_PAGE }], HEAVY_CSS);
    expect(audit.supportStyledPercent).toBe(0);
    expect(audit.styledViaSupports).toBe(0);
    expect(audit.styledViaCss).toBe(2);
    expect(audit.cssBytes).toBeGreaterThan(0);
    // Naive }-count after comment stripping: 3 rule bodies + the @media close.
    expect(audit.cssRules).toBe(4);
  });

  it('histogram counts flattened style paths across blocks', () => {
    const twoFontSizes = `<!-- wp:paragraph {"style":{"typography":{"fontSize":"18px"}}} -->
<p style="font-size:18px">a</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph {"style":{"typography":{"fontSize":"16px"}}} -->
<p style="font-size:16px">b</p>
<!-- /wp:paragraph -->`;
    const audit = auditStyleUsage([{ slug: 'p', markup: twoFontSizes }], '');
    expect(audit.stylePathHistogram).toEqual({ 'typography.fontSize': 2 });
  });

  it('nested style objects flatten to leaf paths', () => {
    const audit = auditStyleUsage([{ slug: 'p', markup: STYLED_PAGE }], '');
    expect(audit.stylePathHistogram['typography.fontSize']).toBe(1);
    expect(audit.stylePathHistogram['spacing.margin.bottom']).toBe(1);
  });

  it('mixed page: half the blocks styled scores 50', () => {
    const mixed = `<!-- wp:paragraph {"fontSize":"small"} -->
<p class="has-small-font-size">styled</p>
<!-- /wp:paragraph -->
<!-- wp:paragraph -->
<p>bare</p>
<!-- /wp:paragraph -->`;
    const audit = auditStyleUsage([{ slug: 'm', markup: mixed }], '');
    expect(audit.supportStyledPercent).toBe(50);
    expect(audit.styledViaSupports).toBe(1);
    expect(audit.styledViaCss).toBe(1);
  });

  it('counts innerBlocks recursively (group wrapper + styled child)', () => {
    const nested = `<!-- wp:group {"tagName":"section"} -->
<section class="wp-block-group"><!-- wp:paragraph {"backgroundColor":"surface"} -->
<p class="has-surface-background-color has-background">x</p>
<!-- /wp:paragraph --></section>
<!-- /wp:group -->`;
    const audit = auditStyleUsage([{ slug: 'n', markup: nested }], '');
    expect(audit.styledViaSupports).toBe(1); // the paragraph
    expect(audit.styledViaCss).toBe(1); // the bare group
    expect(audit.supportStyledPercent).toBe(50);
  });

  it('a has-* preset className counts as supports-styled', () => {
    const presetClass = `<!-- wp:paragraph {"className":"has-accent-primary-color intro"} -->
<p class="has-accent-primary-color intro">x</p>
<!-- /wp:paragraph -->`;
    const audit = auditStyleUsage([{ slug: 'c', markup: presetClass }], '');
    expect(audit.styledViaSupports).toBe(1);
  });

  it('empty input: zeroes across the board (no division blowup)', () => {
    expect(auditStyleUsage([], '')).toEqual({
      supportStyledPercent: 0,
      styledViaSupports: 0,
      styledViaCss: 0,
      stylePathHistogram: {},
      cssBytes: 0,
      cssRules: 0,
    });
  });

  it('cssRules ignores braces inside comments', () => {
    const css = '/* fake } rule } */ p { color: red; }';
    const audit = auditStyleUsage([], css);
    expect(audit.cssRules).toBe(1);
  });
});
