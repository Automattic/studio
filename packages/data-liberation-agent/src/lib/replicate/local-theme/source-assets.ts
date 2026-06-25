// src/lib/replicate/local-theme/source-assets.ts
//
// Stage 1d: carry the SOURCE site's CSS/JS into the theme so the
// class-preserving block DOM (emit-blocks className/anchor) renders under the
// designer's own stylesheet — the path to ~100% parity. We OWN the source, so
// divergences are fixed by deterministic adaptation here, not approximation:
//   - Google-Fonts @import/link CSS is stripped (faces are already self-hosted
//     by google-fonts.ts under the same family names).
//   - A small WP-compat layer is PREPENDED (lowest precedence) neutralizing
//     WP wrapper interference (template-part div, root layout padding).
// JS is carried verbatim (user decision: identical replication; the spec's
// off-by-default hatch is deliberately ON for this flow) — functions.php adds
// the html.js class snippet so source reveal-gates behave as authored.
//
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

/** Neutralize WP-injected wrappers so source layout selectors keep working.
 * Prepended (lowest precedence) — source rules always win over it. */
export const WP_COMPAT_CSS = `/* wp-compat: neutralize WP wrapper interference for carried source CSS */
/* NOTE deliberately NO .wp-block-template-part{display:contents} here: our
   parts use tagName header/footer, so the wrapper IS the semantic element —
   display:contents would destroy the box that source header{}/footer{} rules
   lay out (class specificity beats the element selector regardless of order).
   NOTE also deliberately NO blanket child-margin zeroing: the source relies on
   browser-default element margins (p, h1-h6, ul) — zeroing layout children
   collapsed the source's vertical rhythm. Blocks render as the same semantic
   elements, so the defaults already match. */
:where(body) { margin: 0; }
/* WP renders site-title as a <p> (default margins the source brand <a> never
   had) and wraps tables in a margined <figure>. Zero-spec so source rules win.
   The table figure is emitted CLASSLESS (block-library's .wp-block-table
   td/th rules would out-rank source element rules), so target it via :has. */
:where(.wp-block-site-title) { margin: 0; }
:where(figure:has(> table)) { margin: 0; }
/* Structural transparency for core/navigation: the source styles nav > a
   directly, while WP renders nav > ul > li > a. Collapsing the list boxes
   makes the anchors direct flex items of <nav>, so the source nav rules
   (display/gap/wrap/justify) drive the exact same geometry. Class-level
   specificity is required — block-library sets display:flex on these at
   (0,1,0)+ and a zero-spec :where loses (probe: anchors stayed inside the
   ul, justify-content flex-start left-packed the rows). Safe: source
   stylesheets never target wp-* classes. */
nav.wp-block-navigation ul, nav.wp-block-navigation li { display: contents; }
/* WP sets .wp-block-post-content{display:flow-root}, which BLOCKS the
   margin collapse the source layout relies on (last section margin-bottom
   collapsing with the footer margin-top — walrus probe: footer sat 88px
   lower). Class-level specificity is required to beat WP's own class rule;
   safe because no source stylesheet targets a wp-* class. */
.wp-block-post-content { display: block; }
/* core/button renders TWO boxes: the source button class lands on the
   .wp-block-button WRAPPER (core/button stores className there; the fixer
   strips it off the inner link), so the carried .btn/.btn-* rules style the
   wrapper pill — while the inner .wp-block-button__link still carries BOTH WP's
   default button chrome (fill bg + padding + radius) AND the carried source
   button class the emitter writes onto the link (a .btn box-shadow of 6px 6px 0
   ink casts a hard offset shadow behind the label — the double-border bug). Strip the
   inner link's whole box (incl. box-shadow) so the carried wrapper style renders
   once. The lib-cta marker (emit-blocks) scopes this to carried
   buttons so genuine native core/button blocks keep their chrome; class-level
   specificity beats WP's :where()/global-styles button defaults, and source
   stylesheets never target wp-* classes. */
.wp-block-button.lib-cta > .wp-block-button__link {
  background: transparent;
  border: 0;
  box-shadow: none;
  padding: 0;
  border-radius: inherit;
  color: inherit;
  text-decoration: none;
}
`;

const GOOGLE_IMPORT_RE = /@import\s+url\(\s*['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/g;

/** Image url() targets we localize. Fonts (woff2/woff/ttf/otf/eot) are owned by
 * the font pipeline (google-fonts.ts / @font-face self-host) and deliberately
 * NOT touched here — they already resolve via the assets/fonts/ structural
 * parallel. Data URIs and remote URLs are left verbatim. */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)$/i;
/** Conservative url() matcher: optional matching quote, no embedded ')' — so a
 * data: URI with internal parens (the SVG-noise filter) never matches as a
 * whole and is left verbatim. */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** One source image referenced from carried CSS that must be copied into the
 * theme so its rewritten relative url() resolves. */
export interface MediaAsset {
  /** Absolute path to the source file on disk. */
  srcAbs: string;
  /** Theme-relative destination (e.g. assets/css/media/plate.jpg) — sits next
   * to the carried source.css so the rewritten `url(media/<name>)` resolves. */
  themeRel: string;
}

/** One HTML <img src> reference carried from a source page into the theme. */
export interface ImgAssetRef {
  /** Exact src string as authored in the page HTML (e.g. "assets/logo.svg"). */
  ref: string;
  /** Theme-relative destination the file was copied to (e.g. assets/img/logo.svg). */
  themeRel: string;
}

export interface SourceAssets {
  /** Compat layer + all source CSS (linked files in DOCUMENT order, then unlinked top-level fallback, then inline <style> blocks). */
  css: string;
  /** All source JS concatenated (linked scripts in DOCUMENT order, then unlinked top-level fallback). */
  js: string;
  /** Relative paths (subdir-aware) in concatenation order. */
  cssFiles: string[];
  jsFiles: string[];
  /** Top-level files SKIPPED because linked assets exist (stale-revision
   * protection — see the pass-2 comment). Surface as a warning upstream. */
  skippedUnlinked: string[];
  /** Image files referenced via CSS url() that the handler must copy into the
   * theme (the css urls are already rewritten to point at them). */
  mediaAssets: MediaAsset[];
  /** Image files referenced via HTML <img src> that the handler must copy into
   * the theme. Unlike CSS images these are NOT pre-rewritten (post_content has
   * no carried-stylesheet anchor) — the handler repoints each <img> using the
   * per-page rewrite list below. */
  imgAssets: MediaAsset[];
  /** Per source page (keyed by relPath): the exact <img src> ref strings found
   * and the theme-relative path each was carried to, for the handler's rewrite. */
  imgRewritesByPage: Record<string, ImgAssetRef[]>;
}

/** Theme subdir (relative to assets/css/source.css) holding carried CSS images. */
const MEDIA_SUBDIR = 'media';

/**
 * Rewrite relative image url() refs in each CSS part to point at a flat media/
 * dir beside the carried stylesheet, returning the source→theme copy list.
 * Pure except for existsSync (a ref to a missing file is left verbatim — we
 * never fabricate an asset). url()s are resolved per the part's SOURCE dir
 * (a relative img/ means different files in assets/site.css vs a root inline
 * style), then flattened to a single basename (collision-suffixed) so one
 * predictable media/ dir holds them all. Fonts, data URIs, and remote URLs
 * are untouched.
 */
export function localizeCssImages(
  parts: Array<{ css: string; baseDir: string }>,
  dir: string,
): { parts: string[]; mediaAssets: MediaAsset[] } {
  const bySrc = new Map<string, string>(); // srcAbs → assigned basename
  const usedNames = new Set<string>();
  const mediaAssets: MediaAsset[] = [];

  const assign = (srcAbs: string, rawName: string): string => {
    const existing = bySrc.get(srcAbs);
    if (existing) return existing;
    let name = rawName;
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let n = 2;
      while (usedNames.has(`${stem}-${n}${ext}`)) n++;
      name = `${stem}-${n}${ext}`;
    }
    usedNames.add(name);
    bySrc.set(srcAbs, name);
    mediaAssets.push({ srcAbs, themeRel: `assets/css/${MEDIA_SUBDIR}/${name}` });
    return name;
  };

  const outParts = parts.map(({ css, baseDir }) =>
    css.replace(CSS_URL_RE, (whole, _q: string, raw: string) => {
      if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('#')) return whole;
      const cleaned = raw.split(/[?#]/)[0];
      if (!IMAGE_EXT_RE.test(cleaned)) return whole; // fonts + non-image left verbatim
      // Resolve relative to the part's source dir; leading-slash = site root.
      const within = cleaned.startsWith('/')
        ? posix.normalize(cleaned.slice(1))
        : posix.normalize(posix.join(baseDir, cleaned));
      if (within.startsWith('..')) return whole; // never escape the source root
      const srcAbs = join(dir, within);
      if (!existsSync(srcAbs)) return whole; // missing → leave as authored
      const name = assign(srcAbs, posix.basename(within));
      return `url(${MEDIA_SUBDIR}/${name})`;
    }),
  );
  return { parts: outParts, mediaAssets };
}

/** Inline <script> bodies are carried into the concatenated bundle ONLY when
 * they are executable JS — type absent/empty, a JS MIME, or `module`. Data
 * blocks (`application/ld+json` SEO, `application/json`, `importmap`,
 * `speculationrules`, `text/*` microtemplates) are NOT JS: concatenating one
 * injects a parse-time SyntaxError that aborts the ENTIRE bundle (the per-chunk
 * try/catch catches RUNTIME throws only, never parse errors), silently killing
 * every carried behavior — reveal, nav, accordions. So they are skipped. */
const EXECUTABLE_INLINE_JS_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'module',
]);
function isExecutableInlineScript(openTagAttrs: string): boolean {
  const m = openTagAttrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!m) return true; // no type attribute → classic JS
  const type = (m[1] ?? m[2] ?? m[3] ?? '').trim().toLowerCase();
  if (type === '') return true; // type="" is classic JS per the HTML spec
  return EXECUTABLE_INLINE_JS_TYPES.has(type);
}

/** Theme subdir (relative to the theme root) holding carried HTML <img> assets. */
const IMG_SUBDIR = 'assets/img';

/** Harvest LOCAL <img src> image references from each page's HTML, returning the
 * copy-list (unique source files → a flat assets/img/<name>, collision-suffixed)
 * and a per-page rewrite list (exact ref string → themeRel). The handler copies
 * the files into the theme and repoints each <img src> at the theme URL — HTML
 * <img>s, unlike CSS url()s, have no carried stylesheet to anchor a relative
 * path against, so they need an absolute theme URL. Remote (http/protocol-
 * relative), data:, fragment, and missing refs are left verbatim (never
 * fabricated). */
export function collectHtmlImages(
  pageHtmls: Array<{ html: string; relPath: string }>,
  dir: string,
): { imgAssets: MediaAsset[]; rewritesByPage: Record<string, ImgAssetRef[]> } {
  const bySrc = new Map<string, string>(); // srcAbs → assigned basename
  const usedNames = new Set<string>();
  const imgAssets: MediaAsset[] = [];
  const rewritesByPage: Record<string, ImgAssetRef[]> = {};

  const assign = (srcAbs: string, rawName: string): string => {
    const existing = bySrc.get(srcAbs);
    if (existing) return existing;
    let name = rawName;
    if (usedNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let n = 2;
      while (usedNames.has(`${stem}-${n}${ext}`)) n++;
      name = `${stem}-${n}${ext}`;
    }
    usedNames.add(name);
    bySrc.set(srcAbs, name);
    imgAssets.push({ srcAbs, themeRel: `${IMG_SUBDIR}/${name}` });
    return name;
  };

  for (const { html, relPath } of pageHtmls) {
    const baseDir = posix.dirname(relPath);
    const seenRefs = new Set<string>();
    const list: ImgAssetRef[] = [];
    // `\ssrc` (whitespace-anchored) so `data-src` / `xlink:href` never match.
    for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) {
      const ref = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!ref || seenRefs.has(ref)) continue;
      if (/^(?:https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) continue;
      const cleaned = ref.split(/[?#]/)[0];
      const within = cleaned.startsWith('/')
        ? posix.normalize(cleaned.slice(1))
        : posix.normalize(posix.join(baseDir, cleaned));
      if (within.startsWith('..')) continue; // never escape the source root
      const srcAbs = join(dir, within);
      if (!existsSync(srcAbs)) continue; // missing → leave as authored
      seenRefs.add(ref);
      const name = assign(srcAbs, posix.basename(within));
      list.push({ ref, themeRel: `${IMG_SUBDIR}/${name}` });
    }
    if (list.length > 0) rewritesByPage[relPath] = list;
  }
  return { imgAssets, rewritesByPage };
}

/** Repoint carried <img src> refs at the theme-carried copies. Pure string
 * replacement bounded by the surrounding quote so a path token can't match
 * inside another attribute; safe because the refs are literal source paths. */
export function rewriteHtmlImageSrcs(html: string, refs: ImgAssetRef[], themeSlug: string): string {
  let out = html;
  for (const { ref, themeRel } of refs) {
    const themeUrl = `/wp-content/themes/${themeSlug}/${themeRel}`;
    out = out.split(`"${ref}"`).join(`"${themeUrl}"`).split(`'${ref}'`).join(`'${themeUrl}'`);
  }
  return out;
}

export function collectSourceAssets(
  dir: string,
  pages: Array<{ relPath: string; html: string }>,
): SourceAssets {
  const cssFiles: string[] = [];
  const jsFiles: string[] = [];
  // Each CSS part carries the SOURCE dir it came from so relative image url()s
  // resolve correctly (a bare `img/x.jpg` means assets/img/x.jpg in
  // assets/site.css but img/x.jpg in a root inline style).
  const cssParts: Array<{ css: string; baseDir: string }> = [];
  const jsParts: string[] = [];

  // Pass 1: linked assets in DOCUMENT order — the page's <link rel=stylesheet>
  // / <script src> sequence IS the author's cascade; alphabetical reads would
  // invert it (e.g. overrides.css before theme.css → wrong winner). First-seen
  // dedup across pages keeps the earliest page's position authoritative.
  const seenCss = new Set<string>();
  const seenJs = new Set<string>();
  const seenInline = new Set<string>();
  const pageHtmls: Array<{ html: string; relPath: string }> = [];
  for (const page of pages) {
    const html =
      page.html ||
      (existsSync(join(dir, page.relPath)) ? readFileSync(join(dir, page.relPath), 'utf8') : '');
    pageHtmls.push({ html, relPath: page.relPath });
    for (const m of html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)) {
      const hrefMatch = m[0].match(/href=["']([^"']+)|href=([^\s>]+)/i);
      const href = hrefMatch?.[1] ?? hrefMatch?.[2];
      if (!href || /^https?:\/\//i.test(href)) continue; // skip absolute CDN URLs — captured sites have local copies
      const rel = href.replace(/^\//, '');
      if (seenCss.has(rel)) continue;
      seenCss.add(rel);
      const absPath = join(dir, rel);
      if (existsSync(absPath)) {
        cssFiles.push(rel);
        cssParts.push({ css: readFileSync(absPath, 'utf8'), baseDir: posix.dirname(rel) });
      }
    }
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)|<script[^>]+src=([^\s>]+)/gi)) {
      const src = m[1] ?? m[2];
      if (!src || /^https?:\/\//i.test(src)) continue;
      const rel = src.replace(/^\//, '');
      if (seenJs.has(rel)) continue;
      seenJs.add(rel);
      const absPath = join(dir, rel);
      if (existsSync(absPath)) {
        jsFiles.push(rel);
        jsParts.push(readFileSync(absPath, 'utf8'));
      }
    }
  }

  // Pass 2: top-level unlinked .css/.js fallback (alphabetical, skip already
  // linked) — catches assets the capture saved but no surviving page references.
  // GATED per type on pass 1 finding NOTHING: when linked assets exist, an
  // unlinked top-level file is working clutter (maison-clouet: a stale
  // style.css revision appended AFTER the real assets/site.css won the cascade
  // and repainted the replica with rules the source never loads). Skipped
  // files are reported so the handler can surface them.
  const skippedUnlinked: string[] = [];
  // Snapshot the LINKED counts before the loop — the gate must not trip on
  // fallback files added by this very loop (multiple unlinked files in the
  // no-linked case all collect, as before).
  const linkedCssCount = cssFiles.length;
  const linkedJsCount = jsFiles.length;
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith('.css') && !seenCss.has(name)) {
      if (linkedCssCount > 0) {
        skippedUnlinked.push(name);
        continue;
      }
      seenCss.add(name);
      cssFiles.push(name);
      cssParts.push({ css: readFileSync(join(dir, name), 'utf8'), baseDir: '.' });
    } else if (name.endsWith('.js') && !seenJs.has(name)) {
      if (linkedJsCount > 0) {
        skippedUnlinked.push(name);
        continue;
      }
      seenJs.add(name);
      jsFiles.push(name);
      jsParts.push(readFileSync(join(dir, name), 'utf8'));
    }
  }

  // Inline <style> blocks from each page (first occurrence set, dedup by content).
  // NOTE: a page-scoped inline style becomes GLOBAL in the carried bundle —
  // acceptable while captured sites' inline rules are page-prefixed or
  // idempotent; revisit if a page-specific rule leaks across pages.
  for (const { html, relPath } of pageHtmls) {
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      const body = m[1].trim();
      if (body && !seenInline.has(body)) {
        seenInline.add(body);
        cssParts.push({ css: body, baseDir: posix.dirname(relPath) });
      }
    }
  }

  // Inline <script> blocks (no src) — JS-rendered sites put their MOUNT calls
  // here (`mountGrid('#grid', …)` at body end), and dropping them leaves the
  // carried linked libraries with nothing to invoke them (maison-clouet
  // dogfood: grids stayed empty). Page-scoped like inline styles, so each
  // chunk is isolated in a try/catch IIFE: a mount call whose target only
  // exists on ONE page must not throw and kill the rest of the bundle on the
  // others. Appended AFTER linked js (document order within a page — mounts
  // follow the libraries they call).
  const seenInlineJs = new Set<string>();
  for (const { html } of pageHtmls) {
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      // Skip non-JS <script> data blocks (JSON-LD, importmaps, templates): a
      // parse error in one aborts the whole concatenated bundle.
      if (!isExecutableInlineScript(m[1])) continue;
      const body = m[2].trim();
      if (body && !seenInlineJs.has(body)) {
        seenInlineJs.add(body);
        jsParts.push(`(function () { try {\n${body}\n} catch (e) { /* page-scoped inline chunk */ } })();`);
      }
    }
  }

  // Localize relative image url()s (copy list returned for the handler to carry
  // into the theme) BEFORE concat, so each part resolves against its own source
  // dir. Then strip Google-Fonts @imports: WP_COMPAT_CSS contains no @imports so
  // startsWith(WP_COMPAT_CSS) is preserved; Google imports only exist in cssParts.
  const { parts: localizedParts, mediaAssets } = localizeCssImages(cssParts, dir);
  const css = (WP_COMPAT_CSS + localizedParts.join('\n\n')).replace(GOOGLE_IMPORT_RE, '');
  // Carry HTML <img> assets too (content images the CSS pass never sees).
  const { imgAssets, rewritesByPage: imgRewritesByPage } = collectHtmlImages(pageHtmls, dir);
  return {
    css,
    js: jsParts.join('\n\n'),
    cssFiles,
    jsFiles,
    skippedUnlinked,
    mediaAssets,
    imgAssets,
    imgRewritesByPage,
  };
}
