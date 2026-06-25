/**
 * Chrome-fidelity audit driver (carry path).
 *
 * Renders the BUILT carry site's home page in Playwright, extracts its
 * header/footer/nav chrome with the same structural walk used at source-capture
 * time (modulo the wp-block-template-part UNWRAP — see extractBuiltChromeRows),
 * diffs against the source fingerprint captured during extraction, and appends
 * source-copied CSS corrections to the carry theme's site.css.
 *
 * Usage:
 *   npx tsx scripts/carry-chrome-audit-run.ts <outputDir> <builtBaseUrl> <studioSitePath>
 *
 * Arguments:
 *   outputDir       — extraction output dir, e.g. ~/Studio/_liberations/example.com
 *   builtBaseUrl    — Studio carry site base URL, e.g. http://localhost:8881
 *   studioSitePath  — on-disk Studio site path, e.g. ~/Studio/example-com-carry
 *
 * Outputs:
 *   <outputDir>/chrome-audit.json  — { schema, corrections, unmatched, droppedChrome }
 *   <studioSitePath>/wp-content/themes/<slug>/assets/css/site.css  — corrections appended
 *
 * Exit codes: 0 = success (including no-fingerprint early exit), non-zero = error.
 */
import { chromium } from 'playwright';
import { newShimmedPage } from './_pw.js';
import { readChromeFidelity } from '../src/lib/replicate/chrome-fidelity-store.js';
import { extractBuiltChromeRows } from '../src/lib/screenshot/capture-chrome-fidelity.js';
import {
  buildBuiltChrome,
  diffChromeFidelity,
  emitChromeCorrectionCss,
  CHROME_CORRECTION_MARKER,
} from '../src/lib/replicate/carry-chrome-audit.js';
import { CHROME_AUDIT_PROPERTIES } from '../src/lib/replicate/chrome-audit-types.js';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { join, basename, resolve } from 'node:path';
import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Argv
// ---------------------------------------------------------------------------

const [outputDir, builtBaseUrl, studioSitePath] = process.argv.slice(2);
if (!outputDir || !builtBaseUrl || !studioSitePath) {
  console.error(
    'usage: npx tsx scripts/carry-chrome-audit-run.ts <outputDir> <builtBaseUrl> <studioSitePath>',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the carry theme slug from the outputDir (mirrors the reconstruction
 * handler: sanitize the basename, append -replica, strip -replica, append -carry).
 * E.g. ~/Studio/_liberations/example.com → example-com-carry
 */
function deriveCarryThemeSlug(dir: string): string {
  const base = basename(dir).toLowerCase();
  const sanitized = base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const baseSlug = sanitized ? `${sanitized}-replica` : 'site-replica';
  return baseSlug.replace(/-replica$/, '') + '-carry';
}

/**
 * Resolve the WP root inside a Studio site path.
 * Handles both flat (`wp-content/` directly inside) and nested (`wordpress/wp-content/`) layouts.
 */
function resolveWpRoot(sitePath: string): string | null {
  const p = resolve(sitePath);
  if (existsSync(join(p, 'wp-content'))) return p;
  const nested = join(p, 'wordpress');
  if (existsSync(join(nested, 'wp-content'))) return nested;
  return null;
}

/**
 * Settle the page: wait for JS to run, scroll to bottom (triggers footer rendering
 * and lazy elements), then scroll back to top. Mirrors the settle pattern in
 * carry-replica-shots.ts but simplified — we just need chrome to be visible, not
 * images to fully load for screenshots.
 */
async function settle(page: Page): Promise<void> {
  // Give JS 1500ms to run (nav reveal, sticky header, etc.)
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    // Scroll to bottom so the footer renders (some themes lazy-render it).
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    // Scroll back to top so header/nav are in their natural state.
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const resolvedOutputDir = resolve(outputDir);

  // Step 1: load the source fingerprint. Exit gracefully if not present.
  const screenshotsDir = join(resolvedOutputDir, 'screenshots');
  const fid = readChromeFidelity(screenshotsDir);
  if (!fid) {
    console.log('chromeFidelity=no-fingerprint');
    process.exit(0);
  }

  // Step 2: resolve the carry theme's site.css path.
  const wpRoot = resolveWpRoot(studioSitePath);
  if (!wpRoot) {
    console.error(
      `studioSitePath has no wp-content (checked ${resolve(studioSitePath)}/wp-content and nested wordpress/wp-content).`,
    );
    process.exit(1);
  }
  const carrySlug = deriveCarryThemeSlug(resolvedOutputDir);
  const themeRoot = join(wpRoot, 'wp-content', 'themes', carrySlug);
  const siteCssPath = join(themeRoot, 'assets', 'css', 'site.css');

  if (!existsSync(siteCssPath)) {
    console.error(
      `Carry theme site.css not found at ${siteCssPath}. ` +
        `Expected slug: ${carrySlug}. Run liberate_reconstruct_pages_carry first.`,
    );
    process.exit(1);
  }

  // Step 3: launch browser and render the built home page.
  const base = builtBaseUrl.replace(/\/$/, '');
  const homeUrl = `${base}/`;

  console.log(`Auditing chrome fidelity: ${homeUrl}`);

  const browser = await chromium.launch();
  let rows;
  try {
    const page = await newShimmedPage(browser, { width: 1440, height: 900 });
    try {
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      throw new Error(
        `Failed to navigate to ${homeUrl}: ${(e as Error).message.slice(0, 120)}`,
      );
    }
    await settle(page);

    // NOTE: v1 audits the home page only. An interior page (product/carry page)
    // would give additional chrome coverage; add a second pass here in a future iteration.

    // Step 4: extract built-side chrome rows (with wp-block-template-part UNWRAP).
    rows = await extractBuiltChromeRows(page, CHROME_AUDIT_PROPERTIES);
  } finally {
    await browser.close();
  }

  // Step 5: diff against the source fingerprint.
  const builtChrome = buildBuiltChrome(rows);
  const res = diffChromeFidelity(fid, builtChrome);

  // Step 6: emit and append CSS corrections.
  const css = emitChromeCorrectionCss(res.corrections, 'body.lib-carry-site');
  if (css) {
    const currentCss = readFileSync(siteCssPath, 'utf8');
    // Idempotent: strip any prior audit block (always appended last) so re-running
    // the audit replaces it instead of accumulating duplicate correction blocks.
    const markerIdx = currentCss.indexOf(CHROME_CORRECTION_MARKER);
    const base = markerIdx >= 0 ? currentCss.slice(0, markerIdx).replace(/\n+$/, '') : currentCss;
    // Atomic write (tmp+rename) — a crash mid-write must not corrupt site.css.
    const cssTmp = `${siteCssPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(cssTmp, base + css);
    renameSync(cssTmp, siteCssPath);
    console.log(`Appended ${res.corrections.length} correction(s) to ${siteCssPath}`);
  }

  // Step 7: write chrome-audit.json atomically (tmp+rename).
  const auditPath = join(resolvedOutputDir, 'chrome-audit.json');
  const auditTmp = `${auditPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(
    auditTmp,
    JSON.stringify({ schema: 1, corrections: res.corrections, unmatched: res.unmatched, droppedChrome: res.droppedChrome }, null, 2),
  );
  renameSync(auditTmp, auditPath);

  // Step 8: report.
  console.log(
    `chromeCorrections=${res.corrections.length} unmatched=${res.unmatched} droppedChrome=${res.droppedChrome}`,
  );
}

main().catch((e) => {
  console.error(`carry-chrome-audit-run: ${(e as Error).message ?? e}`);
  process.exit(1);
});
