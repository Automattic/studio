import type { SectionSpec } from './section-extract.js';
import type { InternalLinkMap } from '../streaming/internal-link-rewrite.js';
import { splitRegions } from './split-regions.js';
import { splitRegionsDeep } from './split-regions-deep.js';
import { carryHtml } from './html-carry.js';
import { scopeCss } from './css-scope.js';
import { treeshakeCss } from './css-treeshake.js';
import { appendNavRevealUnfreeze } from './nav-reveal-unfreeze.js';
import { appendRevealUnfreeze } from './reveal-unfreeze.js';

export interface ReconstructCarryInput {
  slug: string;
  isHome?: boolean;
  bodyHtml: string;
  css: string;
  specs: SectionSpec[];
  mediaUrlMap: Map<string, string>;
  linkMap?: InternalLinkMap;
  /**
   * Classic/adaptive Wix mobile-DOM carry. Such sites serve a SEPARATE, JS-built
   * mobile DOM (~320px) keyed on user-agent — distinct from the desktop DOM the
   * carry froze (no static reflow path → renders 980px on mobile). When the mobile
   * DOM was captured (mobile emulation, scripts stripped) and written to a
   * site-local file at `docUrl`, the page emits a DUAL island: the desktop content
   * wrapped in `.lib-carry-vp-desktop` + a `.lib-carry-vp-mobile` IFRAME of the mobile
   * DOM. The iframe gets its OWN 320px viewport, so Wix's mobile `@media` fire
   * exactly as on the source (inline carrying can't — `@media` is viewport-driven
   * and the WP page is 390px device-width). The theme toggles desktop↔iframe below
   * 750px (`VP_TOGGLE_CSS`). `height` is the captured 320-layout scrollHeight
   * (iframes don't auto-size without JS). Absent → desktop-only (back-compat).
   */
  mobile?: { docUrl: string; height: number };
}

/** The mobile-island iframe: loads the captured mobile DOM at its own 320px viewport.
 *  Exported so the template builder (theme-scaffold-carry) can host the dual-viewport
 *  wrapper itself on the deep-chrome path, keeping post_content as editable section blocks. */
export function mobileFrame(m: { docUrl: string; height: number }): string {
  const src = m.docUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<iframe class="lib-carry-mobile-frame" src="${src}" width="320" height="${m.height}" scrolling="no" title="mobile"></iframe>`;
}

/** Combine the desktop content + the mobile iframe into one dual-viewport island. */
function dualIsland(desktopHtml: string, mobile: { docUrl: string; height: number }): string {
  return island(
    `<div class="lib-carry-vp-desktop">${desktopHtml}</div>` +
      `<div class="lib-carry-vp-mobile">${mobileFrame(mobile)}</div>`,
  );
}

/**
 * Raw wrapper-scaffold chunks that go in the TEMPLATE as core/html (not in
 * post_content). Concatenated with the chrome parts + post-content they rebuild
 * the exact source DOM, so the carried CSS holds while the post holds only the
 * editable content sections. Present only when chrome was located (`splitChrome`).
 */
export interface CarryScaffold {
  openWrap: string;
  midBefore: string;
  midAfter: string;
  closeWrap: string;
}

export interface ReconstructCarryResult {
  /** The page's post_content. When `splitChrome`, this is the content sections
   *  only (N core/html blocks); otherwise the whole carried body as one island. */
  mainIsland: string;
  /** Per-section core/html blocks (the content area). `[mainIsland]` when not split. */
  postContentBlocks: string[];
  headerIsland: string;
  footerIsland: string;
  /** True when deep chrome was found → the template carries the wrapper scaffold
   *  + chrome parts and post_content is content-only. False → legacy single island. */
  splitChrome: boolean;
  /** The wrapper chunks for the template. Present only when `splitChrome`. */
  scaffold?: CarryScaffold;
  /** Source CSS scoped to `body.lib-carry-site` (site-wide), treeshaken against the
   *  header+footer DOM only — styles the shared chrome parts on EVERY page. */
  chromeCss: string;
  /** Source CSS scoped to `body.lib-carry-site.lib-carry-page-<slug>`, treeshaken
   *  against the main DOM only — styles this page's content. */
  mainCss: string;
}

function island(html: string): string {
  return html ? `<!-- wp:html -->\n${html}\n<!-- /wp:html -->` : '';
}

/** Decode the handful of HTML entities that show up in heading/label text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#8217;|&rsquo;/gi, '’')
    .replace(/&#8216;|&lsquo;/gi, '‘')
    .replace(/&#8230;|&hellip;/gi, '…');
}

/**
 * Human-readable label for a carried section, emitted as the block's
 * `metadata.name` so the editor List View shows the section (e.g. "What I Offer")
 * instead of a stack of opaque "Custom HTML" rows — the only practical content
 * indicator for a raw-HTML island. Prefers the section's first heading; falls back
 * to its first visible text, then a positional "Section N". Capped to 48 chars.
 */
export function deriveSectionName(sectionHtml: string, index: number): string {
  const heading = sectionHtml.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const source = heading && heading[1].replace(/<[^>]+>/g, '').trim() ? heading[1] : sectionHtml;
  const clean = decodeEntities(source.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const label = clean.slice(0, 48).trim();
  return label || `Section ${index + 1}`;
}

/** Carry a section as a NAMED `core/html` block (metadata.name → List View label). */
function namedIsland(html: string, name: string): string {
  if (!html) return '';
  return `<!-- wp:html ${JSON.stringify({ metadata: { name } })} -->\n${html}\n<!-- /wp:html -->`;
}

/**
 * Pure per-page emitter for the carry-and-scope parity path.
 *
 * Orchestrates the pure modules in order:
 *   1. splitRegions  — splits body into header / main / footer
 *   2. carryHtml     — sanitizes each region, extracts inline <style> blocks
 *   3. scopeCss      — prepends the page-scoped or site-scoped wrapper selector
 *   4. treeshakeCss  — drops rules that match nothing in the target DOM
 *
 * Returns three `core/html` block strings and two scoped+treeshaken CSS strings:
 *   - chromeCss: site-wide scoped, treeshaken against header+footer DOM (shared chrome)
 *   - mainCss:   per-page scoped, treeshaken against the main DOM (page content only)
 *
 * No IO: callers are responsible for persisting outputs.
 */
export function reconstructPageCarry(input: ReconstructCarryInput): ReconstructCarryResult {
  const carryOpts = { mediaUrlMap: input.mediaUrlMap, linkMap: input.linkMap };
  const SITE_SCOPE = 'body.lib-carry-site';
  const pageScope = `body.lib-carry-site.lib-carry-page-${input.slug}`;
  const rewriteUrl = (u: string): string | null => input.mediaUrlMap.get(u) ?? null;

  // Carry the WHOLE body ONCE (sanitize, strip scripts, rewrite media/link URLs,
  // extract inline <style>). Splitting the already-carried string with byte ops
  // keeps the chunks lossless — running cheerio on an unbalanced wrapper fragment
  // would auto-close it and break the concatenation.
  const carried = carryHtml(input.bodyHtml, carryOpts);
  const split = splitRegionsDeep(carried.html);

  if (split.found) {
    // Deep chrome path: chrome → parts, wrapper chunks → template, sections → post.
    const chromeDom = `${split.headerHtml}${split.footerHtml}`;
    const allCss = [input.css, carried.styleText].filter(Boolean).join('\n');
    const chromeCss = chromeDom
      ? appendRevealUnfreeze(
          appendNavRevealUnfreeze(
            treeshakeCss(scopeCss(allCss, { scope: SITE_SCOPE, scopeId: 'site', rewriteUrl }), chromeDom),
            chromeDom,
            SITE_SCOPE,
          ),
          allCss,
          chromeDom,
          SITE_SCOPE,
        )
      : '';
    // Page sheet treeshakes against the NON-chrome DOM so chrome rules live only
    // in the site-wide sheet, not duplicated per page.
    const mainDom =
      split.openWrap + split.midBefore + split.sectionsHtml.join('') + split.midAfter + split.closeWrap;
    const mainCss = appendRevealUnfreeze(
      appendNavRevealUnfreeze(
        treeshakeCss(scopeCss(allCss, { scope: pageScope, scopeId: input.slug, rewriteUrl }), mainDom),
        mainDom,
        pageScope,
      ),
      allCss,
      mainDom,
      pageScope,
    );
    const postContentBlocks = split.sectionsHtml.map((s, i) => namedIsland(s, deriveSectionName(s, i)));
    return {
      // post_content is ALWAYS the per-section core/html blocks — even under mobile
      // carry. The dual-viewport wrapper (`.lib-carry-vp-desktop` + the mobile-DOM
      // iframe) is hosted by the TEMPLATE (scaffoldedTemplate wraps `wp:post-content`),
      // not baked into post_content, so the post stays editable section blocks. The
      // rendered DOM is identical to the old single dual-island. (The legacy path below
      // still inlines `dualIsland` — it has no scaffold/template to carry the wrapper.)
      mainIsland: postContentBlocks.join('\n'),
      postContentBlocks,
      headerIsland: island(split.headerHtml),
      footerIsland: island(split.footerHtml),
      splitChrome: true,
      scaffold: {
        openWrap: split.openWrap,
        midBefore: split.midBefore,
        midAfter: split.midAfter,
        closeWrap: split.closeWrap,
      },
      chromeCss,
      mainCss,
    };
  }

  // Legacy fallback: no deep chrome → try a top-level <header>/<footer> split and
  // emit the whole body as one island.
  const regions = splitRegions(input.bodyHtml, input.specs);
  const main = carryHtml(regions.mainHtml, carryOpts);
  const header = regions.headerHtml ? carryHtml(regions.headerHtml, carryOpts) : { html: '', styleText: '' };
  const footer = regions.footerHtml ? carryHtml(regions.footerHtml, carryOpts) : { html: '', styleText: '' };

  const chromeDom = `${header.html}${footer.html}`;
  const chromeCombined = [input.css, header.styleText, footer.styleText].filter(Boolean).join('\n');
  const chromeCss = chromeDom
    ? appendRevealUnfreeze(
        appendNavRevealUnfreeze(
          treeshakeCss(scopeCss(chromeCombined, { scope: SITE_SCOPE, scopeId: 'site', rewriteUrl }), chromeDom),
          chromeDom,
          SITE_SCOPE,
        ),
        chromeCombined,
        chromeDom,
        SITE_SCOPE,
      )
    : '';
  const mainCombined = [input.css, main.styleText].filter(Boolean).join('\n');
  const mainCss = appendRevealUnfreeze(
    appendNavRevealUnfreeze(
      treeshakeCss(scopeCss(mainCombined, { scope: pageScope, scopeId: input.slug, rewriteUrl }), main.html),
      main.html,
      pageScope,
    ),
    mainCombined,
    main.html,
    pageScope,
  );

  const mainIsland = input.mobile ? dualIsland(main.html, input.mobile) : island(main.html);
  return {
    mainIsland,
    postContentBlocks: mainIsland ? [mainIsland] : [],
    headerIsland: island(header.html),
    footerIsland: island(footer.html),
    splitChrome: false,
    chromeCss,
    mainCss,
  };
}
