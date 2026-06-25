import { describe, it, expect } from 'vitest';
import {
  stripActiveNavState,
  canonicalizeInstanceIds,
  chromeSignature,
} from './chrome-canonicalize.js';

describe('stripActiveNavState', () => {
  it('removes data-selected + aria-current and re-enables the current item', () => {
    const html = '<a data-selected="true" data-interactive="false" aria-current="page">ABOUT</a>';
    expect(stripActiveNavState(html)).toBe('<a data-interactive="true">ABOUT</a>');
  });

  it('does NOT shear `selected` out of `data-selected` (no `data-` stub)', () => {
    const out = stripActiveNavState('<div class="x" data-selected="true" data-part="content">');
    expect(out).toBe('<div class="x" data-part="content">');
    expect(out).not.toContain('data- ');
  });

  it('makes two pages whose active item differs identical', () => {
    const about = '<li data-interactive="true">HOME</li><li data-selected="true" data-interactive="false" aria-current="page">ABOUT</li>';
    const home = '<li data-selected="true" data-interactive="false" aria-current="page">HOME</li><li data-interactive="true">ABOUT</li>';
    expect(stripActiveNavState(about)).toBe(stripActiveNavState(home));
  });

  it('is a no-op when there is no active state', () => {
    const html = '<li data-interactive="true">HOME</li>';
    expect(stripActiveNavState(html)).toBe(html);
  });
});

describe('canonicalizeInstanceIds', () => {
  it('rewrites the instance prefix but preserves shared component ids', () => {
    const a = '#comp-ljebhk37_r_comp-mkxa2bci{a:b} .comp-ljebhk37-container{c:d}';
    const b = '#comp-ljebhilf_r_comp-mkxa2bci{a:b} .comp-ljebhilf-container{c:d}';
    // Different instance ids → identical after canonicalization (component id mkxa2bci kept).
    expect(canonicalizeInstanceIds(a)).toBe(canonicalizeInstanceIds(b));
    expect(canonicalizeInstanceIds(a)).toContain('comp-INSTANCE0_r_comp-mkxa2bci');
  });

  it('does not touch the _r_comp component segment', () => {
    expect(canonicalizeInstanceIds('comp-aaa_r_comp-bbb')).toBe('comp-INSTANCE0_r_comp-bbb');
  });

  it('does not over-match a longer alphanumeric token', () => {
    // comp-aaa must not rewrite inside comp-aaabbb
    const out = canonicalizeInstanceIds('comp-aaa comp-aaabbb');
    expect(out).toBe('comp-INSTANCE0 comp-INSTANCE1');
  });

  it('maps multiple distinct instances positionally', () => {
    const out = canonicalizeInstanceIds('comp-hdr1_r_comp-x #comp-ftr2_r_comp-y');
    expect(out).toBe('comp-INSTANCE0_r_comp-x #comp-INSTANCE1_r_comp-y');
  });
});

describe('chromeSignature', () => {
  // Two interior headers: different instance id AND different active item → same signature.
  const aboutHeader = '<header id="comp-ljebhk37"><a data-interactive="true">HOME</a><a data-selected="true" data-interactive="false" aria-current="page" id="comp-ljebhk37_r_comp-item">ABOUT</a></header>';
  const galleryHeader = '<header id="comp-ljebhilf"><a data-selected="true" data-interactive="false" aria-current="page">HOME</a><a data-interactive="true" id="comp-ljebhilf_r_comp-item">ABOUT</a></header>';

  it('collapses interior pages that differ only by instance id + active item', () => {
    expect(chromeSignature(aboutHeader, '')).toBe(chromeSignature(galleryHeader, ''));
  });

  it('ignores chrome CSS differences (DOM-keyed) — only header/footer args', () => {
    // Same DOM, regardless of any CSS, yields the same signature (CSS isn't an input).
    expect(chromeSignature(aboutHeader, '')).toBe(chromeSignature(aboutHeader, ''));
  });

  it('keeps a structurally different header distinct', () => {
    const homeHeader = '<header id="comp-lk6v3ld3"><a id="comp-lk6v3ld3_r_comp-other">HOME</a></header>';
    expect(chromeSignature(homeHeader, '')).not.toBe(chromeSignature(aboutHeader, ''));
  });
});
