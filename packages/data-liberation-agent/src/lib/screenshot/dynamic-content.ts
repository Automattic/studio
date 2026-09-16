import { readFileSync } from 'node:fs';
import * as cheerio from 'cheerio';
import type { Page } from 'playwright';
import type { CapturedDialogInteraction } from './interaction-capture.js';

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
 * `<details>`, expands real disclosure toggles (`[aria-expanded="false"][aria-controls]`),
 * and clicks "show more / load more / view all" controls. Popup controls and
 * anchors with navigable hrefs are excluded so probing cannot leave the source document.
 * Best-effort; never throws into the capture loop.
 */
export async function expandCollapsedContent(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const safeToActivate = (element: Element) => {
        if (element.hasAttribute('aria-haspopup')) return false;
        if (element.tagName !== 'A') return true;
        const rawHref = element.getAttribute('href');
        if (rawHref === null) return true;
        const href = rawHref.trim();
        return href === '#' || href.startsWith('#');
      };
      document.querySelectorAll('details:not([open])').forEach((d) => {
        (d as HTMLDetailsElement).open = true;
      });
      document.querySelectorAll('[aria-expanded="false"][aria-controls]').forEach((el) => {
        if (!safeToActivate(el)) return;
        try { (el as HTMLElement).click(); } catch { /* ignore */ }
      });
      const labels = ['load more', 'show more', 'show all', 'view all', 'see all', 'read more', 'expand all'];
      document.querySelectorAll('button, [role="button"]').forEach((el) => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (safeToActivate(el) && t && labels.some((l) => t === l || t.startsWith(l))) {
          try { (el as HTMLElement).click(); } catch { /* ignore */ }
        }
      });
      await new Promise((r) => setTimeout(r, 400));
    });
  } catch { /* page blocked our script — don't fail the capture */ }
}

const MAX_DISCLOSURE_CANDIDATES = 32;
const MAX_DISCLOSURE_HTML_BYTES = 512 * 1024;
/** How long the restore step will wait for a runtime's own close-unmount to land
 *  before giving up (see `hydrateDisclosureContent` — the Radix Presence exit case). */
const MAX_DISCLOSURE_SETTLE_MS = 1000;

/** Raw, plain-object shape returned across the `page.evaluate` boundary — see
 *  `hydrateDisclosureContent` for how this is folded into a `CapturedDialogInteraction`. */
interface RawDisclosureRecord {
  status: 'captured' | 'no-dialog' | 'click-failed';
  trigger: { selector: string; tag: string; id?: string; label?: string };
  target: { selector: string; tag: string; id?: string };
  html?: string;
  error?: string;
}

function boundDisclosureHtml(html: string): { html: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(html);
  if (bytes <= MAX_DISCLOSURE_HTML_BYTES) return { html, bytes, truncated: false };
  return { html: Buffer.from(html).subarray(0, MAX_DISCLOSURE_HTML_BYTES).toString(), bytes, truncated: true };
}

/**
 * Preserve content that a disclosure runtime only mounts while one item is open —
 * FAQ/accordion panels being the common case. A runtime like Radix (shadcn/ui)
 * UNMOUNTS a collapsed panel's children entirely, so the served static markup is
 * an empty `<div role="region" hidden>`: the answer text exists only inside the
 * JS bundle and is otherwise silently lost from the captured page.
 *
 * Detection is purely ARIA-based — `aria-expanded` on the trigger plus either
 * `aria-controls` (the forward relationship) or, when a runtime never writes
 * `aria-controls` at all, the reverse relationship of a `role="region"` panel's
 * `aria-labelledby` pointing back at the trigger's id. No vendor/framework
 * attribute (e.g. `data-radix-*`) is used, so this generalizes to any ARIA
 * disclosure widget built the same way.
 *
 * Each candidate is expanded independently, its revealed content captured,
 * then RECLOSED before the next candidate runs — required for single-open
 * ("accordion") widgets, where opening item N can auto-collapse item N-1: by
 * capturing-then-restoring one at a time, an already-captured sibling being
 * auto-collapsed is harmless. Restoring a still-empty region back to its
 * observed content means the panel keeps its original `hidden`/`aria-expanded`
 * state (collapsed items stay visually collapsed) while its content is now
 * physically present in the DOM rather than lost to the `hidden` attribute.
 *
 * The restore deliberately WAITS (bounded — see `MAX_DISCLOSURE_SETTLE_MS`) for
 * a runtime that unmounts closed panels to finish its exit animation first:
 * such a runtime (Radix Presence) keeps the panel's children mounted ~200ms
 * after the close, so restoring immediately would misread the transient mount
 * as "content survived" and skip the write-back, letting the pending unmount
 * delete the panel's only copy of its content.
 *
 * Runs after the visual reference so hydration cannot change screenshot
 * geometry, and BEFORE `page.content()` is serialized, so the captured static
 * HTML contains the restored panels directly (no post-hoc wiring needed).
 *
 * Returns per-candidate diagnostics folded into `interaction-states.json`
 * alongside dialog/menu captures (`kind: 'disclosure'`) so this work is
 * observable with the same `candidate_count`/`captured_count` conventions.
 */
export async function hydrateDisclosureContent(page: Page): Promise<CapturedDialogInteraction[]> {
  let raw: RawDisclosureRecord[];
  try {
    const result = await page.evaluate(async ({ limit, settleMs }: { limit: number; settleMs: number }) => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const hasContent = (element: Element) =>
        Boolean((element.textContent || '').trim()) ||
        Boolean(element.querySelector('img,video,audio,picture,svg,canvas'));
      const cssEscape = (value: string) =>
        globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const elementPath = (element: Element): string => {
        const parts: string[] = [];
        for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) {
          const tag = node.tagName.toLowerCase();
          const siblings = node.parentElement
            ? Array.from(node.parentElement.children).filter((sibling) => sibling.tagName === node!.tagName)
            : [];
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
        }
        return `body > ${parts.join(' > ')}`;
      };
      const describe = (element: Element) => ({
        selector: element.id ? `#${cssEscape(element.id)}` : elementPath(element),
        tag: element.tagName.toLowerCase(),
        ...(element.id ? { id: element.id } : {}),
      });
      const describeTrigger = (element: HTMLElement) => ({
        ...describe(element),
        ...((element.getAttribute('aria-label') || element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40)
          ? {
              label: (element.getAttribute('aria-label') || element.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 40),
            }
          : {}),
      });

      /** Generic ARIA disclosure candidates: aria-expanded + either aria-controls
       *  (forward) or a role="region" panel's aria-labelledby back to the trigger
       *  (reverse — the pattern a runtime that unmounts closed panels leaves behind,
       *  since it never bothers writing aria-controls on the trigger at all). */
      const findCandidates = (): Array<{ trigger: HTMLElement; target: HTMLElement }> => {
        const seen = new Set<HTMLElement>();
        const out: Array<{ trigger: HTMLElement; target: HTMLElement }> = [];
        document
          .querySelectorAll<HTMLElement>('[aria-expanded="false"][aria-controls]:not([aria-haspopup])')
          .forEach((trigger) => {
            const id = trigger.getAttribute('aria-controls') || '';
            const target = id ? document.getElementById(id) : null;
            if (target && target.getAttribute('role') === 'region' && !seen.has(trigger)) {
              seen.add(trigger);
              out.push({ trigger, target });
            }
          });
        document.querySelectorAll<HTMLElement>('[role="region"][aria-labelledby]').forEach((target) => {
          const id = target.getAttribute('aria-labelledby') || '';
          const trigger = id ? (document.getElementById(id) as HTMLElement | null) : null;
          if (
            trigger &&
            !seen.has(trigger) &&
            trigger.getAttribute('aria-expanded') === 'false' &&
            !trigger.hasAttribute('aria-haspopup')
          ) {
            seen.add(trigger);
            out.push({ trigger, target });
          }
        });
        return out;
      };

      const records: RawDisclosureRecord[] = [];
      let hydrated = 0;
      for (let pass = 0; pass < 3 && hydrated < limit; pass++) {
        const candidates = findCandidates()
          .filter((candidate) => !hasContent(candidate.target))
          .slice(0, limit - hydrated);
        if (candidates.length === 0) break;

        const observed: Array<{ target: HTMLElement; content: string; trigger: HTMLElement }> = [];
        for (const { trigger, target } of candidates) {
          try {
            trigger.click();
          } catch (error) {
            records.push({
              status: 'click-failed',
              trigger: describeTrigger(trigger),
              target: describe(target),
              error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            });
            continue;
          }
          for (let attempt = 0; attempt < 20; attempt++) {
            if (trigger.getAttribute('aria-expanded') === 'true' && hasContent(target)) break;
            await wait(50);
          }
          if (trigger.getAttribute('aria-expanded') !== 'true' || !hasContent(target)) {
            records.push({ status: 'no-dialog', trigger: describeTrigger(trigger), target: describe(target) });
            continue;
          }

          const content = target.innerHTML;
          trigger.click();
          for (let attempt = 0; attempt < 10; attempt++) {
            if (trigger.getAttribute('aria-expanded') === 'false') break;
            await wait(50);
          }
          await wait(50);
          observed.push({ target, content, trigger });
        }
        // A runtime like Radix keeps a just-closed panel's children mounted through
        // its exit animation (Presence) and unmounts them only ~200ms LATER. The
        // restore guard below reads a still-mounted panel as "already has content"
        // and skips the write-back — and the pending unmount then deletes the
        // panel's only copy of its content. The most recently closed item always
        // loses this race (every earlier item's unmount has landed by the time the
        // restore loop runs), which is why the LAST accordion item shipped empty
        // while the rest survived. So wait — bounded, concurrently for all observed
        // panels — for a transient exit mount to clear before restoring. A runtime
        // that never unmounts closed panels simply runs out the deadline here and
        // is left untouched by the guard below, exactly as before.
        const settleDeadline = Date.now() + settleMs;
        const pending = observed.filter((entry) => hasContent(entry.target));
        while (pending.length > 0 && Date.now() < settleDeadline) {
          for (let i = pending.length - 1; i >= 0; i--) {
            if (!hasContent(pending[i].target)) pending.splice(i, 1);
          }
          if (pending.length > 0) await wait(25);
        }
        for (const { target, content, trigger } of observed) {
          if (!hasContent(target)) target.innerHTML = content;
          target.dataset.dlaHydratedDisclosure = 'true';
          records.push({
            status: 'captured',
            trigger: describeTrigger(trigger),
            target: describe(target),
            html: target.outerHTML,
          });
        }
        hydrated += observed.length;
        await wait(100);
      }
      return records;
    }, { limit: MAX_DISCLOSURE_CANDIDATES, settleMs: MAX_DISCLOSURE_SETTLE_MS });
    raw = Array.isArray(result) ? (result as RawDisclosureRecord[]) : [];
  } catch {
    raw = [];
  }

  return raw.map((record): CapturedDialogInteraction => {
    const bounded = record.html !== undefined ? boundDisclosureHtml(record.html) : undefined;
    return {
      status: record.status,
      kind: 'disclosure',
      trigger: {
        selector: record.trigger.selector,
        tag: record.trigger.tag,
        ...(record.trigger.id ? { id: record.trigger.id } : {}),
        ariaHaspopup: '',
        ...(record.target.id ? { ariaControls: record.target.id } : {}),
        ...(record.trigger.label ? { label: record.trigger.label } : {}),
        dataBindings: {},
      },
      ...(bounded
        ? {
            dialog: {
              selector: record.target.selector,
              tag: record.target.tag,
              ...(record.target.id ? { id: record.target.id } : {}),
              role: 'region',
              ariaModal: false,
              html: bounded.html,
              htmlBytes: bounded.bytes,
              htmlTruncated: bounded.truncated,
            },
          }
        : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  });
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
