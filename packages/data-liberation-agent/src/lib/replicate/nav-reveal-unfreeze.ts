/**
 * Wix gates its header's MAIN navigation behind an entrance-animation reveal:
 * the menu's ancestor section/containers ship `visibility:hidden` + `opacity:0`
 * (a transition initial-state), and Wix's runtime JS transitions them to
 * visible/opaque after hydration. The carry-and-scope path strips scripts, so
 * that reveal never fires and the main nav stays frozen invisible even though
 * the DOM, CSS, and (self-hosted) menu font were all captured correctly.
 * See memory: Wix nav gap (carry path).
 *
 * `appendNavRevealUnfreeze` appends a CSS override that un-freezes ONLY the main
 * horizontal menu's ancestor chain, satisfying three constraints:
 *
 *   - site-generic: keys off Wix's stable `data-hook="menu-root"` +
 *     `wixui-horizontal-menu` markers, NEVER per-site hashed classes/ids.
 *   - nav-specific: `:has()` matches only ANCESTORS of the horizontal menu, so
 *     the header's solid-background sibling layer is untouched — the header
 *     stays transparent over the hero (no opaque bar) and the page content's
 *     own reveal/scroll states are unaffected.
 *   - hamburger-safe: the mobile hamburger is a SEPARATE nav without
 *     `data-hook="menu-root"`; it is not an ancestor of the horizontal menu and
 *     re-hides itself via its own rule, so it stays closed.
 *
 * No-op when the DOM has no horizontal menu (non-Wix chrome, chrome-less Wix,
 * or a platform whose nav doesn't use this reveal gate).
 */

/** Wix's stable selector for the desktop horizontal menu (NOT the hamburger). */
export const HORIZONTAL_MENU_SELECTOR = 'nav[data-hook="menu-root"].wixui-horizontal-menu';

/** Cheap markers that must both be present for a horizontal menu to exist. */
const MENU_ROOT_MARKER = 'menu-root';
const HORIZONTAL_MENU_MARKER = 'wixui-horizontal-menu';

/**
 * Append the main-nav reveal-unfreeze override to `css`, scoped under `scope`
 * (the same wrapper the sheet is already scoped to, e.g. `body.lib-carry-site` for
 * the chrome sheet or `body.lib-carry-site.lib-carry-page-<slug>` for a page sheet).
 *
 * @param css      The already-scoped, treeshaken sheet to augment.
 * @param domHtml  The carried DOM the sheet styles (chrome or main region).
 * @param scope    The sheet's wrapper selector.
 */
export function appendNavRevealUnfreeze(css: string, domHtml: string, scope: string): string {
  if (!domHtml.includes(MENU_ROOT_MARKER) || !domHtml.includes(HORIZONTAL_MENU_MARKER)) {
    return css;
  }
  const override =
    `\n\n/* carry: un-freeze the stripped entrance-animation reveal on the main nav.\n` +
    `   :has() targets the horizontal menu's ANCESTORS only — leaves the header's\n` +
    `   solid-bg sibling and the hamburger overlay untouched. */\n` +
    `${scope} *:has(${HORIZONTAL_MENU_SELECTOR}){visibility:visible!important;opacity:1!important}\n`;
  return css + override;
}
