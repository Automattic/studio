// Shared Playwright helpers for the dev scripts in this directory.
//
// THE __name FIX
// tsx transpiles with esbuild's `keepNames`, which rewrites named functions and
// classes to `__name(fn, "name")` so `fn.name` survives. That's fine in Node, but
// when such a function is handed to `page.evaluate` / `page.addInitScript`,
// Playwright serializes it and runs it IN THE BROWSER — where `__name` does not
// exist → `ReferenceError: __name is not defined`. (vitest's transform does NOT
// keepNames, so vitest-run code is unaffected; this only bites `tsx scripts/*.ts`
// that pass a named function — or a closure containing one — into page.evaluate.)
//
// Fix: define a `__name` identity shim in every page context BEFORE any evaluate.
// The init script is passed as a STRING on purpose — a string is not transpiled by
// esbuild, so it can't itself be rewritten to reference the not-yet-defined shim
// (which a compiled closure would, re-introducing the bootstrap failure).
import type { Browser, Page } from 'playwright';

const NAME_SHIM = 'window.__name = window.__name || function (f) { return f; };';

/** A new page with the `__name` shim installed — use this instead of
 *  `browser.newPage()` in any tsx script that calls page.evaluate. */
export async function newShimmedPage(
  browser: Browser,
  viewport: { width: number; height: number } = { width: 1440, height: 900 },
): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(NAME_SHIM);
  return page;
}

/** Install the shim on a page created elsewhere (call before the first evaluate). */
export async function shimNames(page: Page): Promise<void> {
  await page.addInitScript(NAME_SHIM);
}
