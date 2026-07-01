import { sanitizeSourceHtml } from '../streaming/html-sanitize.js';

export function wrapFragment(fragmentHtml: string, slug: string, bodyClasses: string[]): string {
  const safe = sanitizeSourceHtml(fragmentHtml);
  const cls = ['dla-replica', 'dla-content-desktop', `dla-page-${slug}`, ...bodyClasses].join(' ');
  return `<div class="${cls}">\n${safe}\n</div>`;
}

/**
 * Wrap the mobile body fragment for viewport-toggled rendering.
 * The `dla-content-mobile` outer div is the clipping/height-reserving shell;
 * `dla-content-mobile-inner` is the element that receives the CSS transform
 * scaling the fixed-width mobile canvas down to the viewport width.
 */
export function wrapMobileFragment(fragmentHtml: string, slug: string, bodyClasses: string[]): string {
  const safe = sanitizeSourceHtml(fragmentHtml);
  const cls = ['dla-replica', 'dla-content-mobile', `dla-page-${slug}`, ...bodyClasses].join(' ');
  return `<div class="${cls}">\n<div class="dla-content-mobile-inner">\n${safe}\n</div>\n</div>`;
}

// Rewrite top-level `body`/`html` selector tokens to `.dla-replica`; optionally
// prefix every selector with `.dla-page-<slug>` (for page-specific inline CSS).
export function scopeCss(css: string, slug: string, scopePage: boolean): string {
  let out = css.replace(/(^|[\s,{>+~])(html|body)(?=[\s,{>+~:]|$)/g, (_m, pre) => `${pre}.dla-replica`);
  if (scopePage) {
    out = out.replace(/(^|})\s*([^{}]+?)\s*\{/g, (_m, brace, sel) => {
      const scoped = sel.split(',').map((s: string) => `.dla-page-${slug} ${s.trim()}`).join(', ');
      return `${brace}${scoped}{`;
    });
  }
  return out;
}
