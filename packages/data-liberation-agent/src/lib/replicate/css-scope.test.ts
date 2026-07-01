import { describe, it, expect } from 'vitest';
import { scopeCss } from './css-scope.js';

describe('scopeCss — selectors', () => {
  // The scope is wrapped in :where() so it adds ZERO specificity — the carried
  // CSS keeps its original cascade. Assertions reflect the :where(...) form.
  it('prefixes a plain class selector with the zero-specificity scope', () => {
    const out = scopeCss('.hero { color: red }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site) .hero');
  });

  it('prefixes each selector in a comma list', () => {
    const out = scopeCss('.a, .b { color: red }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site) .a');
    expect(out).toContain(':where(body.lib-carry-site) .b');
  });

  it('folds html/body/:root onto the scope instead of nesting under it', () => {
    const out = scopeCss('body { margin: 0 } :root { --x: 1px }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site) {');
    expect(out).not.toContain(':where(body.lib-carry-site) body');
    expect(out).toContain('--x: 1px');
  });
});

describe('scopeCss — at-rules', () => {
  it('preserves @media and scopes its inner rules', () => {
    const out = scopeCss('@media (max-width: 600px){ .hero { color: red } }', { scope: 'body.lib-carry-site' });
    expect(out).toContain('@media (max-width: 600px)');
    expect(out).toContain(':where(body.lib-carry-site) .hero');
  });

  it('namespaces @keyframes and updates animation references', () => {
    const css = '@keyframes spin { from {opacity:0} to {opacity:1} } .x { animation: spin 1s }';
    const out = scopeCss(css, { scope: 'body.lib-carry-site', scopeId: 'p1' });
    expect(out).toContain('@keyframes spin__p1');
    expect(out).toContain('animation: spin__p1 1s');
  });

  it('rewrites url() via rewriteUrl', () => {
    const out = scopeCss('.x { background: url(/a.png) }', {
      scope: 'body.lib-carry-site',
      rewriteUrl: (u) => (u === '/a.png' ? '/wp/up/a.png' : null),
    });
    expect(out).toContain('url(/wp/up/a.png)');
  });
});

describe('scopeCss — combined-root + edge selectors', () => {
  it('folds :root combined with a class onto the scope', () => {
    const out = scopeCss(':root.dark { color: white }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site).dark');
    // .dark must not be orphaned as its own selector: no leading combinator (space, >, ~, +) or
    // comma directly before it. It is only legal glued onto the scope (…lib-carry-site.dark).
    expect(out).not.toMatch(/(?:^|[\s,>~+])\.dark\s*\{/);
  });

  it('folds :root:not(...) onto the scope', () => {
    const out = scopeCss(':root:not(.x) { color: white }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site):not(.x)');
  });

  it('preserves a child combinator after body', () => {
    const out = scopeCss('body > .x { color: red }', { scope: 'body.lib-carry-site' });
    expect(out).toContain(':where(body.lib-carry-site) > .x');
  });

  it('returns empty string for empty CSS without throwing', () => {
    expect(scopeCss('', { scope: 'body.lib-carry-site' })).toBe('');
  });

  it('leaves no un-renamed animation reference after keyframe namespacing', () => {
    const css = '@keyframes spin { from {opacity:0} to {opacity:1} } .x { animation: spin 1s }';
    const out = scopeCss(css, { scope: 'body.lib-carry-site', scopeId: 'p1' });
    expect(out).not.toContain('animation: spin 1s');
  });
});

describe('scopeCss rem-base preservation', () => {
  it('keeps a root font-size anchored to :root, not the body wrapper', () => {
    const out = scopeCss('html{font-size:62.5%;background:#fff}', { scope: 'body.lib-carry-site' });
    // font-size must target the root so rem resolves to 10px
    expect(out).toMatch(/:root\s*\{[^}]*font-size:\s*62\.5%/);
    // non-root props on html still scope to the carried wrapper (don't repaint the whole page)
    expect(out).toMatch(/:where\(body\.lib-carry-site\)\s*\{[^}]*background/);
  });
  it('does not emit a :root font-size when the source root is the 16px default (no rule)', () => {
    const out = scopeCss('body{color:#111}', { scope: 'body.lib-carry-site' });
    expect(out).not.toMatch(/:root\s*\{/);
  });
  it('leaves body rules scoping to the wrapper (unchanged behavior)', () => {
    const out = scopeCss('body{margin:0}', { scope: 'body.lib-carry-site' });
    expect(out).toMatch(/:where\(body\.lib-carry-site\)\s*\{[^}]*margin:\s*0/);
    expect(out).not.toMatch(/:root\s*\{/);
  });
  it('hoists a :root font-size (not just html) to a :root rule', () => {
    const out = scopeCss(':root{font-size:50%}', { scope: 'body.lib-carry-site' });
    expect(out).toMatch(/:root\s*\{[^}]*font-size:\s*50%/);
  });
  it('does NOT hoist an @media-nested root font-size (keeps the breakpoint conditional)', () => {
    const out = scopeCss('html{font-size:62.5%}@media (min-width:768px){html{font-size:18px}}', {
      scope: 'body.lib-carry-site',
    });
    // the top-level root font-size still hoists to :root
    expect(out).toMatch(/:root\s*\{[^}]*font-size:\s*62\.5%/);
    // the responsive font-size stays inside the @media (not hoisted, @media not emptied)
    expect(out).toMatch(/@media[^{]*\{[^}]*font-size:\s*18px/);
  });
});
