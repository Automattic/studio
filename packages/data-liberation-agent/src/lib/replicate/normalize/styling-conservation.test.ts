// src/lib/replicate/normalize/styling-conservation.test.ts
import { describe, it, expect } from 'vitest';
import { extractClassTokens, findDroppedClasses } from './styling-conservation.js';

describe('extractClassTokens', () => {
  it('collects class tokens from every element, split on whitespace', () => {
    const set = extractClassTokens('<div class="a b"><span class="c">x</span></div>');
    expect([...set].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores classes on non-rendering tags (script/style/template/noscript)', () => {
    const set = extractClassTokens('<div class="keep"></div><script class="track"></script><style class="s"></style>');
    expect(set.has('keep')).toBe(true);
    expect(set.has('track')).toBe(false);
    expect(set.has('s')).toBe(false);
  });

  it('also reads classes carried only on a block "className" attribute (block markup)', () => {
    // The emitter sometimes rides a class on the block comment attr; the rendered
    // element may not byte-match. Both forms must count as "present".
    const set = extractClassTokens('<!-- wp:group {"className":"only-attr"} -->\n<div class="wp-block-group">x</div>\n<!-- /wp:group -->');
    expect(set.has('only-attr')).toBe(true);
  });
});

describe('findDroppedClasses', () => {
  it('flags a source class absent from the emitted markup (the dropped styling hook)', () => {
    const source = '<div class="stat"><div class="stat-num">12k</div></div>';
    const emitted = '<!-- wp:group {"className":"stat"} -->\n<div class="wp-block-group stat"><p>12k</p></div>\n<!-- /wp:group -->';
    expect(findDroppedClasses(source, emitted)).toEqual(['stat-num']);
  });

  it('passes (no drops) when every source class survives in the emitted markup', () => {
    const source = '<div class="stat"><div class="stat-num">12k</div></div>';
    const emitted =
      '<!-- wp:group {"className":"stat"} -->\n<div class="wp-block-group stat">' +
      '<!-- wp:paragraph {"className":"stat-num"} -->\n<p class="stat-num">12k</p>\n<!-- /wp:paragraph -->' +
      '</div>\n<!-- /wp:group -->';
    expect(findDroppedClasses(source, emitted)).toEqual([]);
  });

  it('returns dropped classes sorted and de-duplicated', () => {
    const source = '<div class="z"><span class="a">1</span><span class="a">2</span><b class="m">3</b></div>';
    const emitted = '<div class="wp-block-group z">123</div>';
    expect(findDroppedClasses(source, emitted)).toEqual(['a', 'm']);
  });
});
