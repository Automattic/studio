// src/lib/replicate/local-theme/chrome-parts.ts
//
// Header/footer template parts for the local-site (owned-source) theme.
// Header = site-title + core/navigation built from the stage-1a nav graph
// (spec: "nav → core/navigation from navGraph", core-mapped interactivity —
// core/navigation carries its own responsive/overlay behavior, zero custom JS).
// Footer = the captured footer Section rendered through the stage-1a block
// emitter, falling back to a minimal credit line.
//
// FOOTER EMISSION (probe + review follow-up):
// emitSectionBlocks' root selector 'section, article, main, div' does NOT match
// a <footer> root — container falls back to $('body') and the WHOLE footer
// collapses into one catch-all paragraph (content blob-merged, hrefs lost).
// buildFooterPart therefore renames the root <footer> → <div> before emitting,
// so each direct child becomes its own block. Bare-<a> href loss inside
// emitChild remains a known limitation (tracked separately).
//
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { InstanceStyleSheet } from '../normalize/instance-styles.js';
import { emitSectionBlocks, escapeHtml, attrJson } from '../normalize/emit-blocks.js';
import { slugFromRelPath } from '../local-site/ingest.js';
import { rewriteInternalHrefs, slugToUrl } from '../local-site/href-rewrite.js';
import type { NavLink, Section, StickyBehavior } from '../local-site/types.js';

/**
 * Pick the nav links to render: when the home page has edges marked inNav (from
 * a <nav> element), use ONLY those — a header brand anchor or body link must not
 * hijack a menu slot (walrus E2E regression: brand label replaced "Home"). Falls
 * back to all home edges when none are marked inNav, then to one link per
 * non-home page (label = title-cased slug) when home has no outgoing links.
 */
export function selectNavLinks(nav: NavLink[], pageSlugs: string[]): Array<{ label: string; url: string }> {
  const fromHome = nav.filter((l) => l.fromSlug === 'home');
  // Prefer real <nav> links — brand anchors and body links are excluded when inNav edges exist.
  const pool = fromHome.some((l) => l.inNav) ? fromHome.filter((l) => l.inNav) : fromHome;
  const seen = new Set<string>();
  const links: Array<{ label: string; url: string }> = [];
  for (const l of pool) {
    if (seen.has(l.toSlug)) continue;
    seen.add(l.toSlug);
    links.push({ label: l.label || l.toSlug, url: slugToUrl(l.toSlug) });
  }
  if (links.length > 0) return links;
  return pageSlugs.filter((s) => s !== 'home').map((s) => ({
    label: s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    url: slugToUrl(s),
  }));
}

export interface HeaderPartOpts {
  /** Stage 1d carry mode: emit BARE site-title + navigation with no styled
   * wrapper — the template part's own <header> element carries the source
   * `header { … }` layout rules (flex/padding), so our decorative wrapper
   * would fight them. Default false (tokens path keeps the styled wrapper). */
  plain?: boolean;
  /** nativeBehaviors: append the dla/sticky state block after the nav (plain
   * carry mode only — the tokens path has no carried chrome to toggle). Zero
   * visual footprint: an empty marker div whose view.js climbs
   * closest('header'), so the toggled class lands on the template-part
   * <header> wrapper the carried `header.<class>` rules target. */
  sticky?: StickyBehavior;
}

/**
 * Empty marker block carrying the sticky scroll state (Interactivity API).
 * The JSON rides BOTH the comment attrs and the single-quoted data-wp-context
 * attribute: attrJson covers the kses '--' trap (toggleClass may legally
 * contain '--'); the ' escape keeps a pathological single quote from
 * breaking out of the attribute (detection constrains toggleClass to
 * [a-zA-Z0-9_-]+ — this is belt-and-braces).
 */
function stickyStateBlock(sticky: StickyBehavior): string {
  const json = `{"toggleClass":${attrJson(sticky.toggleClass)},"offset":${JSON.stringify(sticky.offset)}}`.replace(
    /'/g,
    '\\u0027',
  );
  // display:none keeps the marker OUT of the header's flex layout (a 0x0 div
  // still counts as a justify-content:space-between item — walrus: nav pushed
  // from x=1023 to 639); iAPI hydration is a DOM walk and the view listener is
  // on window with closest('header'), both visibility-independent.
  return (
    `\n<!-- wp:dla/sticky ${json} -->\n` +
    `<div class="wp-block-dla-sticky" style="display:none" data-wp-interactive="dla/sticky"` +
    ` data-wp-context='${json}' data-wp-init="callbacks.init"></div>\n` +
    `<!-- /wp:dla/sticky -->`
  );
}

export function buildHeaderPart(
  siteTitle: string,
  nav: NavLink[],
  pageSlugs: string[],
  opts: HeaderPartOpts = {},
): string {
  const links = selectNavLinks(nav, pageSlugs)
    .map((l) => `<!-- wp:navigation-link {"label":${attrJson(l.label)},"url":${attrJson(l.url)}} /-->`)
    .join('\n');
  const siteTitleBlock = `<!-- wp:site-title {"level":0,"className":"brand"} /-->`;
  if (opts.plain) {
    // overlayMenu:never — mirror the source exactly (its nav has no JS menu;
    // links simply wrap on small screens under the carried source CSS).
    const plainNav = `<!-- wp:navigation {"overlayMenu":"never","layout":{"type":"flex"}} -->\n${links}\n<!-- /wp:navigation -->`;
    const sticky = opts.sticky ? stickyStateBlock(opts.sticky) : '';
    return `${siteTitleBlock}\n${plainNav}${sticky}`;
  }
  const navBlock = `<!-- wp:navigation {"overlayMenu":"mobile","layout":{"type":"flex"}} -->\n${links}\n<!-- /wp:navigation -->`;
  return (
    `<!-- wp:group {"align":"full","layout":{"type":"flex","justifyContent":"space-between"},"style":{"spacing":{"padding":{"top":"1rem","bottom":"1rem","left":"1.5rem","right":"1.5rem"}}}} -->\n` +
    `<div class="wp-block-group alignfull" style="padding-top:1rem;padding-right:1.5rem;padding-bottom:1rem;padding-left:1.5rem">` +
    `${siteTitleBlock}\n` +
    navBlock +
    `</div>\n` +
    `<!-- /wp:group -->`
  );
}

export function buildCarriedHeaderPart(
  header: Section,
  opts: {
    pageSlugs?: string[];
    instanceStyles?: InstanceStyleSheet;
    sticky?: StickyBehavior;
    labelToUrl?: (label: string, sourceHref: string) => string | undefined;
  } = {},
): string {
  let html = header.html;
  if (opts.pageSlugs?.length) html = rewriteInternalHrefs(html, opts.pageSlugs);
  if (opts.labelToUrl) {
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const label = $(el).text().trim();
      const href = $(el).attr('href') ?? '';
      const resolved = opts.labelToUrl?.(label, href);
      if (resolved) $(el).attr('href', resolved);
    });
    html = $('body').html() ?? html;
  }
  const normalized = {
    ...header,
    html: html.replace(/^<header(\b[^>]*>)/i, '<div$1').replace(/<\/header>\s*$/i, '</div>'),
  };
  const sticky = opts.sticky ? `\n${stickyStateBlock(opts.sticky)}` : '';
  // verbatimInteractive: the header's button-toggled dropdown nav + any inline
  // -svg icons survive as core/html islands, which the unwrap below turns into
  // raw markup — preserving the <button>/<svg>/has-children classes the carried
  // CSS (:hover/.is-open) + source JS toggle key off.
  const markup = emitSectionBlocks(normalized, {
    wrapper: 'div',
    instanceStyles: opts.instanceStyles,
    verbatimInteractive: true,
  }).markup.replace(/<!-- wp:html -->\n?([\s\S]*?)\n?<!-- \/wp:html -->/g, (_match, inner: string) => inner.trim());
  return markup + sticky;
}

export function buildCarriedSidebarPart(
  sidebar: Section,
  opts: {
    pageSlugs?: string[];
  } = {},
): string {
  let html = sidebar.html;
  if (opts.pageSlugs?.length) html = rewriteInternalHrefs(html, opts.pageSlugs);
  // Preserve source chrome structure: docs sidebars often carry a `.sidebar-nav`
  // nav plus a per-page `.toc-list`; block emission flattens plain nav wrappers.
  return html.trim();
}

export interface FooterPartOpts {
  /** Site page slugs — internal footer hrefs are rewritten to /slug/ permalinks. */
  pageSlugs?: string[];
  /** theme.json palette slug applied as the footer wrapper background (e.g. 'surface-inverse'). */
  bgToken?: string;
  /** theme.json palette slug applied as the footer wrapper text color (e.g. 'text-inverse'). */
  textToken?: string;
  /** Shared instance-style sheet: footer element inline styles are carried as
   * lib-i<hash> classes + rules here (same sheet as the page bodies, so the
   * footer's rules land in the SAME carried instance-styles.css). */
  instanceStyles?: InstanceStyleSheet;
}

/**
 * Wrap footer markup in a token-styled full-width group. The theme scaffold's
 * own footerBgToken/footerTextToken opts are inert for the local path (we swap
 * parts/footer.html with OUR part unconditionally), so the band styling must
 * live on the part we build. No tokens → markup returned unchanged. Class
 * emission follows the @wordpress/blocks canonical serialized order
 * (has-<text>-color has-<bg>-background-color has-text-color has-background —
 * same shape as theme-scaffold's footer groups) so editor re-serialization
 * keeps the styling (block-fixer canonicalization constraint).
 */
function wrapFooterGroup(inner: string, opts: FooterPartOpts): string {
  if (!opts.bgToken && !opts.textToken) return inner;
  const attrs: string[] = ['"align":"full"'];
  if (opts.bgToken) attrs.push(`"backgroundColor":"${opts.bgToken}"`);
  if (opts.textToken) attrs.push(`"textColor":"${opts.textToken}"`);
  attrs.push('"layout":{"type":"constrained"}', '"style":{"spacing":{"padding":{"top":"2.5rem","bottom":"2.5rem"}}}');
  const classes = ['wp-block-group', 'alignfull'];
  if (opts.textToken) classes.push(`has-${opts.textToken}-color`);
  if (opts.bgToken) classes.push(`has-${opts.bgToken}-background-color`);
  if (opts.textToken) classes.push('has-text-color');
  if (opts.bgToken) classes.push('has-background');
  return (
    `<!-- wp:group {${attrs.join(',')}} -->\n` +
    `<div class="${classes.join(' ')}" style="padding-top:2.5rem;padding-bottom:2.5rem">${inner}</div>\n` +
    `<!-- /wp:group -->`
  );
}

// rewriteInternalHrefs moved to local-site/href-rewrite.ts (shared with the
// page-body emission pass and the runtime link-shim map) — re-imported above.

export function buildFooterPart(footer: Section | null, siteTitle: string, opts: FooterPartOpts = {}): string {
  if (footer) {
    // <footer> root won't match emitSectionBlocks' 'section,article,main,div' selector
    // → container falls to $('body') and the whole footer collapses into one catch-all
    // paragraph (hrefs lost, content blob-merged). Renaming the root to <div> makes
    // each direct child emit as its own block. Bare-<a> href loss remains a known
    // emitChild limitation (tracked separately).
    let html = footer.html;
    if (opts.pageSlugs?.length) html = rewriteInternalHrefs(html, opts.pageSlugs);
    const normalized = {
      ...footer,
      html: html.replace(/^<footer(\b[^>]*>)/i, '<div$1').replace(/<\/footer>\s*$/i, '</div>'),
    };
    // wrapper:'div' — footer content is chrome, not a body section; the section
    // tag would attract the carried source's section margin rules (+88px).
    // verbatimInteractive + island-unwrap (same as the header part): a footer
    // may carry an inline-svg badge and a signup form — block conversion would
    // turn the <svg> into an empty core/group and drop its <path>s. The unwrap
    // turns the island into raw markup so the theme-file policy sees plain HTML
    // (no custom-html block).
    const inner = emitSectionBlocks(normalized, {
      wrapper: 'div',
      instanceStyles: opts.instanceStyles,
      verbatimInteractive: true,
    }).markup.replace(/<!-- wp:html -->\n?([\s\S]*?)\n?<!-- \/wp:html -->/g, (_m, x: string) => x.trim());
    return wrapFooterGroup(inner, opts);
  }
  return wrapFooterGroup(
    `<!-- wp:group {"align":"full","layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem"}}}} -->\n` +
      `<div class="wp-block-group alignfull" style="padding-top:2rem;padding-bottom:2rem">` +
      `<!-- wp:paragraph {"align":"center"} -->\n<p class="has-text-align-center">${escapeHtml(siteTitle)}</p>\n<!-- /wp:paragraph -->` +
      `</div>\n` +
      `<!-- /wp:group -->`,
    opts,
  );
}

// --- JS-rendered chrome mounts ------------------------------------------------
//
// JS-rendered sites ship EMPTY id-divs the runtime fills (renderHeader() into
// <div id="siteHeader">). Those mounts sit OUTSIDE <main> (often nested in a
// page wrapper), so segmentation never sees them as chrome and the carried JS
// has no target in the replica. When found, the header/footer PARTS become the
// verbatim mounts — the carried source JS then renders chrome at runtime on
// both sides (philosophy: the source JS is MAINTAINED as the behavior layer;
// the block layout preserves the DOM contract it targets).

export interface ChromeMount {
  id: string;
  classes: string[];
}

export interface ChromeMounts {
  header?: ChromeMount;
  footer?: ChromeMount;
}

/** Empty (no element children, no text) id-bearing div outside <main>:
 * last one before main = header mount, first one after = footer mount. */
export function findChromeMounts(html: string): ChromeMounts {
  const $ = cheerio.load(html);
  const main = $('main').first();
  if (main.length === 0) return {};
  const all = $('*').toArray() as Element[];
  const mainIdx = all.indexOf(main.get(0)!);
  const out: ChromeMounts = {};
  for (const el of all) {
    if (el.tagName !== 'div') continue;
    const $el = $(el);
    const id = $el.attr('id');
    if (!id) continue;
    if (main.length && ($.contains(main.get(0)!, el) || main.get(0) === el)) continue;
    if ($el.children().length > 0 || $el.text().trim()) continue; // populated = content, not a mount
    const idx = all.indexOf(el);
    const classes = ($el.attr('class') ?? '').split(/\s+/).filter(Boolean);
    if (idx < mainIdx) {
      out.header = { id, classes }; // keep overwriting — LAST before main is closest
    } else if (!out.footer) {
      out.footer = { id, classes }; // FIRST after main
    }
  }
  return out;
}

/** The mount as a part: an anchored EMPTY group div (NOT wp:html — the theme
 * policy check rejects custom-html blocks in theme files). Carried JS renders
 * into it by id; the extra wp-block-group class is inert to source CSS. The
 * optional sticky state block rides the header mount exactly as it rides the
 * plain built header (its view.js climbs closest('header') — the part
 * wrapper). */
export function mountPartMarkup(mount: ChromeMount, sticky?: StickyBehavior): string {
  const cls = mount.classes.join(' ');
  const pairs = [`"anchor":${attrJson(mount.id)}`, '"tagName":"div"'];
  if (cls) pairs.push(`"className":${attrJson(cls)}`);
  const divCls = ['wp-block-group', cls].filter(Boolean).join(' ');
  const stickyBlock = sticky ? `\n${stickyStateBlock(sticky)}` : '';
  return (
    `<!-- wp:group {${pairs.join(',')}} -->\n` +
    `<div id="${escapeHtml(mount.id)}" class="${escapeHtml(divCls)}"></div>\n` +
    `<!-- /wp:group -->${stickyBlock}`
  );
}
