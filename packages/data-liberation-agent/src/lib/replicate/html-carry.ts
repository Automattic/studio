//
// Carry-and-scope HTML sanitizer
// ================================
// Unlike `html-fallback.ts` (which strips ALL CSS and returns a bare
// `core/html` block), `carryHtml` preserves class names and structure so
// that scoped CSS generated from the source can still match selectors.
// It EXTRACTS inline `<style>` blocks (returned separately for scoping),
// removes scripts/event-handlers, allowlists only safe iframe embeds,
// and rewrites media/internal-link URLs through the same maps the rest of
// the reconstruction pipeline uses.
//
import * as cheerio from 'cheerio';
import { rewriteMediaUrls } from '../streaming/media-url-rewrite.js';
import { rewriteInternalLinks, type InternalLinkMap } from '../streaming/internal-link-rewrite.js';
import { scanForInjection } from './validate-artifacts.js';

/** Iframe src hostnames (and their subdomains) that are safe to preserve. */
const IFRAME_ALLOW: RegExp[] = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtube-nocookie\.com$/i,
  /(^|\.)vimeo\.com$/i, // also covers player.vimeo.com
  /(^|\.)google\.com$/i, // Maps embeds
];

export interface CarryOpts {
  /** Source media URL -> local upload URL (same map the block path uses). */
  mediaUrlMap?: Map<string, string>;
  /** Source-path -> local-permalink map, for inline links in the region. */
  linkMap?: InternalLinkMap;
}

export interface CarryResult {
  /** Sanitized, URL-rewritten fragment HTML with classes/structure intact. */
  html: string;
  /**
   * Concatenated content of all `<style>` blocks extracted from the region.
   * Empty string when none were present. Returned separately so the caller
   * can scope the CSS before injecting it.
   */
  styleText: string;
}

function iframeAllowed(src: string): boolean {
  try {
    const { hostname } = new URL(src);
    return IFRAME_ALLOW.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

/**
 * Sanitize and URL-rewrite a verbatim region of source HTML.
 *
 * - Keeps class names and element structure intact.
 * - Strips `<script>`, `<noscript>`, `<base>`, and inline event handlers (`on*=`).
 * - Strips `javascript:`/`vbscript:` hrefs (keeps the element + text).
 * - Extracts `<style>` blocks into `styleText` (removes them from `html`).
 * - Removes non-allowlisted `<iframe>` elements.
 * - Rewrites media URLs and internal hrefs via the provided maps.
 * - Throws if the sanitized result still contains injection vectors.
 */
export function carryHtml(regionHtml: string, opts: CarryOpts): CarryResult {
  // URL rewrites run on the RAW string BEFORE cheerio. cheerio's serializer
  // re-encodes `&` to `&amp;` in attribute values, so a CDN URL like
  // `https://cdn/x?w=300&h=200` would no longer exist as a substring post-load
  // and the rewrite (which matches the source URL verbatim) would silently
  // no-op, shipping the source URL. Rewriting first sidesteps that entirely.
  let input = regionHtml;
  if (opts.mediaUrlMap && opts.mediaUrlMap.size > 0) {
    input = rewriteMediaUrls(input, opts.mediaUrlMap);
  }
  if (opts.linkMap && opts.linkMap.size > 0) {
    input = rewriteInternalLinks(input, opts.linkMap);
  }

  // Fragment mode (third arg = false) — no <html><head><body> wrapper injected.
  const $ = cheerio.load(input, null, false);

  // Extract and remove <style> blocks.
  const styles: string[] = [];
  $('style').each((_, el) => {
    styles.push($(el).html() ?? '');
    $(el).remove();
  });

  // Remove script, noscript, and base elements entirely. `<base href>` would
  // re-root every relative link/asset onto the source domain.
  $('script, noscript, base').remove();

  // Remove dead resource-hint <link>s and any <link> pointing at a builder CDN. In a
  // static carry the source SPA runtime never executes, so preload/prefetch/preconnect
  // hints and the builder's JS-bundle CSS chunks (Wix thunderbolt on parastorage/
  // wixstatic) are inert — but a browser would still prefetch them, a needless CDN
  // contact. Genuine links (canonical, icon, local stylesheet) are kept.
  $('link').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    const href = $(el).attr('href') ?? '';
    const isHint = /\b(preload|prefetch|modulepreload|preconnect|dns-prefetch|prerender)\b/.test(rel);
    const isBuilderCdn = /(?:parastorage|wixstatic)\.com|\.wix\.com/i.test(href);
    if (isHint || isBuilderCdn) $(el).remove();
  });

  // Strip inline event handler attributes (onclick, onerror, onload, …).
  $('*').each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs ?? {};
    for (const name of Object.keys(attribs)) {
      if (/^on/i.test(name)) $(el).removeAttr(name);
    }
  });

  // Strip Shopify Dawn's `scroll-trigger` / `scroll-trigger--*` hook classes.
  // They gate `.scroll-trigger.animate--X{opacity:0}` reveal animations that a
  // JS-stripped carry can never fire, leaving the gated sections (footer
  // columns, newsletter, content rows) permanently invisible. Dropping the hook
  // class (not the CSS) un-gates the reveal while leaving non-Dawn sites
  // untouched (the class simply doesn't occur).
  $('[class*="scroll-trigger"]').each((_, el) => {
    const cls = $(el).attr('class') ?? '';
    const cleaned = cls
      .split(/\s+/)
      .filter((c) => c && c !== 'scroll-trigger' && !c.startsWith('scroll-trigger--'))
      .join(' ');
    if (cleaned) $(el).attr('class', cleaned);
    else $(el).removeAttr('class');
  });

  // Strip javascript:/vbscript: hrefs (leading whitespace allowed) — the
  // element + its text are kept, only the dangerous navigation target is dropped.
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (/^\s*(?:javascript|vbscript):/i.test(href)) $(el).removeAttr('href');
  });

  // Remove iframes not in the allowlist.
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (!iframeAllowed(src)) $(el).remove();
  });

  // `object-fit: cover` images are meant to FILL their container — an explicit
  // width/height fixes the box to a captured pixel size and fights that (the
  // builder-site case where a hero/card carries `width:1440px;height:733px`).
  // Drop the explicit width/height (inline declarations AND attributes); keep
  // object-fit/object-position so the cover crop is preserved and the container
  // CSS drives the size.
  $('img[style]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    if (!/object-fit\s*:\s*cover/i.test(style)) return;
    const cleaned = style
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !/^(width|height)\s*:/i.test(d))
      .join('; ');
    if (cleaned) $(el).attr('style', cleaned + ';');
    else $(el).removeAttr('style');
    $(el).removeAttr('width');
    $(el).removeAttr('height');
  });

  // Strip ALL HTML comments. They don't render, so the carry loses nothing, and
  // they're a real injection-gate footgun: cheerio leaves comment nodes untouched,
  // so a commented-out `<script>` (common in Shopify/Wix markup) — or a `<?php`
  // that cheerio rewrote into a comment — survives `.remove()` and trips the
  // `<script`/`<?` scan below. (Well-formed comments can't contain `-->`, so the
  // non-greedy match is safe.)
  const html = $.html().replace(/<!--[\s\S]*?-->/g, '');

  // Injection gate — must pass the same trust boundary as the pattern validator.
  const violations = scanForInjection(html);
  if (violations.length > 0) {
    throw new Error(`html-carry left injection vectors: ${violations.join('; ')}`);
  }

  return {
    html: html.trim(),
    styleText: styles.join('\n'),
  };
}
