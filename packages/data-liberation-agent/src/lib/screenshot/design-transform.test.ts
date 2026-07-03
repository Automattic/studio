import { describe, it, expect } from 'vitest';
import { wrapFragment, wrapMobileFragment, scopeCss } from './design-transform.js';

describe('wrapFragment', () => {
  it('wraps in .dla-replica .dla-content-desktop .dla-page-<slug> + body classes and sanitizes', () => {
    const out = wrapFragment('<h1>hi</h1><img src="x" onclick="evil()"><script>bad()</script>', 'about', ['home', 'dark']);
    expect(out).toMatch(/^<div class="dla-replica dla-content-desktop dla-page-about home dark">/);
    expect(out).toContain('<h1>hi</h1>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script>');
  });
  it('handles empty body classes', () => {
    const out = wrapFragment('<p>x</p>', 'home', []);
    expect(out).toMatch(/^<div class="dla-replica dla-content-desktop dla-page-home">/);
  });
});

describe('wrapMobileFragment', () => {
  it('wraps in .dla-content-mobile > .dla-content-mobile-inner with outer classes and sanitizes', () => {
    const out = wrapMobileFragment('<h1>mobile</h1><script>bad()</script>', 'about', ['dark']);
    expect(out).toMatch(/^<div class="dla-replica dla-content-mobile dla-page-about dark">/);
    expect(out).toContain('<div class="dla-content-mobile-inner">');
    expect(out).toContain('<h1>mobile</h1>');
    expect(out).not.toContain('<script>');
  });
  it('handles empty body classes and nests inner wrapper', () => {
    const out = wrapMobileFragment('<p>m</p>', 'home', []);
    expect(out).toMatch(/^<div class="dla-replica dla-content-mobile dla-page-home">/);
    expect(out).toContain('<div class="dla-content-mobile-inner">');
  });
  it('inner wrapper is a direct child of the outer wrapper', () => {
    const out = wrapMobileFragment('<p>content</p>', 'home', []);
    // The outer div's closing > is immediately followed by newline + inner div
    expect(out).toContain('dla-page-home">\n<div class="dla-content-mobile-inner">');
  });
});

describe('toggle wrapping (dual-viewport contentOverride)', () => {
  it('combining wrapFragment + wrapMobileFragment produces contentOverride with both classes', () => {
    const desktop = wrapFragment('<p>desktop content</p>', 'about', []);
    const mobile = wrapMobileFragment('<p>mobile content</p>', 'about', []);
    const contentOverride = desktop + '\n' + mobile;
    // Desktop block present
    expect(contentOverride).toContain('dla-content-desktop');
    expect(contentOverride).toContain('desktop content');
    // Mobile block present
    expect(contentOverride).toContain('dla-content-mobile');
    expect(contentOverride).toContain('mobile content');
    // Both share the page slug
    expect(contentOverride.match(/dla-page-about/g)?.length).toBe(2);
  });

  it('desktop-only fallback omits dla-content-mobile', () => {
    const desktop = wrapFragment('<p>only desktop</p>', 'home', []);
    expect(desktop).toContain('dla-content-desktop');
    expect(desktop).not.toContain('dla-content-mobile');
  });
});

describe('scopeCss', () => {
  it('rewrites body/html selectors to .dla-replica, preserving descendants', () => {
    expect(scopeCss('body{margin:0}', 'about', false)).toBe('.dla-replica{margin:0}');
    expect(scopeCss('body .x{color:red}', 'about', false)).toBe('.dla-replica .x{color:red}');
    expect(scopeCss('html,body{font:1em}', 'about', false)).toContain('.dla-replica');
  });
  it('does NOT rewrite body inside class/id names', () => {
    expect(scopeCss('.bodywrap{color:red}', 'about', false)).toBe('.bodywrap{color:red}');
  });
  it('prefixes page-specific rules with .dla-page-<slug> when scopePage=true', () => {
    expect(scopeCss('.hero{color:red}', 'about', true)).toBe('.dla-page-about .hero{color:red}');
  });
});
