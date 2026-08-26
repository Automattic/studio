import { describe, it, expect } from 'vitest';
import {
  containsCustomHtmlBlock,
  containsUnmarkedCustomHtmlBlock,
  PIPELINE_ISLAND_OPENER,
  PIPELINE_ISLAND_NAME,
} from './block-policy.js';

describe('containsUnmarkedCustomHtmlBlock', () => {
  it('flags a bare wp:html opener (hand-authored / legacy island)', () => {
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:html -->\n<div>x</div>\n<!-- /wp:html -->')).toBe(true);
  });

  it('does NOT flag a pipeline-marked island', () => {
    const island = `${PIPELINE_ISLAND_OPENER}\n<div>x</div>\n<!-- /wp:html -->`;
    expect(containsUnmarkedCustomHtmlBlock(island)).toBe(false);
    // The strict project-wide ban still sees it as a Custom HTML block —
    // compose paths (block-compose / block-transform-apply) keep rejecting it.
    expect(containsCustomHtmlBlock(island)).toBe(true);
  });

  it('flags the core/html long-form name when unmarked', () => {
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:core/html -->x<!-- /wp:core/html -->')).toBe(true);
  });

  it('flags an opener whose attrs lack the marker name', () => {
    expect(
      containsUnmarkedCustomHtmlBlock('<!-- wp:html {"metadata":{"name":"My Section"}} -->x<!-- /wp:html -->'),
    ).toBe(true);
  });

  it('flags a mixed document containing one marked and one bare island', () => {
    const mixed =
      `${PIPELINE_ISLAND_OPENER}\n<div>a</div>\n<!-- /wp:html -->\n` +
      `<!-- wp:html -->\n<div>b</div>\n<!-- /wp:html -->`;
    expect(containsUnmarkedCustomHtmlBlock(mixed)).toBe(true);
  });

  it('flags a broken, unclosed opener (safe side)', () => {
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:html \n<div>x</div>')).toBe(true);
  });

  it('ignores closers, other blocks, and html-prefixed block names', () => {
    expect(containsUnmarkedCustomHtmlBlock('<!-- /wp:html -->')).toBe(false);
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->')).toBe(false);
    expect(containsUnmarkedCustomHtmlBlock('<!-- wp:html5-video /-->')).toBe(false);
    expect(containsUnmarkedCustomHtmlBlock('plain text, no blocks')).toBe(false);
  });

  it('opener constant carries the marker name', () => {
    expect(PIPELINE_ISLAND_OPENER).toContain(`"name":"${PIPELINE_ISLAND_NAME}"`);
  });
});
