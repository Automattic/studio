/**
 * Chrome dedupe canonicalization (carry-and-scope path).
 * =====================================================
 * Wix instantiates the SAME header/footer component per page, but each
 * instance carries a page-unique root comp-id and a page-specific active-nav
 * marker. So two pages that visually share one header have byte-different carried
 * DOM/CSS — naive content-dedupe treats them as distinct and emits one part per
 * page. These helpers normalize the two page-varying axes so structurally-equal
 * chrome collapses to a single variant:
 *
 *   1. Instance ids — Wix ids look like `comp-<instance>_r_comp-<component>…`.
 *      The `<instance>` (the segment NOT preceded by `_r_`) is the per-page
 *      placement id; the `_r_comp-<component>` tail is the shared component and
 *      is identical across pages. We rewrite instance ids to positional tokens
 *      (`comp-INSTANCE0`, …) for the dedupe SIGNATURE only — emitted parts keep
 *      their real (unique) ids so DOM and CSS stay self-consistent.
 *
 *   2. Active nav state — the current page's menu item gets `selected="true"`,
 *      `aria-current="page"`, and `data-interactive="false"`. That differs per
 *      page (and is absent on pages not in the menu). [[stripActiveNavState]]
 *      neutralizes it, so the shared header is page-agnostic. (Trade: interior
 *      pages lose their active-item highlight — acceptable for one shared part.)
 */

/**
 * Remove the per-page active-nav markers Wix stamps on the current page's menu
 * item, so headers differing only by which item is "current" canonicalize equal.
 * Applied to BOTH the dedupe signature AND the emitted representative part.
 */
export function stripActiveNavState(html: string): string {
  return html
    // Wix marks the current item with data-selected (NOT a bare `selected`) — match
    // the whole attribute so we don't shear `selected="true"` out of `data-selected`.
    .replace(/ ?data-selected="true"/g, '')
    .replace(/ ?aria-current="page"/g, '')
    // The current item is non-interactive; flip it back so all items match.
    .replace(/data-interactive="false"/g, 'data-interactive="true"');
}

/**
 * Rewrite Wix instance ids (the `comp-X` segment NOT preceded by `_r_`) to
 * positional placeholders in first-appearance order, leaving shared component
 * ids (`_r_comp-Y`) untouched. For SIGNATURE comparison only.
 */
export function canonicalizeInstanceIds(s: string): string {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const m of s.matchAll(/(?<!_r_)comp-([a-z0-9]+)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      order.push(m[1]);
    }
  }
  let out = s;
  order.forEach((inst, i) => {
    // Match the instance token wherever it appears (incl. as the prefix of a
    // nested `comp-<inst>_r_comp-…`), but not when it's the start of a LONGER
    // alphanumeric token, and not the `_r_comp-<component>` tail.
    out = out.replace(new RegExp(`(?<!_r_)comp-${inst}(?![a-z0-9])`, 'g'), `comp-INSTANCE${i}`);
  });
  return out;
}

/**
 * A stable signature for a page's chrome: pages sharing it render an identical
 * header/footer (modulo instance ids + active state) and can share one variant.
 */
export function chromeSignature(headerIsland: string, footerIsland: string): string {
  // Join with a literal control char (NOT a template space, which a tooling
  // quirk can turn into a NUL) and canonicalize instance ids away.
  const neutral = [stripActiveNavState(headerIsland), stripActiveNavState(footerIsland)].join('\u0001');
  return canonicalizeInstanceIds(neutral);
}
