import type { Page } from 'playwright';
import { expandCollapsedContent, waitForAppWidgets } from './dynamic-content.js';

/**
 * Wait for a page to reach a stable state after load.
 *
 *   goto('load') ─▶ settleMs ─▶ networkidle best-effort (5s) ─▶ fonts.ready (4s) ─▶ done
 *
 * Networkidle is wrapped in try/catch because chatty analytics (GA, Intercom)
 * can hold it open indefinitely; we don't want that to block capture.
 *
 * The trailing font wait resolves FOIT (flash-of-invisible-text) BEFORE we
 * screenshot. Text styled with a custom @font-face — e.g. a Wix nav menu built
 * from an uploaded webfont — renders fully INVISIBLE during the font's block
 * period; capturing in that window drops the text from the screenshot (this is
 * exactly why source captures of Wix navs came back blank). It runs last, after
 * networkidle, so any font request issued by late hydration JS is already in
 * flight and document.fonts.ready waits for it to actually apply.
 */
export async function waitForStable(page: Page, settleMs: number = 1000): Promise<void> {
  await page.waitForLoadState('load');
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 5_000 });
  } catch {
    /* best-effort — analytics can keep network busy forever */
  }
  await waitForFonts(page);
}

/**
 * Wait for web fonts to finish loading (or fail) so FOIT resolves before a
 * screenshot. Best-effort and timeout-bounded: a webfont that never settles
 * (or a hostile/blocked CDN) must not hang or fail the capture.
 */
export async function waitForFonts(page: Page, timeoutMs: number = 4_000): Promise<void> {
  try {
    await withEvaluateTimeout(
      // document.fonts.ready resolves once every in-use @font-face has loaded or
      // errored; map to a serializable value so playwright can return it.
      page.evaluate(() => document.fonts.ready.then(() => true)),
      timeoutMs,
    );
  } catch {
    /* best-effort — never block capture on a slow/blocked webfont */
  }
}

/**
 * Wait for in-flight CSS animations/transitions to finish so opacity/transform
 * states are fully settled before the screenshot.
 *
 * The motivating case: a scroll-reactive sticky header (Wix and others) fades on
 * scroll and transitions back when returned to the top. After `triggerLazyLoad`
 * scrolls back and re-fires a scroll event, that restore transition is in
 * flight; capturing mid-transition freezes the header at PARTIAL opacity — a Wix
 * nav caught at ~20% reads as "blank" even though the font already loaded and
 * `document.fonts.ready` resolved. This is distinct from FOIT ([[waitForFonts]]):
 * the glyphs ARE painting, the whole layer is half-faded. It also settles genuine
 * entrance reveals (sections that fade in on viewport entry).
 *
 * `getAnimations()` returns both CSSAnimation and CSSTransition objects, so
 * awaiting their `.finished` settles the transition. Infinite animations
 * (spinners, looping marquees) never finish and are excluded; the whole wait is
 * timeout-bounded so a long/stuck animation can't hang the capture.
 */
export async function waitForAnimations(page: Page, timeoutMs: number = 2_000): Promise<void> {
  try {
    await withEvaluateTimeout(
      page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            // `.finished` rejects if the animation is cancelled mid-flight; swallow
            // so one cancelled reveal doesn't reject the whole settle.
            .map((a) => a.finished.catch(() => undefined)),
        ).then(() => true),
      ),
      timeoutMs,
    );
  } catch {
    /* best-effort — never block capture on a slow/stuck animation */
  }
}

/**
 * Scroll from top to bottom in 500px increments with 200ms between steps, wait
 * for networkidle (5s max, best-effort), then RESTORE the top scroll state and
 * let the resulting transitions settle. Triggers lazy-loaded images so the
 * subsequent screenshot captures actual content instead of placeholders.
 *
 * Restoring the top state matters for scroll-reactive sticky headers: the
 * scroll-through above fades/hides them, and a bare `scrollTo(0, 0)` does NOT
 * un-hide them — the builder's scroll handler only recomputes the at-top state
 * on a real scroll EVENT. So we scroll to top AND dispatch a `scroll` event,
 * then [[waitForAnimations]] for the restore (and any viewport-entry reveals) to
 * finish. Without this the header is captured faded — the root cause of "blank"
 * Wix nav captures (verified: header section opacity 1 at load → 0 after a bare
 * lazy scroll → back to 1 after scrollTo(0,0)+scroll-event).
 *
 * EVERY scrollTo here is explicit-instant (`behavior: 'instant'` overrides css
 * `html{scroll-behavior:smooth}` per spec). A smooth-scroll site turns a bare
 * scrollTo into a GLIDE that races the capture: the walrus probe measured the
 * restore at scrollY 4 with the is-scrolled header still compressed (h:52)
 * 400ms after scrollTo(0,0)+dispatch — the glide finished DURING the
 * screenshot (after-snap: y 0, h:84), so scroll-reactive chrome captured
 * nondeterministically (32 css px header ghost on the replica side).
 */
export async function triggerLazyLoad(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const step = 500;
      const pauseMs = 200;
      const total = document.documentElement.scrollHeight;
      for (let y = 0; y < total; y += step) {
        window.scrollTo({ top: y, left: 0, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, pauseMs));
      }
      window.scrollTo({ top: total, left: 0, behavior: 'instant' });
    });
    try {
      await page.waitForLoadState('networkidle', { timeout: 5_000 });
    } catch { /* best-effort */ }
    // Dynamic / JS-app content: expand statically-collapsed sections, then wait for known
    // content widgets (reviews / FAQ apps) to populate — so the snapshot captures real
    // content, not an empty placeholder. Both are no-ops on ordinary pages. (See
    // dynamic-content.ts; DISCOVERIES 2026-06-04.)
    await expandCollapsedContent(page);
    await waitForAppWidgets(page);
    // Return to top AND fire a scroll event so scroll-reactive headers recompute
    // their at-top (un-faded) state — scrollTo alone doesn't trigger their handler.
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      window.dispatchEvent(new Event('scroll'));
    });
    // Scroll handlers are throttled/debounced (~200ms observed on Wix), so the
    // restore transition starts a beat AFTER the event — waitForAnimations would
    // otherwise sample before it begins and return early. Give the handler time
    // to kick the transition off, then wait for that transition to finish.
    await new Promise((r) => setTimeout(r, 400));
    await waitForAnimations(page);
  } catch {
    /* if the page crashes or blocks our script, don't fail the capture */
  }
}

/**
 * Race a page.evaluate promise against a hard timeout. Chatty scripts or
 * hostile origins shouldn't hang the capture indefinitely.
 */
export async function withEvaluateTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`evaluate timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Overlay dismissal (takeover modals + cookie/consent banners)
// ===========================================================================
// A source site's takeover modal (ad/newsletter popup) or consent banner gets
// captured as part of the "true" page unless we dismiss it before capture.
// Detection runs in the browser and returns serializable descriptors; the
// scoring/selection below is pure Node so it is unit-testable without a browser.
// ---------------------------------------------------------------------------

/** One fixed/sticky candidate element, as measured in the page. */
export interface OverlayCandidate {
  idx: number;               // matches the in-page data-lib-overlay stamp
  selector: string;          // best-effort CSS path, for logging
  role: string | null;       // role attribute
  ariaModal: boolean;        // aria-modal="true"
  zIndex: number;            // computed z-index, non-numeric → 0
  coverageRatio: number;     // boundingBox area / viewport area, clamped 0..1
  hasBackdrop: boolean;      // a sibling fixed, ≥90%-coverage, semi-opaque layer exists
  vendorHint: boolean;       // id/class matches a popup-vendor pattern
  text: string;              // lowercased textContent, truncated
  ariaLabel: string | null;  // lowercased aria-label
  hasCloseAffordance: boolean; // a visible close control exists in the subtree
}

/** Page-global scroll-lock state (one modal locking scroll affects the page). */
export interface ScrollLockState {
  active: boolean;
}

/** What detectOverlays returns: candidates + the page scroll-lock state. */
export interface OverlayDetection {
  candidates: OverlayCandidate[];
  scrollLock: ScrollLockState;
}

/** A candidate that selection decided IS an overlay, with how it scored. */
export interface OverlayTarget {
  idx: number;
  kind: 'takeover' | 'consent';
  score: number;
  signals: string[];
  selector: string;
  hasCloseAffordance: boolean;
}

// DismissedOverlay and DismissOverlaysOpts are forward-declared here; they are
// consumed by the dismissOverlays orchestrator added in a later task.

/** A record of one overlay we dismissed (returned + logged for observability). */
export interface DismissedOverlay {
  selector: string;
  method: 'close-click' | 'escape' | 'remove';
  kind: 'takeover' | 'consent';
  score: number;
  signals: string[];
}

export interface DismissOverlaysOpts {
  /** Max detect→dismiss rounds (stacked overlays). Default 3. */
  maxRounds?: number;
}

/** A candidate scoring this or higher is treated as a takeover modal. */
export const OVERLAY_THRESHOLD = 4;

/**
 * Score a candidate from its signals. Pure — the browser supplies the measured
 * descriptor + page scroll-lock state. scroll-lock is applied as a flat +3 to
 * every candidate (page-global evidence that something locked scroll); benign
 * chrome stays ≤3 because it lacks the other signals, so the threshold of 4
 * keeps it. Documented risk: a legitimately full-screen scroll-locking
 * experience (coverage≥90 + lock = 6) would be dismissed.
 */
export function scoreOverlay(
  c: OverlayCandidate,
  scrollLock: ScrollLockState,
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  if (c.ariaModal || c.role === 'dialog' || c.role === 'alertdialog') {
    score += 3;
    signals.push('dialog');
  }
  if (scrollLock.active) {
    score += 3;
    signals.push('scroll-lock');
  }
  if (c.coverageRatio >= 0.9) {
    score += 3;
    signals.push('coverage>=90');
  } else if (c.coverageRatio >= 0.5) {
    score += 2;
    signals.push('coverage>=50');
  }
  if (c.zIndex >= 100000) {
    score += 2;
    signals.push('z>=1e5');
  } else if (c.zIndex >= 1000) {
    score += 1;
    signals.push('z>=1000');
  }
  if (c.hasBackdrop) {
    score += 1;
    signals.push('backdrop');
  }
  if (c.vendorHint) {
    score += 1;
    signals.push('vendor');
  }
  return { score, signals };
}

const CONSENT_TEXT_RE = /\bcookies?\b|\bconsent\b|\bgdpr\b|\bccpa\b|\baccept all\b|privacy (policy|preferences)/i;
const CONSENT_VENDOR_RE = /onetrust|cookiebot|usercentrics|termly|osano|trustarc|cookieyes/i;

/**
 * A looser, separate classifier for cookie/consent banners. They frequently do
 * NOT lock scroll and are thin strips, so they won't clear the takeover score;
 * we flag them by consent keywords / known vendors in their text/aria/selector.
 */
export function isConsentBanner(c: OverlayCandidate): boolean {
  const hay = `${c.text} ${c.ariaLabel ?? ''} ${c.selector}`;
  return CONSENT_TEXT_RE.test(hay) || CONSENT_VENDOR_RE.test(hay);
}

/**
 * Decide which candidates are overlays and in what order to dismiss them.
 * Pure. Takeovers (score ≥ threshold) first, highest score first; then consent
 * banners that did not already qualify as takeovers. Benign chrome is dropped.
 */
export function selectOverlayTargets(d: OverlayDetection): OverlayTarget[] {
  const takeovers: OverlayTarget[] = [];
  const consents: OverlayTarget[] = [];
  // `?? []` keeps this pure fn total: a partial detection result can't throw
  // (lets the mocked-browser path be a true no-op, and removes a hidden
  // dependency on dismissOverlays' try/catch).
  for (const c of d.candidates ?? []) {
    const { score, signals } = scoreOverlay(c, d.scrollLock);
    // Ambient signals alone (page-global scroll-lock + a SIBLING modal's backdrop)
    // can lift benign sticky chrome to the threshold. Require a takeover to either
    // carry its own modal semantics (aria-modal / role=dialog) OR cover a real slice
    // of the viewport — so a small age-gate dialog is still caught while a thin
    // sticky header (no modal role, tiny coverage) is not.
    const hasModalRole = c.ariaModal || c.role === 'dialog' || c.role === 'alertdialog';
    if (score >= OVERLAY_THRESHOLD && (hasModalRole || c.coverageRatio >= 0.15)) {
      takeovers.push({
        idx: c.idx, kind: 'takeover', score, signals,
        selector: c.selector, hasCloseAffordance: c.hasCloseAffordance,
      });
    } else if (isConsentBanner(c)) {
      consents.push({
        idx: c.idx, kind: 'consent', score, signals: [...signals, 'consent'],
        selector: c.selector, hasCloseAffordance: c.hasCloseAffordance,
      });
    }
  }
  takeovers.sort((a, b) => b.score - a.score);
  return [...takeovers, ...consents];
}

/**
 * Measure all fixed/sticky candidates in the page, stamp each with
 * data-lib-overlay="<idx>" (and its close control with data-lib-overlay-close)
 * so Node can target them, and return descriptors + the page scroll-lock state.
 */
function detectOverlays(page: Page): Promise<OverlayDetection> {
  return page.evaluate(() => {
    const VENDOR = /klaviyo|privy|optinmonster|justuno|sumo|mailchimp|popup|newsletter|subscribe|interstitial/i;
    const SCROLL_LOCK = /(prevent|disable|no)[-_]?(body[-_]?)?scroll|modal[-_]?open|scroll[-_]?lock/i;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const vpArea = vw * vh || 1;
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const visible = (cs: CSSStyleDeclaration) =>
      cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.1;

    const lockActive = [document.body, document.documentElement].some((el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflow === 'clip' ||
          cs.overflowY === 'hidden' || cs.overflowY === 'clip') return true;
      return SCROLL_LOCK.test(cls(el));
    });

    const cssPath = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const c = cls(el).trim() ? '.' + cls(el).trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${tag}${id}${c}`;
    };

    const CLOSE_SEL =
      '[aria-label*="close" i],[title*="close" i],button[class*="close" i],[data-dismiss],[data-testid*="close" i]';
    const findClose = (el: Element): Element | null => {
      const explicit = el.querySelector(CLOSE_SEL);
      if (explicit) return explicit;
      const btns = Array.from(el.querySelectorAll('button,a,[role="button"]'));
      return btns.find((b) => {
        const t = (b.textContent || '').trim().toLowerCase();
        return t === '×' || t === '✕' || t === 'x' || t === 'close';
      }) || null;
    };

    const hasBackdrop = (el: Element): boolean => {
      const sibs = el.parentElement ? Array.from(el.parentElement.children) : [];
      return sibs.some((s) => {
        if (s === el) return false;
        const cs = getComputedStyle(s);
        if (cs.position !== 'fixed') return false;
        const r = s.getBoundingClientRect();
        const cover = (r.width * r.height) / vpArea;
        const op = parseFloat(cs.opacity || '1');
        const bg = cs.backgroundColor || '';
        return cover >= 0.9 && (op < 1 || /rgba?\([^)]*0?\.\d+\s*\)/.test(bg));
      });
    };

    const candidates: Array<Record<string, unknown>> = [];
    let idx = 0;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const cs = getComputedStyle(el);
      if ((cs.position !== 'fixed' && cs.position !== 'sticky') || !visible(cs)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.1 && r.height < vh * 0.1) continue; // drop trackers/badges
      el.setAttribute('data-lib-overlay', String(idx));
      const close = findClose(el);
      if (close) close.setAttribute('data-lib-overlay-close', String(idx));
      candidates.push({
        idx,
        selector: cssPath(el),
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal') === 'true',
        zIndex: parseInt(cs.zIndex, 10) || 0,
        coverageRatio: Math.min(1, (r.width * r.height) / vpArea),
        hasBackdrop: hasBackdrop(el),
        vendorHint: VENDOR.test(`${el.id} ${cls(el)}`),
        text: (el.textContent || '').toLowerCase().slice(0, 400),
        ariaLabel: ((el.getAttribute('aria-label') || '').toLowerCase()) || null,
        hasCloseAffordance: !!close,
      });
      idx++;
    }
    return { candidates, scrollLock: { active: lockActive } } as unknown as OverlayDetection;
  });
}

/** Is the stamped overlay still present + visible? */
function overlayPresent(page: Page, idx: number): Promise<boolean> {
  return page.evaluate((i: number) => {
    const el = document.querySelector(`[data-lib-overlay="${i}"]`);
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.1;
  }, idx);
}

/** If body/html scroll is still locked, force-unlock it (best-effort). */
function ensureScrollUnlocked(page: Page): Promise<void> {
  return page.evaluate(() => {
    const SCROLL_LOCK = /(prevent|disable|no)[-_]?(body[-_]?)?scroll|modal[-_]?open|scroll[-_]?lock/i;
    const isLocked = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      return cs.overflow === 'hidden' || cs.overflow === 'clip' ||
             cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    };
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      (el as HTMLElement).style.overflow = '';
      // Strip only KNOWN single-purpose scroll-lock classes (safe to remove).
      if (typeof el.className === 'string') {
        el.className = el.className.split(/\s+/).filter((c) => c && !SCROLL_LOCK.test(c)).join(' ');
      }
      // If a lock survives (inline !important, or an unrecognized lock class), force it
      // open via an important inline override rather than brute-force-removing site
      // classes — removing a class that also drives styling would corrupt carried HTML.
      if (isLocked(el as HTMLElement)) {
        (el as HTMLElement).style.setProperty('overflow', 'visible', 'important');
      }
    }
  });
}

/** Remove every detection stamp so the captured HTML is clean. */
function cleanupStamps(page: Page): Promise<void> {
  return page.evaluate(() => {
    for (const a of ['data-lib-overlay', 'data-lib-overlay-close', 'data-lib-overlay-consent']) {
      for (const el of Array.from(document.querySelectorAll(`[${a}]`))) el.removeAttribute(a);
    }
  });
}

/**
 * Last resort: remove the stamped overlay, and (for takeovers only) a
 * full-viewport sibling backdrop. Scroll-unlock is NOT done here — the
 * orchestrator calls ensureScrollUnlocked after any round that acted (a
 * successful force-remove always sets a method), so duplicating the unlock
 * probe here would be redundant.
 *
 * `removeBackdrop` is gated to takeover modals: a consent strip reaching Tier 3
 * could share a parent with a real full-viewport fixed element (hero bg / app
 * shell), and deleting that would corrupt the carried page.
 */
function forceRemoveOverlay(page: Page, idx: number, removeBackdrop: boolean): Promise<void> {
  return page.evaluate(({ i, removeBackdrop }: { i: number; removeBackdrop: boolean }) => {
    const el = document.querySelector(`[data-lib-overlay="${i}"]`);
    if (el) {
      if (removeBackdrop) {
        const vpArea = (window.innerWidth || 1) * (window.innerHeight || 1) || 1;
        const parent = el.parentElement;
        if (parent) {
          for (const s of Array.from(parent.children)) {
            if (s === el) continue;
            const cs = getComputedStyle(s);
            const r = s.getBoundingClientRect();
            if (cs.position === 'fixed' && (r.width * r.height) / vpArea >= 0.9) s.remove();
          }
        }
      }
      el.remove();
    }
  }, { i: idx, removeBackdrop });
}

/**
 * Click a consent banner's accept/reject control (preferring reject/decline).
 * Stamps the chosen control so Node can issue a real, trusted click. Returns
 * whether a control was found + clicked.
 */
async function clickConsentControl(page: Page, idx: number): Promise<boolean> {
  const found = await page.evaluate((i: number) => {
    const root = document.querySelector(`[data-lib-overlay="${i}"]`);
    if (!root) return false;
    const ACCEPT = /^(reject|decline|accept|agree|got it|allow|ok)\b/i;
    const ctrls = Array.from(root.querySelectorAll('button,a,[role="button"]'));
    const prefer = ctrls.find((b) => /^(reject|decline)\b/i.test((b.textContent || '').trim()));
    const chosen = prefer || ctrls.find((b) => ACCEPT.test((b.textContent || '').trim()));
    if (!chosen) return false;
    chosen.setAttribute('data-lib-overlay-consent', String(i));
    return true;
  }, idx);
  if (!found) return false;
  try {
    await page.click(`[data-lib-overlay-consent="${idx}"]`, { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

/** Attempt to dismiss one target; returns the method that worked, or null. */
async function dismissOne(
  page: Page,
  t: OverlayTarget,
): Promise<DismissedOverlay['method'] | null> {
  // Skip if already gone (e.g. removed by a sibling's close handler).
  if (!(await overlayPresent(page, t.idx))) return null;
  // Consent banners: their accept/reject control IS the dismissal (and rarely a
  // close ×), so try it before the generic close affordance.
  if (t.kind === 'consent') {
    if (await clickConsentControl(page, t.idx)) {
      if (!(await overlayPresent(page, t.idx))) return 'close-click';
    }
  }
  // Tier 1 — graceful close: a real click fires the site's handler, which
  // releases its own scroll-lock.
  if (t.hasCloseAffordance) {
    try {
      await page.click(`[data-lib-overlay-close="${t.idx}"]`, { timeout: 1500 });
      if (!(await overlayPresent(page, t.idx))) return 'close-click';
    } catch {
      /* fall through to the next tier */
    }
  }
  // Tier 2 — Escape (many modal libraries close on it).
  try {
    await page.keyboard.press('Escape');
    if (!(await overlayPresent(page, t.idx))) return 'escape';
  } catch {
    /* fall through to the next tier */
  }
  // Tier 3 — force remove + unlock (last resort). Backdrop removal is gated to
  // takeovers: a consent strip could share a parent with a real full-screen
  // fixed element we must not delete.
  try {
    await forceRemoveOverlay(page, t.idx, t.kind === 'takeover');
    if (!(await overlayPresent(page, t.idx))) return 'remove';
  } catch {
    /* give up on this overlay */
  }
  return null;
}

/**
 * Best-effort: detect and dismiss takeover modals + consent banners before
 * capture. NEVER throws — a dismissal failure must not fail a capture. Bounded
 * by maxRounds; re-detects each round to clear stacked/late overlays.
 */
export async function dismissOverlays(
  page: Page,
  opts: DismissOverlaysOpts = {},
): Promise<DismissedOverlay[]> {
  const maxRounds = opts.maxRounds ?? 3;
  const dismissed: DismissedOverlay[] = [];
  try {
    for (let round = 0; round < maxRounds; round++) {
      const detection = await withEvaluateTimeout(detectOverlays(page), 4000);
      const targets = selectOverlayTargets(detection);
      if (targets.length === 0) break;
      let acted = 0;
      for (const t of targets) {
        const method = await dismissOne(page, t);
        if (method) {
          dismissed.push({ selector: t.selector, method, kind: t.kind, score: t.score, signals: t.signals });
          acted++;
        }
      }
      if (acted > 0) await ensureScrollUnlocked(page);
      await cleanupStamps(page);
      if (acted === 0) break; // nothing dismissable left; stop early
    }
  } catch {
    /* best-effort — never fail a capture on overlay dismissal */
  } finally {
    try { await cleanupStamps(page); } catch { /* ignore */ }
  }
  return dismissed;
}
