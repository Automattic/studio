// ---------------------------------------------------------------------------
// Chrome detection and stripping
// ---------------------------------------------------------------------------

/**
 * Extract content from a Hostinger Website Builder page.
 *
 * Hostinger's builder is built on Astro/Vue and renders content as
 * <section class="block ...">...</section> blocks. Chrome elements use
 * modifier classes (block-sticky-bar, block--footer, block-header, etc.)
 * which we skip. Generic `class="block"` and `class="block transition..."`
 * sections contain the actual page content.
 *
 * Strategy:
 * 1. Try <main> and <article> first (for sites that have them)
 * 2. Collect <section class="block ..."> content blocks, skipping chrome
 * 3. Fall back to <body> with chrome elements stripped
 */
export const HOSTINGER_CHROME_CLASS = /\b(block-sticky-bar|block-header|block--footer|block-header-cart|block-header-item|block-blog-header)\b/;
export const CHROME_SECTION_STRIP = /<section[^>]*\bclass=["'][^"']*\b(block-sticky-bar|block-header|block--footer|block-blog-header)\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
export const NAV_HEADER_FOOTER_STRIP = [
  /<nav\b[^>]*>[\s\S]*?<\/nav>/gi,
  /<header\b[^>]*>[\s\S]*?<\/header>/gi,
  /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
];

export function stripChrome(html: string): string {
  let out = html;
  for (const pattern of NAV_HEADER_FOOTER_STRIP) out = out.replace(pattern, '');
  return out.replace(CHROME_SECTION_STRIP, '');
}
