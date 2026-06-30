/**
 * src/lib/screenshot/nav-extract.ts
 * ===================================
 * Modular, source-agnostic nav extraction from a live JS-rendered header element.
 *
 * `extractNav` is designed to run INSIDE the browser via `page.evaluate`.
 * It returns a structured `ExtractedNav` from the first argument (a detected
 * `header` / `[role="banner"]` element) — completely decoupled from any
 * particular platform (Wix today; any tomorrow).
 *
 * Heuristics used (documented so they can be tuned per-platform if needed):
 *
 * Logo detection
 * ──────────────
 * 1. First `<img>` whose alt, src, or parent class/id contains "logo" (case-
 *    insensitive). Falls back to the first `<img>` in the header.
 * 2. logoSrc is the RAW attribute value (not resolved via `currentSrc`) so it
 *    threads through the same media rewrite pipeline as other images.
 * 3. siteTitle falls back to the visible `<a>` text near the root of the header
 *    when no img is found.
 *
 * Nav links
 * ─────────
 * 1. All `<a>` elements inside the first `<nav>` (or, if no `<nav>`, all `<a>`
 *    elements in the header). Only links with non-empty trimmed text AND a non-
 *    trivial href (not null, not pure "#", not "javascript:") are kept.
 * 2. Deduped by label+href. Capped at MAX_NAV_ITEMS=8 to match typical nav sizes.
 * 3. Pure in-page anchor links (href === "#") are skipped.
 *
 * CTA detection
 * ─────────────
 * A link qualifies as CTA when ANY of:
 *   - computed background-color is not transparent / rgba(0,0,0,0)
 *   - computed border-radius > 0
 *   - class or id contains "button", "btn", "cta" (case-insensitive)
 * The LAST qualifying link in document order wins (CTAs tend to appear at the
 * end of the nav). If the CTA is the only nav item it is not extracted as CTA
 * (we keep it in items instead).
 *
 * Style
 * ─────
 * - background: Effective header background. Scans the header element itself
 *   then all descendants that span ≥60% width / ≥50% height of the header box
 *   (catches Wix bgLayers/colorUnderlay). First opaque background-color wins.
 *   If an element has background-image instead (gradient/image), the image value
 *   is emitted as `backgroundImage` with `background` set to 'transparent'.
 *   Falls back to walking ancestors (depth ≤ 5) when no painted descendant found.
 * - backgroundImage: Populated when the effective background is a CSS gradient
 *   or image (background-image, not a solid color). Consumers should apply this
 *   as a CSS background-image on the header container.
 * - textColor: getComputedStyle.color of the deepest text-leaf element inside
 *   the representative nav link (the painted label <div>, not the outer <a>).
 *   Falls back to the <a> then the header element.
 * - fontFamily: same label element; trimmed to the first family name.
 * - ctaBackground / ctaTextColor: from the CTA element when present.
 * - height: header.getBoundingClientRect().height.
 *
 * The returned logoSrc must flow through the existing media pipeline.
 * Nav item hrefs are kept as-is (a TODO to map them to local page slugs later).
 */

export interface ExtractedNav {
  /** First img in header with logo-like hints; raw attribute src (not resolved). */
  logoSrc: string | null;
  logoAlt: string | null;
  /** Text fallback when no logo img found. */
  siteTitle: string | null;
  /** Top-level nav links; deduped, capped at 8, no pure anchors. */
  items: { label: string; href: string }[];
  /**
   * A button-styled link (bg / border-radius / class hint), or null.
   * Includes bg, text color, and border-radius when available.
   */
  cta: { label: string; href: string; bg?: string; color?: string; borderRadius?: string } | null;
  style: {
    /** Header background-color (rgba string). May be 'transparent' or 'rgba(0,0,0,0)' when indeterminate. */
    background: string;
    /**
     * Header background-image value when the effective background is an image/gradient
     * rather than a solid color (e.g. Wix bgLayers with a gradient or image overlay).
     * When set, takes precedence over `background` for visual rendering.
     */
    backgroundImage?: string;
    /**
     * True when the source header overlays content (computed position is fixed,
     * absolute, or sticky). False for a normal-flow (static/relative) header.
     * Drives the overlay-vs-solid branch in buildBlockHeader.
     */
    isOverlay: boolean;
    /** Color of a representative nav link. */
    textColor: string;
    /** CTA background-color, or null. */
    ctaBackground: string | null;
    /** CTA text color, or null. */
    ctaTextColor: string | null;
    /** First font-family in the computed stack for nav links. */
    fontFamily: string;
    /** Computed font-size of a representative nav link (e.g. "13px"). */
    fontSize?: string;
    /** Computed font-weight of a representative nav link (e.g. "400"). */
    fontWeight?: string;
    /** Computed letter-spacing of a representative nav link (e.g. "2.6px"). */
    letterSpacing?: string;
    /** Computed text-transform of a representative nav link (e.g. "uppercase"). */
    textTransform?: string;
    /** Header element height in px. */
    height: number;
  };
}

const MAX_NAV_ITEMS = 8;

/**
 * Extract structured nav data from a header element.
 *
 * Designed to run inside the browser (page.evaluate).
 * Source-agnostic — works on Wix, Shopify, Webflow, etc.
 *
 * @param headerEl - The detected site header element.
 */
export function extractNav(headerEl: Element): ExtractedNav {
  // ── Logo ──────────────────────────────────────────────────────────────────
  const allImgs = Array.from(headerEl.querySelectorAll('img'));
  const isLogoLike = (img: HTMLImageElement): boolean => {
    const hint = [img.alt, img.src, img.className, img.id,
      img.parentElement?.className ?? '', img.parentElement?.id ?? '']
      .join(' ')
      .toLowerCase();
    return /logo/.test(hint);
  };
  const logoImg = (allImgs.find((img) => isLogoLike(img as HTMLImageElement)) ?? allImgs[0] ?? null) as HTMLImageElement | null;
  const logoSrc = logoImg ? (logoImg.getAttribute('src') ?? null) : null;
  const logoAlt = logoImg ? (logoImg.getAttribute('alt') ?? null) : null;

  // ── Nav scope ─────────────────────────────────────────────────────────────
  // Primary links come from the <nav> (or [role="navigation"]) scope.
  // CTA detection also scans the full header so button-styled links outside
  // the <nav> (a common pattern: logo | nav | CTA) are captured.
  const navEl = headerEl.querySelector('nav, [role="navigation"]') ?? headerEl;

  // All valid link candidates (non-empty text, meaningful href) from the header.
  const isValidAnchor = (a: Element): boolean => {
    const href = (a as HTMLAnchorElement).getAttribute('href');
    if (!href || href === '#' || href.startsWith('javascript:')) return false;
    const label = a.textContent?.trim() ?? '';
    return !!label;
  };

  // Nav-scope anchors: primary source for nav items.
  const navAnchorEls = Array.from(navEl.querySelectorAll('a')).filter(isValidAnchor) as HTMLAnchorElement[];

  // All header anchors: used for CTA scanning (includes elements outside <nav>).
  const allHeaderAnchorEls = Array.from(headerEl.querySelectorAll('a')).filter(isValidAnchor) as HTMLAnchorElement[];

  // ── CTA detection ─────────────────────────────────────────────────────────
  // Scan ALL header <a>/<button>/[role=button] elements.
  // A candidate must:
  //   1. Have short trimmed text (≤ 18 chars, 1–3 words).
  //   2. NOT be one of the nav menu labels already collected.
  //   3. Look button-like: non-transparent bg OR borderRadius > 0 OR
  //      class/role hint (button|btn|cta).
  // Best candidate = last qualifying element in document order (CTAs tend to
  // appear at the end of the header — "CALL US", "Get Started", etc.).
  // Null is fine when nothing qualifies (don't crash).

  // Collect ALL interactive elements in the header (a, button, [role=button]).
  const allInteractive = Array.from(
    headerEl.querySelectorAll('a, button, [role="button"]')
  ).filter((el) => {
    // Must have visible non-empty text.
    const label = el.textContent?.trim() ?? '';
    if (!label) return false;
    // For <a> elements, must have a meaningful href (not just an anchor or JS void).
    if (el.tagName === 'A') {
      const href = (el as HTMLAnchorElement).getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript:')) return false;
    }
    return true;
  }) as Array<HTMLAnchorElement | HTMLButtonElement>;

  // Build set of nav item labels for exclusion check (filled after nav items
  // are collected below — we defer CTA selection to after items are built).
  // For now collect the raw nav anchor labels.
  const navItemLabels = new Set(
    navAnchorEls.map((a) => (a.textContent?.trim() ?? '').toLowerCase())
  );

  const isCtaLike = (el: HTMLAnchorElement | HTMLButtonElement): boolean => {
    const label = (el.textContent?.trim() ?? '');
    // Must be short: ≤ 18 chars AND 1–3 words.
    if (label.length > 18) return false;
    const wordCount = label.split(/\s+/).filter(Boolean).length;
    if (wordCount < 1 || wordCount > 3) return false;
    // Must NOT already be a nav menu item.
    if (navItemLabels.has(label.toLowerCase())) return false;
    // Must look button-like.
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const isOpaque = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    const hasBorderRadius = parseFloat(cs.borderRadius) > 0;
    const classHint = /button|btn|cta/i.test(
      el.className + ' ' + (el.id ?? '') + ' ' +
      (el.parentElement?.className ?? '') + ' ' +
      (el.getAttribute('role') ?? '')
    );
    return !!(isOpaque || hasBorderRadius || classHint);
  };

  let ctaEl: HTMLAnchorElement | HTMLButtonElement | null = null;
  for (const el of allInteractive) {
    if (isCtaLike(el)) ctaEl = el;
  }

  // ── Nav items ─────────────────────────────────────────────────────────────
  // Use nav-scope anchors as the primary source; skip the detected CTA.
  const seen = new Set<string>();
  const items: { label: string; href: string }[] = [];
  for (const a of navAnchorEls) {
    if (a === ctaEl) continue; // skip CTA from items
    const label = (a.textContent ?? '').trim();
    const href = a.getAttribute('href') ?? '';
    const key = `${label}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ label, href });
    if (items.length >= MAX_NAV_ITEMS) break;
  }

  // If no nav-scope items but there are header-level links, fall back to those.
  if (items.length === 0) {
    for (const a of allHeaderAnchorEls) {
      if (a === ctaEl) continue;
      const label = (a.textContent ?? '').trim();
      const href = a.getAttribute('href') ?? '';
      const key = `${label}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ label, href });
      if (items.length >= MAX_NAV_ITEMS) break;
    }
  }

  // If all anchors were CTA and no items remain, put CTA back into items.
  if (items.length === 0 && ctaEl) {
    const label = (ctaEl.textContent ?? '').trim();
    const href = (ctaEl as HTMLAnchorElement).getAttribute('href') ?? '';
    items.push({ label, href });
    ctaEl = null; // no items → no CTA split makes sense
  }

  // Build CTA with captured bg/text colors.
  let cta: ExtractedNav['cta'] = null;
  if (ctaEl) {
    const ctaLabel = (ctaEl.textContent ?? '').trim();
    const ctaHref = (ctaEl as HTMLAnchorElement).getAttribute('href') ?? '';
    const ctaCs = getComputedStyle(ctaEl);
    const ctaBgRaw = ctaCs.backgroundColor;
    const ctaBg = (ctaBgRaw && ctaBgRaw !== 'transparent' && ctaBgRaw !== 'rgba(0, 0, 0, 0)')
      ? ctaBgRaw
      : undefined;
    const ctaColor = ctaCs.color || undefined;
    // Capture the computed border-radius so block-header can use the real value.
    // Only include when it differs from a pill/zero — normalize "0px" to absent.
    const ctaBorderRadiusRaw = ctaCs.borderRadius;
    const ctaBorderRadius = (ctaBorderRadiusRaw && ctaBorderRadiusRaw !== '0px')
      ? ctaBorderRadiusRaw
      : undefined;
    cta = {
      label: ctaLabel,
      href: ctaHref,
      ...(ctaBg && { bg: ctaBg }),
      ...(ctaColor && { color: ctaColor }),
      ...(ctaBorderRadius && { borderRadius: ctaBorderRadius }),
    };
  }

  // ── Site title fallback ───────────────────────────────────────────────────
  let siteTitle: string | null = null;
  if (!logoImg) {
    // Look for a prominent text node near the root of the header
    const titleLink = (headerEl.querySelector('a') as HTMLAnchorElement | null);
    if (titleLink) {
      siteTitle = titleLink.textContent?.trim() ?? null;
    }
    if (!siteTitle) {
      // Try heading or strong
      const h = headerEl.querySelector('h1,h2,h3,strong,[class*="title"],[class*="logo"]');
      if (h) siteTitle = h.textContent?.trim() ?? null;
    }
  }

  // ── Style ─────────────────────────────────────────────────────────────────
  // Background: scan the header element AND descendants that span roughly the
  // full header box (width ≥ ~60% of header width AND height ≥ ~50% of header
  // height). This catches Wix's colorUnderlay/bgLayers descendants that carry
  // the dark background-color. Falls back to walking ancestors (original logic).
  const getBackground = (): { background: string; backgroundImage?: string } => {
    const TRANSPARENT = ['transparent', 'rgba(0, 0, 0, 0)'];
    const headerRect = (headerEl as HTMLElement).getBoundingClientRect();
    const minW = headerRect.width * 0.6;
    const minH = headerRect.height * 0.5;

    // Candidates: header itself first, then all descendants in DOM order.
    const candidates: Element[] = [headerEl, ...Array.from(headerEl.querySelectorAll('*'))];

    for (const el of candidates) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      // For the header itself (depth=0) skip size check; for descendants require span.
      const isHeader = el === headerEl;
      const spansHeader = isHeader || (rect.width >= minW && rect.height >= minH);
      if (!spansHeader) continue;

      const cs = getComputedStyle(el as HTMLElement);
      const bg = cs.backgroundColor;
      if (bg && !TRANSPARENT.includes(bg)) return { background: bg };

      const bgImage = cs.backgroundImage;
      if (bgImage && bgImage !== 'none') return { background: 'transparent', backgroundImage: bgImage };
    }

    // Fallback: walk up ancestors (original logic).
    let el: Element | null = headerEl.parentElement;
    for (let depth = 0; depth <= 5 && el; depth++) {
      const bg = getComputedStyle(el as HTMLElement).backgroundColor;
      if (bg && !TRANSPARENT.includes(bg)) return { background: bg };
      el = el.parentElement;
    }
    return { background: getComputedStyle(headerEl as HTMLElement).backgroundColor };
  };

  // Find the deepest element that directly contains a menu item's visible text
  // (no child elements, i.e. a text-only leaf). This is the actual painted label
  // element — e.g. the <div class="label"> inside a Wix <a> — which carries the
  // correct text color and font.
  const findLabelElement = (anchorEl: HTMLAnchorElement): Element => {
    // Walk descendants in DOM order, find leaves (no children) with non-empty text.
    const leaves = Array.from(anchorEl.querySelectorAll('*')).filter((el) =>
      el.children.length === 0 && (el.textContent?.trim() ?? '') !== ''
    );
    // Return the last one (innermost label) if found, else the anchor itself.
    return leaves[leaves.length - 1] ?? anchorEl;
  };

  // Representative link for text/font extraction
  const repAnchor = (navEl.querySelector('a') as HTMLAnchorElement | null) ?? (headerEl.querySelector('a') as HTMLAnchorElement | null);
  // Use the deepest label element inside the anchor for color/font, not the <a> itself.
  const repLabelEl = repAnchor ? findLabelElement(repAnchor) : null;
  const repCs = repLabelEl
    ? getComputedStyle(repLabelEl as HTMLElement)
    : (repAnchor ? getComputedStyle(repAnchor) : getComputedStyle(headerEl as HTMLElement));

  const textColor = repCs.color || '#000000';
  const rawFamily = repCs.fontFamily || '';
  // Trim to first family: e.g. '"Open Sans", sans-serif' → 'Open Sans'
  const fontFamily = rawFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');

  // Additional typography tokens from the representative label element.
  const fontSize = repCs.fontSize || undefined;
  const fontWeight = repCs.fontWeight || undefined;
  const letterSpacing = (repCs.letterSpacing && repCs.letterSpacing !== 'normal' && repCs.letterSpacing !== '0px')
    ? repCs.letterSpacing
    : undefined;
  const textTransform = (repCs.textTransform && repCs.textTransform !== 'none')
    ? repCs.textTransform
    : undefined;

  const { background, backgroundImage } = getBackground();
  const height = (headerEl as HTMLElement).getBoundingClientRect().height;

  // ── isOverlay ─────────────────────────────────────────────────────────────
  // True when the header's computed position is fixed, absolute, or sticky —
  // i.e. it overlays content rather than sitting in normal flow.
  // Wix headers are typically sticky/fixed; plain-flow site headers are static.
  const headerPosition = getComputedStyle(headerEl as HTMLElement).position;
  const isOverlay = headerPosition === 'fixed' || headerPosition === 'absolute' || headerPosition === 'sticky';

  // CTA colors: prefer already-computed cta.bg/cta.color; fall back to direct
  // getComputedStyle on ctaEl for ctaBackground/ctaTextColor style fields.
  const ctaBackground: string | null = cta?.bg ?? null;
  const ctaTextColor: string | null = cta?.color ?? null;

  const styleResult: ExtractedNav['style'] = {
    background,
    isOverlay,
    textColor,
    ctaBackground,
    ctaTextColor,
    fontFamily,
    height,
  };
  if (backgroundImage) styleResult.backgroundImage = backgroundImage;
  if (fontSize) styleResult.fontSize = fontSize;
  if (fontWeight) styleResult.fontWeight = fontWeight;
  if (letterSpacing) styleResult.letterSpacing = letterSpacing;
  if (textTransform) styleResult.textTransform = textTransform;

  return {
    logoSrc,
    logoAlt,
    siteTitle: siteTitle || null,
    items,
    cta,
    style: styleResult,
  };
}

// ---------------------------------------------------------------------------
// Browser injection source string
// ---------------------------------------------------------------------------

/**
 * Self-contained factory source for the extractNav function.
 * Evaluated in the browser via:
 *   new Function('return (' + factorySrc + ')')()
 * Returns `{ extractNav }`.
 */
const _extractNavSrc = extractNav.toString();

const _navFactorySrc = `(function() {
  var MAX_NAV_ITEMS = ${MAX_NAV_ITEMS};
  var extractNav = (${_extractNavSrc});
  return { extractNav: extractNav };
})`;

export const NAV_EXTRACT_FACTORY_SOURCE: { factorySrc: string } = {
  factorySrc: _navFactorySrc,
};
