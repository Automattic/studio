//
// liberate_reconstruct_pages_carry
// ================================
// Carry-and-scope parity path handler. For each page it loads cached body HTML
// (or fetches live), collects CSS via collectCss, calls the pure reconstructPageCarry
// emitter, assembles theme files via buildCarryThemeFiles, writes the theme under
// the Studio site, and returns per-page island content so the orchestrator skill
// can build output-carry.wxr.
//
// The pure helper `assembleCarryTheme` is unit-tested; the IO handler is not.
//

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Handler } from '../handler-types.js';
import { ensurePlugin, type ExecFn } from '../../lib/preview/ensure-plugin.js';
import type { SectionSpec } from '../../lib/replicate/section-extract.js';
import { reconstructPageCarry } from '../../lib/replicate/page-reconstruct-carry.js';
import {
  buildCarryThemeFiles,
  type ThemeFile,
  type CarryPage,
  type ChromeVariant,
} from '../../lib/replicate/theme-scaffold-carry.js';
import { chromeSignature, stripActiveNavState } from '@automattic/blocks-engine/theme';
import { assembleResponsiveMobile } from '../../lib/replicate/carry-responsive-assemble.js';
import { fetchMissingCarriedMedia } from '../../lib/replicate/carry-missing-media.js';
import { localizeCarryFonts } from '../../lib/replicate/carry-fonts.js';
import { findExternalAssetRefs } from '../../lib/replicate/carry-cdn-audit.js';
import { collectCss } from '../../lib/replicate/css-collect.js';
import { assessBody, readPngHeight, classifyEmptyBodies, type EmptyBody, type PageStat } from '../../lib/screenshot/dynamic-content.js';
import { loadCarryDesignTokens } from '../../lib/replicate/carry-design-tokens.js';
import * as cheerio from 'cheerio';
import { buildPageLinkMap } from '../../lib/replicate/page-link-map.js';
import { reconcileCarryIslands } from '../../lib/replicate/carry-page-list.js';
import { installRunMediaMap } from '../../lib/replicate/run-media-map.js';
import type { InternalLinkMap } from '../../lib/streaming/internal-link-rewrite.js';
import { deriveInstallThemeSlug } from './install-theme.js';
import { studioWpRoot } from '../../lib/preview/studio-site.js';
import { makeIslandsEditable } from '../../lib/replicate/normalize/make-islands-editable.js';
import { buildEditableHtmlPlugin } from '../../blocks/editable-html-plugin.js';
import { writeReplicaFilesToHost } from '../../lib/preview/replica-install.js';
import { BlockFixerClient } from '../../lib/streaming/block-fixer-client.js';

// ---------------------------------------------------------------------------
// Pure helper types + implementation (unit-tested)
// ---------------------------------------------------------------------------

export interface CarryPageInput {
  slug: string;
  title: string;
  isHome?: boolean;
  /** WP object type — 'post' scopes via is_single() + shared single.html. Default 'page'. */
  postType?: 'page' | 'post';
  bodyHtml: string;
  css: string;
  specs?: SectionSpec[];
  /** Classic/adaptive Wix mobile-DOM carry — emits a dual-viewport island
   *  (desktop content + a 320px iframe of the captured mobile DOM at `docUrl`).
   *  See reconstructPageCarry's `mobile` input. */
  mobile?: { docUrl: string; height: number };
}

export interface AssembleInput {
  themeName: string;
  pages: CarryPageInput[];
  mediaUrlMap: Map<string, string>;
  /** Source-href → local-permalink map; rewrites carried nav + body links. */
  linkMap?: InternalLinkMap;
  /**
   * True when the run produced WooCommerce products. Gates emission of the store
   * templates (single-product / archive-product) + their dedicated `header-store`
   * part, so product/shop pages get the site chrome instead of WooCommerce's bare
   * default templates.
   */
  hasProducts?: boolean;
  /** Captured design tokens to register in theme.json so product-marketing core blocks
   *  resolve their color/font token references (built by loadCarryDesignTokens). */
  themeJsonPalette?: Array<{ slug: string; name: string; color: string }>;
  themeJsonFontFamilies?: Array<{ slug: string; name: string; fontFamily: string }>;
}

export interface WxrPage {
  slug: string;
  title: string;
  isHome?: boolean;
  postType?: 'page' | 'post';
  postContent: string;
}

export interface AssembleOutput {
  themeFiles: ThemeFile[];
  wxrPages: WxrPage[];
  /** Slugs of pages whose reconstruction threw (e.g. carryHtml's injection gate on
   *  un-strippable markup). Skipped so one bad page doesn't crash the whole build. */
  skipped: string[];
  /** Operator-facing guardrail warnings — e.g. a store with no isolable header, so its
   *  product/shop pages will render chrome-less. Surfaced in the handler result. */
  warnings: string[];
}

/**
 * Pure helper: runs reconstructPageCarry for each page, collects header/footer islands
 * from the home page (or first page that yields one), assembles the alt theme files
 * via buildCarryThemeFiles, and returns the full file set + per-page WXR content.
 *
 * No IO — callers (handler + tests) are responsible for reading inputs / writing outputs.
 */
/** Parse the class tokens off the first `<body …>` tag in carried HTML. */
function extractBodyClasses(html: string): string[] {
  const m = /<body[^>]*\bclass\s*=\s*["']([^"']*)["']/i.exec(html);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

/**
 * Extract the first `<header>…</header>` from a (already media/link-rewritten) page
 * island and wrap it as a `parts/header-store.html` body (a core/html block under the
 * carry viewport div, so the scoped chrome CSS — keyed on `:where(body.lib-carry-site)
 * .header` — applies). Used to give the WooCommerce store templates a header, since
 * product/shop pages have no island and the content-page header parts ride inline in
 * each page's island (the splitter leaves the separate parts empty). Returns '' when
 * no `<header>` is present (non-storefront markup) — the caller then skips store chrome.
 */
export function extractStoreHeaderIsland(island: string): string {
  if (!island.trim()) return '';
  const $ = cheerio.load(island);
  // Prefer the FULL header group (announcement bar + header + sub-bars) over the bare
  // <header>: the bare header drops the announcement/sub bars AND the wrapper context its
  // CSS relies on, so the store nav came out mismatched (oversized logo, list bullets,
  // missing recall/eligibility bars) vs content pages (getsnooz, 2026-06-04). Shopify
  // groups these as sibling `.shopify-section-group-header-group` sections.
  let html = '';
  const group = $('.shopify-section-group-header-group');
  if (group.length) {
    html = group.toArray().map((el) => $.html(el)).join('\n');
  } else {
    const hdr = $('header').first();
    if (hdr.length) html = $.html(hdr);
  }
  if (!html.trim()) return '';
  return `<!-- wp:html -->\n<div class="lib-carry-vp-desktop">\n${html}\n</div>\n<!-- /wp:html -->`;
}

export function assembleCarryTheme(input: AssembleInput): AssembleOutput {
  // Reconstruct every page once, preserving input order for the emitted files.
  // A page whose markup trips reconstructPageCarry (e.g. carryHtml's injection gate on
  // un-strippable rawtext) is SKIPPED — one bad page must not crash the whole build.
  const skipped: string[] = [];
  const recos = input.pages.flatMap((p) => {
    try {
      return [{
        p,
        r: reconstructPageCarry({
          slug: p.slug,
          isHome: p.isHome,
          bodyHtml: p.bodyHtml,
          css: p.css,
          specs: p.specs ?? [],
          mediaUrlMap: input.mediaUrlMap,
          linkMap: input.linkMap,
          mobile: p.mobile,
        }),
      }];
    } catch {
      skipped.push(p.slug);
      return [];
    }
  });

  // Dedupe chrome so pages that render the SAME header/footer share one variant
  // + part pair (e.g. a transparent-overlay home header and a solid interior
  // header → two variants total, regardless of page count). Grouping is by
  // canonical signature, not raw bytes (see registerChrome). The home page's
  // chrome is registered FIRST so it becomes variant 0 — the canonical
  // `header`/`footer` parts + index.html chrome.
  // Group by canonical signature (instance ids + active-nav state normalized away)
  // so Wix's per-page header instances collapse to one variant. Each distinct
  // signature reserves a key + its representative (raw) islands and chrome CSS.
  const keyBySig = new Map<string, string>();
  const orderedKeys: string[] = [];
  const repByKey = new Map<string, { headerIsland: string; footerIsland: string; chromeCss: string }>();
  const ensureKey = (r: { headerIsland: string; footerIsland: string; chromeCss: string }): string => {
    const sig = chromeSignature(r.headerIsland, r.footerIsland);
    let key = keyBySig.get(sig);
    if (!key) {
      key = `c${orderedKeys.length}`;
      keyBySig.set(sig, key);
      orderedKeys.push(key);
      repByKey.set(key, { headerIsland: r.headerIsland, footerIsland: r.footerIsland, chromeCss: r.chromeCss });
    }
    return key;
  };
  // Reserve the home page's signature as variant 0 (the canonical `header`/`footer`
  // + index.html chrome) without counting it as a member yet.
  const homeReco = recos.find((x) => x.p.isHome) ?? recos[0];
  if (homeReco) ensureKey(homeReco.r);

  const countByKey = new Map<string, number>();
  const scaffoldPages: CarryPage[] = [];
  const wxrPages: WxrPage[] = [];
  for (const { p, r } of recos) {
    const chromeKey = ensureKey(r);
    countByKey.set(chromeKey, (countByKey.get(chromeKey) ?? 0) + 1);
    scaffoldPages.push({
      slug: p.slug,
      isHome: p.isHome,
      postType: p.postType,
      pageCss: r.mainCss,
      scaffold: r.scaffold,
      // Dual-viewport mobile carry now rides in the TEMPLATE (scaffoldedTemplate wraps
      // post-content + the iframe), so post_content stays editable section blocks.
      mobile: p.mobile,
      chromeKey,
    });
    wxrPages.push({
      slug: p.slug,
      title: p.title,
      isHome: p.isHome,
      postType: p.postType,
      postContent: r.mainIsland,
    });
  }

  // Build the emitted variants. A variant used by ONE page keeps its active-nav
  // highlight (e.g. the home header underlining "HOME"); a SHARED variant strips
  // it, since one representative can't carry every member's "current" item.
  const variants: ChromeVariant[] = orderedKeys.map((key) => {
    const rep = repByKey.get(key)!;
    const shared = (countByKey.get(key) ?? 0) > 1;
    return {
      key,
      headerIsland: shared ? stripActiveNavState(rep.headerIsland) : rep.headerIsland,
      footerIsland: shared ? stripActiveNavState(rep.footerIsland) : rep.footerIsland,
    };
  });

  // site.css holds EVERY distinct variant's chrome CSS (variant order). Safe to
  // concatenate: each variant's rules key off the source's per-header comp-ids, so
  // a variant's rules match nothing on a page rendering a different variant.
  const siteCss = variants
    .map((v) => repByKey.get(v.key)?.chromeCss ?? '')
    .filter(Boolean)
    .join('\n');

  // Replicate the source <body> classes (e.g. Wix's `responsive`) onto the WP body
  // so body-state-gated carried rules — the whole mobile-reflow layout — behave like
  // the source. Taken from the home page's carried HTML.
  const bodyClasses = extractBodyClasses(homeReco?.p.bodyHtml ?? '');

  // Store header for the WooCommerce templates. Product / shop / category-archive
  // pages have no carried island, so isolate a header from a representative INTERIOR
  // page (its solid header — the home page's is often a transparent overlay that
  // vanishes on a white store page), falling back to any page that yields one. Only
  // when the run has products; otherwise no store templates are emitted.
  let storeHeaderIsland = '';
  if (input.hasProducts) {
    // Smartest-match: carve from the header the MOST pages share (the site's "default" nav)
    // rather than whichever page happens to come first — on a site with sectional navs the
    // dominant one wins. Frequency is ranked by a HEADER-ONLY canonical signature: the variant
    // map keys on header+footer combined, which would undercount a header shared across pages
    // whose footers differ. Pages with no split-out header rank 0 (their inline-header fallback
    // is weaker signal than a real region). Interior pages still outrank the home page, and the
    // sort is stable, so original page order breaks remaining ties.
    const headerSigOf = new Map<(typeof recos)[number], string>();
    for (const x of recos) {
      if (x.r.headerIsland) headerSigOf.set(x, chromeSignature(x.r.headerIsland, ''));
    }
    const headerFreq = new Map<string, number>();
    for (const sig of headerSigOf.values()) headerFreq.set(sig, (headerFreq.get(sig) ?? 0) + 1);
    const freq = (x: (typeof recos)[number]): number => {
      const sig = headerSigOf.get(x);
      return sig ? headerFreq.get(sig) ?? 0 : 0;
    };
    const ordered = [...recos].sort((a, b) => {
      const homeRank = Number(a.p.isHome ?? false) - Number(b.p.isHome ?? false);
      if (homeRank !== 0) return homeRank;
      return freq(b) - freq(a);
    });
    for (const cand of ordered) {
      // The header may be a split-out region (headerIsland — now incl. the full Shopify header
      // group), or ride inline in the main island. Prefer the region, then fall back to the body.
      storeHeaderIsland =
        extractStoreHeaderIsland(cand.r.headerIsland) || extractStoreHeaderIsland(cand.r.mainIsland);
      if (storeHeaderIsland) break;
    }
  }

  const themeFiles = buildCarryThemeFiles({
    themeName: input.themeName,
    chromeVariants: variants,
    siteCss,
    bodyClasses,
    pages: scaffoldPages,
    storeHeaderIsland,
    hasProducts: input.hasProducts,
    themeJsonPalette: input.themeJsonPalette,
    themeJsonFontFamilies: input.themeJsonFontFamilies,
  });

  // Guardrail: a store run that couldn't isolate a header → no store templates →
  // product/shop pages render with WooCommerce's bare defaults (the failure mode
  // that shipped silently on getsnooz, 2026-06-04). Surface it instead of letting
  // the operator discover it by eye.
  const warnings: string[] = [];
  if (input.hasProducts && !storeHeaderIsland) {
    warnings.push(
      'Store pages (single-product / archive-product) will render WITHOUT site chrome: no <header> could be isolated from any carried page island, so WooCommerce defaults are used. Capture an interior page with a header, or add a header part manually.',
    );
  }

  return { themeFiles, wxrPages, skipped, warnings };
}

// ---------------------------------------------------------------------------
// IO handler (not unit-tested — verified by typecheck + smoke import)
// ---------------------------------------------------------------------------

interface PageArg {
  slug: string;
  sourceUrl: string;
  title: string;
  isHome?: boolean;
  /** WP object type the slug resolves to. Default 'page'. Posts scope via is_single(). */
  postType?: 'page' | 'post';
  /**
   * Override the cached-HTML filename stem (`html/<htmlSlug>.html`) when it
   * differs from `slug` — e.g. posts captured as `post--<name>.html` but whose
   * WP post_name (and thus is_single() slug) is the bare `<name>`. Defaults to slug.
   */
  htmlSlug?: string;
}

export const reconstructPagesCarryHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string | undefined;
  const studioSitePath = args.studioSitePath as string | undefined;
  const pages = args.pages as PageArg[] | undefined;
  // Default: emit carried bodies as the in-canvas `dla/editable-html` block instead of a
  // sandboxed `core/html` island, so the styled markup is visible (and editable) in the
  // block editor. Front-end output is byte-identical (static save). Opt OUT with
  // editableIslands:false to force plain core/html.
  const editableIslands = args.editableIslands !== false;

  if (!outputDir) {
    return ctx.errorResult('liberate_reconstruct_pages_carry requires `outputDir`.');
  }
  if (!studioSitePath) {
    return ctx.errorResult('liberate_reconstruct_pages_carry requires `studioSitePath`.');
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    return ctx.errorResult(
      'liberate_reconstruct_pages_carry requires a non-empty `pages` array ({slug, sourceUrl, title, isHome?}).',
    );
  }

  const wpRoot = studioWpRoot(studioSitePath);
  if (!wpRoot) {
    return ctx.errorResult(`studioSitePath has no wp-content: ${studioSitePath}`);
  }

  // Derive carry theme slug from outputDir (parallel to block path, but suffixed -carry).
  const themeName = (args.themeName as string | undefined) ?? 'Liberated (Carry)';
  const baseSlug = deriveInstallThemeSlug(outputDir);
  // Strip the trailing "-replica" suffix the block path uses and append "-carry" so
  // the two themes can coexist in wp-content/themes/ simultaneously.
  const carrySlug = baseSlug.replace(/-replica$/, '') + '-carry';
  const themeRoot = join(wpRoot, 'wp-content', 'themes', carrySlug);

  // Collect HTML + CSS for each page.
  const carryPages: CarryPageInput[] = [];
  const fetchErrors: Array<{ slug: string; error: string }> = [];
  // Phase 0 guardrail: pages whose captured body renders effectively empty (a JS app that
  // never rendered — reviews/FAQ widgets, cross-origin iframes). The reliable signal is
  // RENDERED HEIGHT (a chrome-only page is dramatically shorter than the page-set median),
  // not DOM text (the app's DOM is present-but-blank, plus ~300 chars of cart boilerplate).
  // Collected per page here, decided after the loop once the median is known.
  const emptyBodies: EmptyBody[] = [];
  const pageStats: PageStat[] = [];
  const siteOrigin = (() => {
    try { return new URL(pages[0].sourceUrl).origin; } catch { return undefined; }
  })();

  // Responsive-image map ({wix-media-id → mobile-variant URL}) captured at the
  // mobile viewport by liberate_screenshot. Used to wrap carried <img>s in a
  // <picture> so the browser serves the mobile crop at narrow widths (no JS).
  let responsiveImages: Record<string, string> = {};
  try {
    const riPath = join(resolve(outputDir), 'responsive-images.json');
    if (existsSync(riPath)) responsiveImages = JSON.parse(readFileSync(riPath, 'utf8'));
  } catch {
    /* best-effort — reconstruct without mobile variants on a missing/corrupt map */
  }

  // Mobile-DOM carry (classic/adaptive Wix). liberate_screenshot's mobile pass
  // writes html-mobile/<slug>.html (the JS-built 320px mobile DOM, scripts stripped)
  // + heights.json. When present, each page emits a dual island whose mobile half is
  // an iframe of that document, served from the site's uploads/_carry-mobile/.
  let mobileHeights: Record<string, number> = {};
  try {
    const hPath = join(resolve(outputDir), 'html-mobile', 'heights.json');
    if (existsSync(hPath)) mobileHeights = JSON.parse(readFileSync(hPath, 'utf8'));
  } catch {
    /* best-effort — no mobile-DOM carry on a missing/corrupt heights map */
  }
  const carryMobileDir = join(wpRoot, 'wp-content', 'uploads', '_carry-mobile');

  for (const p of pages) {
    // Prefer cached rendered HTML written by liberate_screenshot. The filename
    // stem is htmlSlug when given (posts: `post--<name>.html`), else the slug.
    const htmlPath = join(resolve(outputDir), 'html', `${p.htmlSlug ?? p.slug}.html`);
    let bodyHtml = '';
    if (existsSync(htmlPath)) {
      try {
        bodyHtml = readFileSync(htmlPath, 'utf8');
      } catch {
        /* fall through to live fetch */
      }
    }
    if (!bodyHtml) {
      try {
        const res = await fetch(p.sourceUrl);
        bodyHtml = await res.text();
      } catch (err) {
        fetchErrors.push({
          slug: p.slug,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    // Phase 0: record the rendered height + body classification; the empty decision is
    // made after the loop (needs the page-set median).
    const pngPath = join(resolve(outputDir), 'screenshots', 'desktop', `${p.htmlSlug ?? p.slug}.png`);
    pageStats.push({ slug: p.slug, height: readPngHeight(pngPath), assess: assessBody(bodyHtml, siteOrigin) });

    // Collect external stylesheets referenced in the HTML.
    let css = '';
    try {
      css = await collectCss({
        html: bodyHtml,
        inlineStyleText: '',
        baseUrl: p.sourceUrl,
        onError: () => {
          /* swallow individual sheet errors — best-effort */
        },
      });
    } catch {
      /* non-fatal: reconstruct with whatever CSS was collected */
    }

    // Cache the collected CSS alongside the HTML for debugging / re-runs.
    try {
      const cssCacheDir = join(resolve(outputDir), 'css');
      mkdirSync(cssCacheDir, { recursive: true });
      writeFileSync(join(cssCacheDir, `${p.slug}.css`), css);
    } catch {
      /* best-effort cache write */
    }

    // Mobile-DOM carry: if a mobile capture exists for this page, install it under
    // uploads/_carry-mobile/<slug>.html and emit a dual island referencing it.
    let mobile: { docUrl: string; height: number } | undefined;
    const mobileSrc = join(resolve(outputDir), 'html-mobile', `${p.htmlSlug ?? p.slug}.html`);
    if (existsSync(mobileSrc)) {
      try {
        mkdirSync(carryMobileDir, { recursive: true });
        const mobileDoc = readFileSync(mobileSrc, 'utf8');
        writeFileSync(join(carryMobileDir, `${p.slug}.html`), mobileDoc);
        mobile = {
          docUrl: `/wp-content/uploads/_carry-mobile/${p.slug}.html`,
          height: mobileHeights[p.htmlSlug ?? p.slug] ?? 6000,
        };
      } catch {
        /* best-effort — fall back to desktop-only for this page */
      }
    }

    carryPages.push({
      slug: p.slug,
      title: p.title,
      isHome: p.isHome,
      postType: p.postType,
      bodyHtml,
      css,
      mobile,
    });
  }

  if (carryPages.length === 0) {
    return ctx.errorResult(
      `liberate_reconstruct_pages_carry: no pages could be loaded. fetchErrors: ${JSON.stringify(fetchErrors)}`,
    );
  }

  // Phase 0 decision (pure, tested in dynamic-content.test.ts): a page whose rendered
  // desktop capture is dramatically shorter than the page-set median AND isn't text-rich
  // is chrome-only — the JS app never rendered, so it carries blank. Falls back to the
  // text signal for any page without a usable screenshot height.
  emptyBodies.push(...classifyEmptyBodies(pageStats));

  // Internal-link rewrite map — same builder the block path uses (shared module),
  // so carried nav + body hrefs resolve to the imported permalinks, not the source.
  const linkMap = buildPageLinkMap(outputDir, pages.map((p) => p.sourceUrl));

  // Pre-pass: download any image the carried HTML references but extraction never
  // captured (no local copy exists, so repoint can't self-host it). Runs BEFORE install
  // so the fetched assets enter the media map and the rewrite repoints them like the rest.
  // Best-effort: a failed fetch (e.g. CDN 403) is recorded and left as a CDN ref.
  const missingMedia = await fetchMissingCarriedMedia(
    outputDir,
    carryPages.map((p) => p.bodyHtml),
  );

  // Install the run's media into the alt site + build the CDN→local URL map via
  // the SAME installMediaForUrl the block path uses (installRunMediaMap). Carried
  // <img>/url() references then point at this site's media library, not the CDN.
  // Best-effort: media-install failure leaves the map empty (carried URLs survive).
  let mediaUrlMap = new Map<string, string>();
  const mediaErrors: Array<{ sourceUrl: string; error: string }> = [];
  try {
    const media = await installRunMediaMap({
      outputDir,
      url: pages[0].sourceUrl,
      wpRoot,
    });
    mediaUrlMap = media.mediaUrlMap;
    mediaErrors.push(...media.result.errors);
  } catch (err) {
    mediaErrors.push({ sourceUrl: '*', error: err instanceof Error ? err.message : String(err) });
  }

  // Store templates (single-product / archive-product) only make sense when the run
  // produced WooCommerce products.
  const hasProducts =
    existsSync(join(resolve(outputDir), 'products.csv')) ||
    existsSync(join(resolve(outputDir), 'products.jsonl'));

  // WooCommerce auto-install: store templates only render correctly when WooCommerce
  // is installed and active. Mirror the Jetpack pattern exactly — warning-not-fatal,
  // wooEnsured tally. Called once when products are present; skipped otherwise.
  const execFileAsync = promisify(execFile);
  let wooEnsured = false;
  let wooWarning: string | undefined;
  if (hasProducts) {
    const wpExec: ExecFn = (sitePath, wpArgs) =>
      execFileAsync('studio', ['wp', '--path', sitePath, ...wpArgs], {
        timeout: 300_000,
        maxBuffer: 16 * 1024 * 1024,
      }).then((o) => o.stdout);
    const ensured = await ensurePlugin(studioSitePath, 'woocommerce', wpExec);
    if (ensured.ok) {
      wooEnsured = true;
    } else {
      wooWarning = `WooCommerce auto-install failed (store templates will not render until WooCommerce is installed): ${ensured.error}`;
      console.error(`[reconstruct-carry] ${wooWarning}`);
    }
  }

  // Register the captured palette/fonts in theme.json so the product-marketing core
  // blocks (emitted later by enrich-product-marketing) resolve their token references.
  const designTokens = loadCarryDesignTokens(outputDir);
  const { themeFiles, wxrPages, skipped, warnings } = assembleCarryTheme({
    themeName,
    pages: carryPages,
    mediaUrlMap,
    linkMap,
    hasProducts,
    themeJsonPalette: designTokens.themeJsonPalette,
    themeJsonFontFamilies: designTokens.themeJsonFontFamilies,
  });

  // Self-host fonts: the scoped CSS carries the source @font-face rules with Wix-CDN
  // src URLs. Download each into the theme's assets/fonts/ and rewrite the CSS url() to
  // a local ../fonts/ path (sheets are enqueued from assets/css/). Best-effort.
  const fontLocalize = await localizeCarryFonts(themeRoot, themeFiles, { wpRoot });

  // Write theme files to disk under wp-content/themes/<carrySlug>.
  for (const f of fontLocalize.files) {
    const full = join(themeRoot, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
  }

  // Final per-page island content. Wrap carried <img>s with a captured mobile variant in
  // <picture> + a `(max-width:750px)` <source>, and append a single-column mobile grid next
  // to any Wix pro-gallery — THEN self-host. Both inject steps reference the captured
  // mobile-crop URLs (responsive-images.json), which are CDN-only (never downloaded), so the
  // assembly repoints them to the installed DESKTOP local copy of the same media-id via the
  // run media map. Mobile shows the desktop crop, but every image is self-hosted (zero
  // source-CDN dependency) — see carry-responsive-assemble.ts.
  let finalPages = wxrPages.map((w) => ({
    slug: w.slug,
    title: w.title,
    isHome: w.isHome,
    postType: w.postType,
    postContent: assembleResponsiveMobile(w.postContent, responsiveImages, mediaUrlMap),
  }));

  // Editor visibility (opt-in). A carried body emits as one `core/html` island, which
  // the block editor renders inside an isolated SandBox <iframe> — so it shows unstyled
  // (the theme's editor stylesheets can't reach the sandbox) and only behind the
  // HTML/Preview toggle. Converting each island to `dla/editable-html` re-emits the SAME
  // source-faithful markup (static save = serializeFrame(frame), byte-identical on the
  // front end) as a block that renders directly in the editor CANVAS, where the descoped
  // editor CSS (add_editor_style / block_editor_settings_all, keyed on `:where(body)` +
  // id/attr selectors) applies — so the styled HTML is visible and text/image-editable.
  // Ships + activates the block plugin once when any island converts.
  let islandsConverted = 0;
  let editableHtmlPluginSlug: string | undefined;
  if (editableIslands) {
    // Canonicalize each converted page through @wordpress/blocks (real save() funcs)
    // so the dla/editable-html markup matches its save output byte-for-byte and validates
    // cleanly in the editor (no "unexpected/invalid content" recovery). Best-effort: if the
    // sidecar can't start, fix() passes the markup through unchanged.
    const blockFixer = new BlockFixerClient();
    await blockFixer.start().catch(() => {
      /* best-effort — fix() passes through if the server didn't start */
    });
    try {
      const fixedPages: typeof finalPages = [];
      for (const p of finalPages) {
        const r = makeIslandsEditable(p.postContent);
        islandsConverted += r.converted;
        const fixed = (await blockFixer.fix([r.content]))[0];
        fixedPages.push({ ...p, postContent: fixed?.html ?? r.content });
      }
      finalPages = fixedPages;
    } finally {
      await blockFixer.stop().catch(() => {
        /* best-effort cleanup */
      });
    }
    if (islandsConverted > 0) {
      const plugin = buildEditableHtmlPlugin();
      writeReplicaFilesToHost({ wpRoot, blockPlugins: [plugin] });
      editableHtmlPluginSlug = plugin.slug;
      try {
        await execFileAsync('studio', ['wp', '--path', studioSitePath, 'plugin', 'activate', plugin.slug], {
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (e) {
        console.error(`[reconstruct-carry] editable-html plugin activate failed: ${(e as Error).message}`);
      }
    }
  }

  // Self-hosting assertion: after all media/font/link localization, scan the assembled
  // islands + theme CSS/parts for any asset ref still pointing at an external host. A
  // fully self-hosted replica should report 0; anything here is a leak to surface in the
  // run-report (it does NOT flip the verdict — editorial external LINKS are excluded by
  // construction; this is asset positions only).
  const cdnAudit = findExternalAssetRefs([
    ...finalPages.map((p) => p.postContent),
    ...fontLocalize.files
      .filter((f) => f.path.endsWith('.css') || f.path.endsWith('.html'))
      .map((f) => f.content),
  ]);

  // The islands are whole carried page bodies — returning them all inline blows past
  // the MCP response cap on real sites (getsnooz: 1 page ≈ 330KB). When `islandsOutDir`
  // is given, write each island to disk and return PATHS instead, so this tool is
  // callable straight from MCP, not only via the tsx driver. Without it, keep returning
  // `postContent` inline (back-compat — the driver consumes that).
  const islandsOutDir = args.islandsOutDir as string | undefined;
  let pagesResult: Array<Record<string, unknown>>;
  if (islandsOutDir) {
    const dir = resolve(islandsOutDir);
    mkdirSync(dir, { recursive: true });
    // Drop islands from a prior wider-scope run before writing the current set — see
    // reconcileCarryIslands (stale files silently re-enter output-carry.wxr otherwise).
    reconcileCarryIslands(dir, finalPages.map((p) => p.slug));
    pagesResult = finalPages.map((p) => {
      const islandPath = join(dir, `${p.slug}.html`);
      writeFileSync(islandPath, p.postContent);
      return { slug: p.slug, title: p.title, isHome: p.isHome, postType: p.postType, islandPath, bytes: p.postContent.length };
    });
  } else {
    pagesResult = finalPages;
  }

  // Merge the Phase-0 empty-body guardrail into the operator-facing warnings.
  const allWarnings = [...warnings];
  if (emptyBodies.length) {
    allWarnings.push(
      `${emptyBodies.length} page(s) captured with an empty body (JS-app content that didn't render → carried blank). Re-capture with the dynamic-content waits, or use a WP-native equivalent: ` +
        emptyBodies.map((e) => `${e.slug} [${e.reason}${e.detail ? ': ' + e.detail : ''}]`).join(', '),
    );
  }

  return ctx.textResult({
    ok: fetchErrors.length === 0,
    themeRoot,
    themeSlug: carrySlug,
    themeFilesWritten: themeFiles.length,
    fetchErrors,
    skipped,
    warnings: allWarnings,
    ...(wooWarning ? { wooWarning } : {}),
    wooEnsured,
    emptyBodies,
    mediaInstalled: mediaUrlMap.size,
    mediaErrors,
    missingMediaDownloaded: missingMedia.downloaded,
    missingMediaFailed: missingMedia.failed,
    fontsLocalized: fontLocalize.downloaded,
    fontsFailed: fontLocalize.failed,
    residualCdnAssets: cdnAudit.refs.length,
    residualCdnByHost: cdnAudit.byHost,
    residualCdnSamples: cdnAudit.samples,
    islandsConverted,
    editableHtmlPluginSlug,
    islandsDir: islandsOutDir ? resolve(islandsOutDir) : undefined,
    pages: pagesResult,
  });
};
