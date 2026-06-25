import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Dynamic / JS-app content handling for the capture phase.
//
// Some pages render their BODY from a third-party JS app AFTER load (reviews
// widgets like Loox/Yotpo, FAQ/help widgets, etc.). If we snapshot before they
// populate, the captured HTML is an empty placeholder — the carry then renders a
// blank body (see DISCOVERIES 2026-06-04, getsnooz reviews/FAQ at 0.24). These
// helpers (1) expand statically-collapsed content, (2) wait for known widgets to
// populate before snapshotting, and (3) assess whether a captured page ended up
// with a real body or an empty one (so the run can flag it instead of shipping it).
// ---------------------------------------------------------------------------

/**
 * Third-party content widgets whose body is injected by JS after page load. Container
 * selectors are valid CSS (usable in both cheerio and `querySelectorAll`). Extend freely
 * as new apps are encountered — this registry is the single source for Phase 2 + Phase 0.
 */
export interface KnownWidget {
  name: string;
  selector: string;
}
export const KNOWN_WIDGETS: KnownWidget[] = [
  { name: 'loox', selector: '#looxReviews, .loox-reviews, [id^="looxReviews"], [data-loox]' },
  { name: 'yotpo', selector: '.yotpo, [class*="yotpo-"]' },
  { name: 'judgeme', selector: '.jdgm-widget, .jdgm-rev-widg, [data-jdgm-widget]' },
  { name: 'okendo', selector: '[data-oke-widget], .okeReviews' },
  { name: 'stamped', selector: '#stamped-main-widget, .stamped-main-widget' },
  { name: 'reviews-io', selector: '#reviewsio-carousel-widget, .ruk_rating_snippet' },
  { name: 'zendesk', selector: 'iframe[src*="zendesk"], [id*="zendesk"]' },
  { name: 'gorgias', selector: 'iframe[src*="gorgias"]' },
  { name: 'elfsight', selector: '[class*="elfsight-app"]' },
];

const WIDGET_SELECTOR = KNOWN_WIDGETS.map((w) => w.selector).join(', ');

/**
 * Phase 1 — expand statically-collapsed content so the screenshot captures it. Opens
 * `<details>`, expands real disclosure toggles (`[aria-expanded="false"][aria-controls]`
 * — the aria-controls gate avoids tripping nav menus / dropdowns), and clicks
 * "show more / load more / view all" BUTTONS (not `<a>`, which would navigate).
 * Best-effort; never throws into the capture loop.
 */
export async function expandCollapsedContent(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      document.querySelectorAll('details:not([open])').forEach((d) => {
        (d as HTMLDetailsElement).open = true;
      });
      document.querySelectorAll('[aria-expanded="false"][aria-controls]').forEach((el) => {
        try { (el as HTMLElement).click(); } catch { /* ignore */ }
      });
      const labels = ['load more', 'show more', 'show all', 'view all', 'see all', 'read more', 'expand all'];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (t && labels.some((l) => t === l || t.startsWith(l))) {
          try { (el as HTMLElement).click(); } catch { /* ignore */ }
        }
      });
      await new Promise((r) => setTimeout(r, 400));
    });
  } catch { /* page blocked our script — don't fail the capture */ }
}

/**
 * Phase 2 — when a known third-party content widget is on the page, wait until it has
 * actually populated (its container gains child content / text) before we snapshot, so we
 * don't capture an empty placeholder. Polls up to `timeoutMs`; no-op when no known widget
 * is present (so it costs nothing on ordinary pages). Best-effort.
 */
export async function waitForAppWidgets(page: Page, timeoutMs = 8000): Promise<void> {
  try {
    await page.evaluate(
      async ({ sel, timeout }) => {
        const containers = Array.from(document.querySelectorAll(sel));
        if (containers.length === 0) return;
        const populated = (el: Element) =>
          el.childElementCount > 0 || (el.textContent || '').trim().length > 40;
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          if (containers.every(populated)) return;
          await new Promise((r) => setTimeout(r, 250));
        }
      },
      { sel: WIDGET_SELECTOR, timeout: timeoutMs },
    );
  } catch { /* best-effort */ }
}

export interface BodyAssessment {
  /** Text-based emptiness — a fallback signal only. Static HTML can't see that a JS app's
   *  DOM is present-but-renders-blank, so prefer the rendered-height signal (see
   *  `classifyEmptyReason` + readPngHeight) when a screenshot is available. */
  empty: boolean;
  reason: 'ok' | 'iframe' | 'app-widget' | 'thin';
  detail?: string;
  /** Raw signals, exposed so callers can classify the REASON independently of the
   *  (unreliable) text-emptiness threshold. */
  widget: string | null;
  crossOriginIframe: boolean;
  mainTextLen: number;
}

/**
 * Phase 0 — classify a CAPTURED page's body. Pure (operates on the HTML string).
 *
 * IMPORTANT: text length is a weak emptiness signal — a JS app (reviews/FAQ widget)
 * leaves a populated-looking DOM that renders BLANK without its script, and Shopify
 * pages carry ~300 chars of cart/skip-link boilerplate even when "empty". So the
 * `empty` flag here is only a fallback; the reliable emptiness signal is the rendered
 * height (`readPngHeight`, compared to the page-set median). The widget / cross-origin
 * iframe / text-length signals are exposed for the caller to name the REASON.
 */
export function assessBody(html: string, siteOrigin?: string): BodyAssessment {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, svg').remove();
  const body = $('body'); // cheerio.load always synthesizes a <body>, even for fragments

  const widget = KNOWN_WIDGETS.find((w) => body.find(w.selector).length > 0)?.name ?? null;
  const crossOriginIframe = body
    .find('iframe[src]')
    .toArray()
    .some((el) => {
      const src = $(el).attr('src') || '';
      if (!/^https?:\/\//i.test(src)) return false;
      try {
        return !siteOrigin || new URL(src).origin !== siteOrigin;
      } catch {
        return true;
      }
    });

  const main = body.clone();
  main.find('header, nav, footer, [role="banner"], [role="contentinfo"], [role="navigation"]').remove();
  const mainTextLen = main.text().replace(/\s+/g, ' ').trim().length;

  const EMPTY_THRESHOLD = 200;
  const empty = mainTextLen < EMPTY_THRESHOLD;
  const reason: BodyAssessment['reason'] = crossOriginIframe
    ? 'iframe'
    : widget
      ? 'app-widget'
      : empty
        ? 'thin'
        : 'ok';
  const detail = crossOriginIframe
    ? 'cross-origin <iframe> body'
    : widget
      ? widget
      : `${mainTextLen} chars of body text`;
  return { empty, reason, detail, widget, crossOriginIframe, mainTextLen };
}

/**
 * Read a PNG's pixel height straight from its IHDR (no decode, no deps): the height is a
 * big-endian uint32 at byte offset 20 (8-byte signature + 4 length + "IHDR" = 16, then
 * width@16, height@20). The rendered full-page height is the reliable "is this body
 * empty?" signal — a chrome-only page renders dramatically shorter than a content page.
 * Returns null if the file is missing or not a PNG.
 */
export function readPngHeight(path: string): number | null {
  try {
    const buf = readFileSync(path);
    // 8-byte signature, then the first chunk MUST be IHDR (length@8, type@12). Verify the
    // type bytes too — not just the signature — so a corrupt/non-PNG file can't yield a
    // garbage height that would poison the page-set median in classifyEmptyBodies.
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    const height = buf.readUInt32BE(20);
    // Reject implausible heights (0 / corrupt huge value) rather than skew the median.
    return height > 0 && height <= 200_000 ? height : null;
  } catch {
    return null;
  }
}

export interface PageStat {
  slug: string;
  /** Rendered desktop capture height in px (from `readPngHeight`), or null if unavailable. */
  height: number | null;
  assess: BodyAssessment;
}
export interface EmptyBody {
  slug: string;
  reason: 'iframe' | 'app-widget' | 'short-render' | 'thin';
  detail?: string;
}

/** A page carrying at least this much real body text is never flagged on height alone —
 *  it rescues genuinely-short-but-real pages (long policy copy, an unstyled doc) that
 *  render compact without being empty. Sits well above Shopify's ~300-char cart
 *  boilerplate and well below a real content page. */
const TEXT_RICH_THRESHOLD = 1000;
/** A page rendering shorter than this fraction of the page-set median is "chrome-only". */
const SHORT_RENDER_FRACTION = 0.5;

/**
 * Phase 0 decision over a full page set: which captures came out effectively EMPTY (a
 * JS app that never rendered — reviews/FAQ widgets, cross-origin iframes — leaving just
 * site chrome). The reliable signal is RENDERED HEIGHT: a chrome-only page is dramatically
 * shorter than the page-set median, whereas DOM text is fooled by the app's present-but-
 * blank markup plus ~300 chars of cart boilerplate. A page is flagged when it renders
 * short AND isn't text-rich (the rescue keeps compact-but-real pages). Falls back to the
 * pure-text `assess.empty` signal for any page without a usable screenshot height.
 */
export function classifyEmptyBodies(stats: PageStat[]): EmptyBody[] {
  const heights = stats
    .map((s) => s.height)
    .filter((h): h is number => h !== null)
    .sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const out: EmptyBody[] = [];
  for (const s of stats) {
    const shortRender = median > 0 && s.height !== null && s.height < median * SHORT_RENDER_FRACTION;
    const empty =
      s.height !== null ? shortRender && s.assess.mainTextLen < TEXT_RICH_THRESHOLD : s.assess.empty;
    if (!empty) continue;
    const reason: EmptyBody['reason'] = s.assess.crossOriginIframe
      ? 'iframe'
      : s.assess.widget
        ? 'app-widget'
        : s.height !== null
          ? 'short-render'
          : 'thin';
    const detail = s.assess.crossOriginIframe
      ? s.assess.detail
      : s.assess.widget
        ? s.assess.widget
        : s.height !== null
          ? `rendered ${s.height}px vs median ${median}px`
          : s.assess.detail;
    out.push({ slug: s.slug, reason, detail });
  }
  return out;
}
