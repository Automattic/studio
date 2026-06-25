import { describe, it, expect } from 'vitest';
import { validateBlockMarkup } from './validate-block-markup.js';
import { reconstructPagePattern } from './page-reconstruct.js';
import type { SectionSpec } from './section-extract.js';

// Minimal SectionSpec factory (mirrors page-reconstruct.test.ts).
function section(partial: Partial<SectionSpec>): SectionSpec {
  return {
    sectionIndex: 0,
    interactionModel: 'static',
    top: 0,
    height: 400,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255, 255, 255)',
    gradient: null,
    gradientSource: null,
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: null,
    dividerBelow: null,
    layout: { containerWidth: 1200, padding: '0', childLayout: 'stack', columnCount: 1, gap: '0' },
    ...partial,
  } as SectionSpec;
}

describe('validateBlockMarkup — delimiter balance (the bug the WP parser silently swallows)', () => {
  it('flags an unclosed block delimiter', () => {
    const markup =
      '<!-- wp:columns --><div class="wp-block-columns">' +
      '<!-- wp:column --><div class="wp-block-column"><!-- wp:paragraph --><p>a</p><!-- /wp:paragraph --></div><!-- /wp:column -->' +
      '</div>'; // missing <!-- /wp:columns -->
    const issues = validateBlockMarkup(markup);
    expect(issues.join('\n')).toMatch(/unclosed.*wp:columns/i);
  });

  it('flags a closing delimiter whose name does not match the open block', () => {
    const markup = '<!-- wp:columns --><div></div><!-- /wp:group -->';
    const issues = validateBlockMarkup(markup);
    expect(issues.join('\n')).toMatch(/mismatch|expected .*columns.*found .*group/i);
  });

  it('flags a closing delimiter with no matching open block', () => {
    const issues = validateBlockMarkup('<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph --><!-- /wp:group -->');
    expect(issues.join('\n')).toMatch(/no open block|unmatched clos/i);
  });

  it('treats a self-closing void block as balanced (not unclosed)', () => {
    expect(validateBlockMarkup('<!-- wp:spacer {"height":"40px"} /-->')).toEqual([]);
  });
});

describe('validateBlockMarkup — official-parser checks', () => {
  it('passes well-formed, balanced block markup', () => {
    const markup =
      '<!-- wp:heading {"level":2} --><h2>Title</h2><!-- /wp:heading -->\n\n' +
      '<!-- wp:paragraph --><p>Body copy.</p><!-- /wp:paragraph -->';
    expect(validateBlockMarkup(markup)).toEqual([]);
  });

  it('flags content sitting outside any block delimiter (freeform leak)', () => {
    const markup = '<p>orphaned html not wrapped in a block</p>';
    expect(validateBlockMarkup(markup).join('\n')).toMatch(/outside.*block|freeform/i);
  });

  it('flags invalid block-attribute JSON', () => {
    const markup = '<!-- wp:image {bad json} --><figure></figure><!-- /wp:image -->';
    expect(validateBlockMarkup(markup).join('\n')).toMatch(/attribute|json/i);
  });

  it('ignores blank-line whitespace between blocks (not a freeform leak)', () => {
    const markup =
      '<!-- wp:paragraph --><p>one</p><!-- /wp:paragraph -->\n\n\n' +
      '<!-- wp:paragraph --><p>two</p><!-- /wp:paragraph -->';
    expect(validateBlockMarkup(markup)).toEqual([]);
  });
});

describe('validateBlockMarkup — real reconstructPagePattern output', () => {
  it('passes the genuine renderer output (PHP header stripped, blocks intact)', () => {
    const result = reconstructPagePattern(
      [section({ headings: ['Welcome'], bodyText: ['Some verbatim body copy from the source page.'] })],
      { patternSlug: 'demo-replica/page-demo', title: 'Demo' },
    );
    // sanity: the renderer really did emit block markup behind a PHP header
    expect(result.php).toContain('<?php');
    expect(result.php).toMatch(/<!-- wp:/);
    expect(validateBlockMarkup(result.php)).toEqual([]);
  });
});
