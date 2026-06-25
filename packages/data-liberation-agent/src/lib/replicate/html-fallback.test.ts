import { describe, it, expect } from 'vitest';
import { buildHtmlFallbackBlock, isWpLayoutMarkup, selectIslandSource } from './html-fallback.js';
import { scanForInjection } from './validate-artifacts.js';
import { buildInternalLinkMap } from '../streaming/internal-link-rewrite.js';
import {
  PIPELINE_ISLAND_OPENER,
  containsUnmarkedCustomHtmlBlock,
} from '../wordpress/block-policy.js';

describe('buildHtmlFallbackBlock', () => {
  it('wraps the sanitized section in a MARKED core/html block', () => {
    const out = buildHtmlFallbackBlock('<section><h2>Our story</h2></section>', {});
    expect(out.startsWith(PIPELINE_ISLAND_OPENER)).toBe(true);
    expect(out.trimEnd().endsWith('<!-- /wp:html -->')).toBe(true);
    expect(out).toContain('<h2>Our story</h2>');
  });

  it('the emitted island bears the pipeline marker the install-time wp:html ban recognizes', () => {
    const out = buildHtmlFallbackBlock('<section><p>Copy</p></section>', {});
    // Marked island → NOT flagged as a hand-authored Custom HTML block.
    expect(containsUnmarkedCustomHtmlBlock(out)).toBe(false);
    // A bare (legacy / hand-authored) island IS flagged.
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:html -->\n<div>x</div>\n<!-- /wp:html -->')).toBe(true);
  });

  it('strips <script>, <style>, inline on*= handlers, and <?php so it passes the injection gate', () => {
    const dirty =
      '<section onload="track()">' +
      '<script>evil()</script>' +
      '<style>.x{color:red}</style>' +
      '<img src="/u/a.jpg" onerror="steal()"/>' +
      '<?php echo "x"; ?>' +
      '<p>Real copy</p>' +
      '</section>';
    const out = buildHtmlFallbackBlock(dirty, {});
    expect(scanForInjection(out)).toEqual([]);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/on\w+\s*=/i);
    expect(out).not.toContain('<?php');
    // Real content survives.
    expect(out).toContain('<p>Real copy</p>');
    expect(out).toContain('<img src="/u/a.jpg"');
  });

  it('rewrites source media URLs to local upload URLs', () => {
    const mediaUrlMap = new Map([['https://cdn.example.test/a.jpg', '/wp-content/uploads/a.jpg']]);
    const out = buildHtmlFallbackBlock('<img src="https://cdn.example.test/a.jpg"/>', { mediaUrlMap });
    expect(out).toContain('src="/wp-content/uploads/a.jpg"');
    expect(out).not.toContain('cdn.example.test');
  });

  it('rewrites internal page links via the #2 link map', () => {
    const linkMap = buildInternalLinkMap([{ from: '/about', to: '/about/' }], { siteOrigins: ['example.test'] });
    const out = buildHtmlFallbackBlock('<a href="/about">About</a>', { linkMap });
    expect(out).toContain('href="/about/"');
  });
});

describe('isWpLayoutMarkup', () => {
  it('true for WP block-layout classes', () => {
    expect(isWpLayoutMarkup('<div class="wp-block-group is-layout-constrained">x</div>')).toBe(true);
    expect(isWpLayoutMarkup('<main class="has-global-padding">x</main>')).toBe(true);
  });
  it('false for non-WP / plain markup', () => {
    expect(isWpLayoutMarkup('<div class="sqs-block comp-abc">x</div>')).toBe(false);
    expect(isWpLayoutMarkup('<section><p>hello</p></section>')).toBe(false);
  });
});

describe('selectIslandSource', () => {
  const WP = '<main class="wp-block-group is-layout-constrained"><h1 class="has-text-align-center">A</h1></main>';
  const STYLED = '<main style="width:1440px">A</main>';

  it('WP-native sectionHtml → responsive (prefers sectionHtml)', () => {
    expect(selectIslandSource({ sectionHtml: WP, styledHtml: STYLED }))
      .toEqual({ source: WP, tier: 'responsive' });
  });
  it('non-WP sectionHtml + styledHtml → styled (prefers styledHtml)', () => {
    const nonWp = '<div class="sqs-block">A</div>';
    expect(selectIslandSource({ sectionHtml: nonWp, styledHtml: STYLED }))
      .toEqual({ source: STYLED, tier: 'styled' });
  });
  it('styledHtml absent + non-WP sectionHtml → verbatim', () => {
    const nonWp = '<div class="sqs-block">A</div>';
    expect(selectIslandSource({ sectionHtml: nonWp })).toEqual({ source: nonWp, tier: 'verbatim' });
  });
  it('sectionHtml absent → uses styledHtml (styled tier)', () => {
    expect(selectIslandSource({ styledHtml: STYLED })).toEqual({ source: STYLED, tier: 'styled' });
  });
});

describe('provenance prefix semantics', () => {
  it('responsive/styled flags are NOT counted as the bare html-fallback# divergence', () => {
    expect('html-fallback-responsive#0: x'.startsWith('html-fallback#')).toBe(false);
    expect('html-fallback-styled#0: x'.startsWith('html-fallback#')).toBe(false);
    expect('html-fallback#0: x'.startsWith('html-fallback#')).toBe(true);
  });
});
