import { describe, it, expect } from 'vitest';
import { appendNavRevealUnfreeze, HORIZONTAL_MENU_SELECTOR } from './nav-reveal-unfreeze.js';

const SITE = 'body.lib-carry-site';
const menuDom =
  '<header><nav data-hook="menu-root" class="wixui-horizontal-menu wixui-menu"><a>HOME</a></nav></header>';

describe('appendNavRevealUnfreeze', () => {
  it('appends the :has() override scoped to the menu ancestors when a horizontal menu is present', () => {
    const out = appendNavRevealUnfreeze('.x{color:red}', menuDom, SITE);
    expect(out).toContain('.x{color:red}');
    expect(out).toContain(`${SITE} *:has(${HORIZONTAL_MENU_SELECTOR})`);
    expect(out).toContain('visibility:visible!important');
    expect(out).toContain('opacity:1!important');
  });

  it('uses the provided scope so a page sheet override matches its page wrapper', () => {
    const pageScope = 'body.lib-carry-site.lib-carry-page-homepage';
    const out = appendNavRevealUnfreeze('', menuDom, pageScope);
    expect(out).toContain(`${pageScope} *:has(${HORIZONTAL_MENU_SELECTOR})`);
  });

  it('is a no-op when the DOM has no menu-root (non-Wix / chrome-less)', () => {
    const css = '.x{color:red}';
    expect(appendNavRevealUnfreeze(css, '<header><nav><a>Home</a></nav></header>', SITE)).toBe(css);
  });

  it('is a no-op when menu-root exists but it is not the horizontal menu (e.g. only a hamburger)', () => {
    const css = '.x{color:red}';
    // Hamburger nav carries no wixui-horizontal-menu marker.
    const burgerDom = '<nav data-hook="menu-root" class="HamburgerOpenButton__nav"><a>HOME</a></nav>';
    expect(appendNavRevealUnfreeze(css, burgerDom, SITE)).toBe(css);
  });

  it('targets only the horizontal menu so the hamburger (separate nav) is never matched', () => {
    const out = appendNavRevealUnfreeze('', menuDom, SITE);
    // The override selector must reference the horizontal-menu marker, not a bare nav.
    expect(out).toContain('wixui-horizontal-menu');
    expect(out).not.toMatch(/\*:has\(nav\)\s*\{/); // never an unqualified nav match
  });
});
