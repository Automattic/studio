// ---------------------------------------------------------------------------
// Pro Gallery resilience helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * True when a Playwright error is the "Execution context was destroyed,
 * most likely because of a navigation" failure. Wix **Pro Gallery** pages
 * (e.g. swiftlumber.com/projects) fire a client-side navigation during
 * hydration that invalidates the JS context just as our in-page
 * `page.evaluate` extraction runs — a deterministic-in-the-wild but
 * timing-dependent race. We detect it so the evaluate can be re-tried after
 * re-settling the page (and, failing that, fall back to parsing the served
 * HTML). Matches both the Playwright phrasing and the underlying CDP
 * "Execution context was destroyed." / "context was destroyed" wordings.
 */
export function isExecutionContextDestroyed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /execution context was destroyed|context was destroyed|because of (?:a )?navigation/i.test(
    msg
  );
}

/**
 * Best-effort init script that pins the route during in-page evaluation.
 *
 * Wix Pro Galleries call `history.pushState`/`replaceState` and write to
 * `location` (deep-link / lightbox state) during hydration; that's what
 * destroys our execution context mid-evaluate. Installed via
 * `addInitScript` (so it runs before the page's own scripts on the next
 * navigation), it no-ops the history methods and swallows `location.href` /
 * `location.assign` / `location.replace` writes. This keeps the document on
 * the URL we navigated to long enough to read its DOM/globals.
 *
 * Strictly best-effort: a script with location interception sometimes can't
 * fully override the native `location` setter across browsers, so the retry
 * + HTML fallback layers remain the real safety net. Exported as a string
 * constant so a unit test can assert its shape without a live browser.
 */
export const ROUTE_PIN_INIT_SCRIPT = `
(function () {
  try {
    var noop = function () { return undefined; };
    if (window.history) {
      try { window.history.pushState = noop; } catch (e) {}
      try { window.history.replaceState = noop; } catch (e) {}
    }
    try {
      var loc = window.location;
      if (loc) {
        try { loc.assign = noop; } catch (e) {}
        try { loc.replace = noop; } catch (e) {}
      }
    } catch (e) {}
  } catch (e) {}
})();
`;
