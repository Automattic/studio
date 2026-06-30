//
// Content-region extraction
// =========================
// Pulls the page's CONTENT region out of a sanitized HTML document so
// downstream steps (heuristic-blocks, compose-page-blocks) operate on
// just the body, not the whole platform-soup including chrome.
//
// Strategy — three rules in order of confidence:
//
//   1. `<main>` element (or `<main role="main">`). When present and
//      non-trivial, this is canonical — every modern CMS that ships
//      semantic HTML uses it. Highest confidence.
//
//   2. Highest text-density block. Score every container element by
//      `text-length × text-density` (text density = text-length /
//      outer-html-length). The winner is usually the actual content
//      region: lots of text, low markup overhead. Falls through when
//      every container is tiny or markup-heavy.
//
//   3. Body minus chrome. Clone <body>, remove
//      header/nav/aside/footer/script/style/noscript and a list of
//      common chrome class/id patterns (`.site-header`, `#footer`,
//      etc.), keep the remainder. Lowest confidence; ships everything
//      we couldn't classify, which on platform-rendered pages is
//      still a lot.
//
// Design notes:
//   - Pure transformation; no I/O, no agent. Same input → same output.
//   - Returns `{ html, source, byteReduction }` so callers can log
//     which rule fired and report compression to the watch log.
//   - Validates the extracted region isn't catastrophically empty
//     (must have at least 100 chars of text); falls through to the
//     next rule if it would be.
//   - Minimum-text threshold prevents the text-density rule from
//     picking a 50-char widget when the real content is in a giant
//     positional div with mostly spans.
//

import * as cheerio from 'cheerio';

export type ContentRegionSource = 'main' | 'text-density' | 'body-minus-chrome' | 'whole-body';

export interface ContentRegionResult {
  /** The extracted HTML content region (inner HTML — no wrapping element). */
  html: string;
  /** Which rule produced the result. */
  source: ContentRegionSource;
  /** Bytes of the input HTML. */
  inputBytes: number;
  /** Bytes of the extracted region. */
  outputBytes: number;
  /** Notes for diagnostics — e.g. text density score, removed chrome elements. */
  notes: string[];
}

/** Minimum text length for a candidate region to be considered "non-trivial". */
const MIN_TEXT_LEN = 100;

/** Class/id patterns commonly used for chrome in real-world sites. Mirrored to a CSS selector list. */
const CHROME_PATTERNS = [
  // Direct semantic tags handled separately.
  // Class-based:
  '.site-header', '.site-footer', '.site-navigation',
  '.global-header', '.global-footer',
  '.navbar', '.nav-bar', '.menu-bar', '.top-bar', '.bottom-bar',
  '.breadcrumb', '.breadcrumbs',
  '.cookie-banner', '.cookie-notice', '.gdpr-banner',
  '.skip-link', '.skip-to-content',
  '.search-overlay', '.modal-overlay',
  '.cart-drawer', '.cart-sidebar',
  '.announcement-bar',
  // ID-based:
  '#header', '#footer', '#nav', '#navigation', '#site-header', '#site-footer',
  '#cart', '#search', '#breadcrumb', '#breadcrumbs',
];

export function extractContentRegion(sanitizedHtml: string): ContentRegionResult {
  const inputBytes = sanitizedHtml.length;
  const $ = cheerio.load(sanitizedHtml);
  const notes: string[] = [];

  // Rule 1 — explicit <main>
  const $main = $('main').first();
  if ($main.length > 0) {
    const text = $main.text().trim();
    if (text.length >= MIN_TEXT_LEN) {
      const html = ($main.html() ?? '').trim();
      notes.push(`<main> found, ${text.length} chars of text`);
      return {
        html,
        source: 'main',
        inputBytes,
        outputBytes: html.length,
        notes,
      };
    }
    notes.push(`<main> found but has only ${text.length} chars text — falling through`);
  }

  // Rule 2 — highest text-density container
  // Consider article/section/div elements that contain meaningful text.
  // Score = text length × density. Density punishes containers that are
  // mostly markup (e.g. navigation, sidebar widgets) and rewards prose-
  // heavy regions. We require minimum text and minimum density to avoid
  // picking a tiny container.
  let best: { el: cheerio.Cheerio<unknown>; score: number; textLen: number; density: number } | null = null;
  $('article, section, div').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.length < MIN_TEXT_LEN * 4) return; // be more demanding here
    const html = $.html($el);
    const density = text.length / Math.max(html.length, 1);
    if (density < 0.05) return; // markup-heavy, probably navigation
    const score = text.length * density;
    if (!best || score > best.score) {
      best = { el: $el, score, textLen: text.length, density };
    }
  });
  if (best) {
    // Cast through unknown — cheerio's generic parameter has tightened
    // since v1.0; we don't depend on the inner node type here, only on
    // .html() being available, which is on the base Cheerio<T>.
    const winner = (best as { el: { html: () => string | null } }).el;
    const html = (winner.html() ?? '').trim();
    notes.push(
      `text-density winner: ${(best as { textLen: number }).textLen} chars text, density=${(best as { density: number }).density.toFixed(3)}, score=${(best as { score: number }).score.toFixed(0)}`,
    );
    return {
      html,
      source: 'text-density',
      inputBytes,
      outputBytes: html.length,
      notes,
    };
  }
  notes.push('no text-density winner — falling through to body-minus-chrome');

  // Rule 3 — body minus chrome elements
  const $body = $('body').first();
  if ($body.length > 0) {
    const $clone = cheerio.load(`<body>${$body.html() ?? ''}</body>`);
    // Strip semantic chrome.
    $clone('header, nav, aside, footer, script, style, noscript').remove();
    // Strip pattern-matched chrome (best-effort; selectors that fail
    // silently do nothing).
    let removedPatterns = 0;
    for (const pat of CHROME_PATTERNS) {
      try {
        const matched = $clone(pat);
        if (matched.length > 0) {
          removedPatterns += matched.length;
          matched.remove();
        }
      } catch {
        // Invalid selector — skip silently.
      }
    }
    const html = ($clone('body').html() ?? '').trim();
    if (html.length > 0) {
      notes.push(`body-minus-chrome: stripped ${removedPatterns} chrome-pattern matches`);
      return {
        html,
        source: 'body-minus-chrome',
        inputBytes,
        outputBytes: html.length,
        notes,
      };
    }
  }

  // Last resort — return the whole body if we have one, else the whole
  // sanitized input. Better to ship something than nothing.
  const $bodyFallback = $('body').first();
  const fallback = ($bodyFallback.length > 0 ? $bodyFallback.html() : sanitizedHtml) ?? sanitizedHtml;
  notes.push('all rules failed — returning whole body unchanged');
  return {
    html: fallback.trim(),
    source: 'whole-body',
    inputBytes,
    outputBytes: fallback.length,
    notes,
  };
}
