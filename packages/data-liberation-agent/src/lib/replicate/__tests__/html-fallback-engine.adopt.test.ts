import { describe, expect, it } from 'vitest';
import {
  buildHtmlFallbackBlock,
  isWpLayoutMarkup,
  sanitize,
  selectIslandSource,
} from '@automattic/blocks-engine/theme';
import { scanForInjection } from '../validate-artifacts.js';
import { buildInternalLinkMap } from '../../streaming/internal-link-rewrite.js';
import {
  PIPELINE_ISLAND_OPENER,
  containsUnmarkedCustomHtmlBlock,
} from '../../wordpress/block-policy.js';

describe('blocks-engine coverage island adoption', () => {
  it('wraps sanitized source in the DLA golden pipeline-marked block', () => {
    const out = buildHtmlFallbackBlock('<section><h2>Our story</h2></section>', {});
    expect(out).toBe(
      `${PIPELINE_ISLAND_OPENER}\n<section><h2>Our story</h2></section>\n<!-- /wp:html -->`,
    );
    expect(containsUnmarkedCustomHtmlBlock(out)).toBe(false);
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:html -->\n<div>x</div>\n<!-- /wp:html -->')).toBe(true);
  });

  it('keeps the DLA sanitize golden output and clears injection vectors', () => {
    const dirty =
      '<section onload="track()">' +
      '<script>evil()</script>' +
      '<style>.x{color:red}</style>' +
      '<img src="/u/a.jpg" onerror="steal()"/>' +
      '<?php echo "x"; ?>' +
      '<!-- wp:paragraph -->' +
      '<p>Real copy</p>' +
      '</section>';
    expect(sanitize(dirty)).toBe('<section><img src="/u/a.jpg"/><p>Real copy</p></section>');

    const out = buildHtmlFallbackBlock(dirty, {});
    expect(scanForInjection(out)).toEqual([]);
    expect(out).toContain('<p>Real copy</p>');
    expect(out).toContain('<img src="/u/a.jpg"');
  });

  it('rewrites media URLs and DLA-built internal link maps without changing map ownership', () => {
    const mediaUrlMap = new Map([['https://cdn.example.test/a.jpg', '/wp-content/uploads/a.jpg']]);
    const linkMap = buildInternalLinkMap(
      [
        { from: '/about', to: '/about/' },
        { from: '/contact', to: '/contact/' },
      ],
      { siteOrigins: ['example.test'] },
    );

    const out = buildHtmlFallbackBlock(
      '<section><img src="https://cdn.example.test/a.jpg"><a href="/about">About</a><a href="https://example.test/contact#team">Team</a></section>',
      { mediaUrlMap, linkMap },
    );

    expect(out).toContain('src="/wp-content/uploads/a.jpg"');
    expect(out).toContain('href="/about/"');
    expect(out).toContain('href="/contact/#team"');
    expect(out).not.toContain('cdn.example.test');
  });

  it('preserves the defensive throw when sanitization leaves an injection vector', () => {
    expect(() => buildHtmlFallbackBlock('<section><img/src=x/onerror=alert(1)></section>')).toThrow(
      'html-fallback sanitization left injection vectors: inline event handler attribute (on*=) in markup (not allowed)',
    );
  });

  it('classifies WP-layout markup with DLA golden behavior', () => {
    expect(isWpLayoutMarkup('<div class="wp-block-group is-layout-constrained">x</div>')).toBe(true);
    expect(isWpLayoutMarkup('<main class="has-global-padding">x</main>')).toBe(true);
    expect(isWpLayoutMarkup('<div class="sqs-block comp-abc">x</div>')).toBe(false);
  });

  it('selects responsive, styled, and verbatim island sources with DLA golden output', () => {
    const wp = '<main class="wp-block-group is-layout-constrained"><h1>A</h1></main>';
    const styled = '<main style="width:1440px">A</main>';
    const nonWp = '<div class="sqs-block">A</div>';

    expect(selectIslandSource({ sectionHtml: wp, styledHtml: styled })).toEqual({
      source: wp,
      tier: 'responsive',
    });
    expect(selectIslandSource({ sectionHtml: nonWp, styledHtml: styled })).toEqual({
      source: styled,
      tier: 'styled',
    });
    expect(selectIslandSource({ sectionHtml: nonWp })).toEqual({
      source: nonWp,
      tier: 'verbatim',
    });
  });
});
