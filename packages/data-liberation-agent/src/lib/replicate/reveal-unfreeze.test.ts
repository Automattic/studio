import { describe, it, expect } from 'vitest';
import { detectRevealGateClasses, appendRevealUnfreeze } from './reveal-unfreeze.js';

const DAWN_CSS = `
.scroll-trigger.animate--slide-in{opacity:.01;transform:translateY(2rem);transition:opacity .5s}
.scroll-trigger--offscreen{visibility:hidden}
.animate--hover-vertical-lift:hover{transform:translateY(-2px)}
`;

describe('detectRevealGateClasses', () => {
  it('flags scroll-reveal gate classes that hide via opacity/visibility', () => {
    const gates = detectRevealGateClasses(DAWN_CSS);
    expect(gates).toContain('scroll-trigger');
    expect(gates).toContain('scroll-trigger--offscreen');
  });
  it('does NOT flag hover-only animation classes', () => {
    expect(detectRevealGateClasses(DAWN_CSS)).not.toContain('animate--hover-vertical-lift');
  });
  it('does NOT flag a class whose only opacity rule is opacity:1 (with transition)', () => {
    const css = `.fade-in{opacity:1;transition:opacity .5s}`;
    expect(detectRevealGateClasses(css)).not.toContain('fade-in');
  });
  it('does NOT flag a class whose NAME contains "transition" but whose decls are not animated', () => {
    // `.transition-up` has `opacity:0` but no transition/animation/transform DECLARATION —
    // the only "transition" token is in the selector text, which must not count as animated.
    expect(detectRevealGateClasses('.transition-up{opacity:0}')).not.toContain('transition-up');
  });
});

describe('appendRevealUnfreeze', () => {
  it('emits a scoped end-state override only when the DOM uses a detected gate', () => {
    const dom = '<footer class="footer"><div class="scroll-trigger animate--slide-in">x</div></footer>';
    const out = appendRevealUnfreeze('', DAWN_CSS, dom, 'body.lib-carry-site');
    expect(out).toMatch(/\.scroll-trigger\b/);
    expect(out).toMatch(/opacity:\s*1\s*!important/);
    expect(out).toMatch(/transform:\s*none\s*!important/);
  });
  it('no-ops when the DOM uses no detected gate', () => {
    expect(appendRevealUnfreeze('', DAWN_CSS, '<footer>x</footer>', 'body.lib-carry-site')).toBe('');
  });
  it('matches gate classes on a class-token boundary, not as a raw substring', () => {
    // Gate class `in` must NOT be considered present in DOM that merely contains
    // `section-inner` (substring), so no override is emitted.
    const css = `.in{opacity:0;transition:opacity .3s}`;
    expect(appendRevealUnfreeze('', css, '<div class="section-inner">x</div>', 'body.lib-carry-site')).toBe('');
  });

  it('emits the COMPOUND hide selector, never a bare layout co-class', () => {
    // `.container.scroll-trigger{opacity:0}` must un-freeze only the compound-matched
    // element — emitting a standalone `.container{transform:none}` would null transforms
    // on every layout container site-wide.
    const css = `.container.scroll-trigger{opacity:0;transition:opacity .5s}`;
    const out = appendRevealUnfreeze('', css, '<div class="container scroll-trigger">x</div>', 'body.lib-carry-site');
    expect(out).toMatch(/\.container\.scroll-trigger\s*\{/); // full compound selector
    expect(out).not.toMatch(/:where\([^)]*\)\s+\.container\s*\{/); // no bare-.container override
  });

  it('does not un-freeze when only part of a compound gate selector is present', () => {
    // The rule only matches elements with BOTH classes; if the DOM has just one,
    // nothing is gated, so no override.
    const css = `.container.scroll-trigger{opacity:0;transition:opacity .5s}`;
    expect(appendRevealUnfreeze('', css, '<div class="container">x</div>', 'body.lib-carry-site')).toBe('');
  });
});
