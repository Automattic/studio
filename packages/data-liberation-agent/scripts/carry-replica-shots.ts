/**
 * Screenshot the LIVE carry site into a replica-dir matching the origin layout
 * (manifest.json + desktop/<slug>.png + mobile/<slug>.png) at the SAME device
 * scale as the source captures (desktop 1440@0.7, mobile 390@1.0), so
 * liberate_compare can join origin↔replica by pathname. Site-generic via argv.
 *
 * Navigation: maps each source pathname to the LOCAL permalink via redirect-map.json
 * (posts move /post/<slug> -> /<slug>/, which WP further 301s to its date permalink).
 * Navigating the bare source path would rely on WP's canonical-redirect guessing, which
 * is unreliable for long/%-encoded slugs — so we hit the redirect-map `to` directly and
 * let page.goto follow the 301 chain. The replica manifest stays keyed by the SOURCE url
 * so liberate_compare joins origin↔replica correctly.
 *
 *   npx tsx scripts/carry-replica-shots.ts <originDir> <carryBaseUrl> <replicaDir> [concurrency]
 *   (concurrency defaults to 6; also settable via the CONCURRENCY env var)
 */
import { chromium } from 'playwright';
import { shimNames } from './_pw.js';
import { mapPool } from '../src/lib/concurrency.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [originDir, carryBaseUrl, replicaDir] = process.argv.slice(2);
if (!originDir || !carryBaseUrl || !replicaDir) {
  console.error('usage: tsx scripts/carry-replica-shots.ts <originDir> <carryBaseUrl> <replicaDir>');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(originDir, 'screenshots/manifest.json'), 'utf8'));
const entries: Record<string, { slug?: string }> = manifest.entries || manifest;

// Restrict to the CARRIED set when the driver wrote carry-pages.json (e.g. an EXCLUDE'd subset):
// screenshot only the pages that actually got carried islands, so the parity report doesn't include
// pages you deliberately didn't carry (those are still imported from the slim WXR, just not carried).
// Absent carry-pages.json → screenshot the whole manifest (back-compat).
let carriedSlugs: Set<string> | null = null;
const carryListPath = join(originDir, 'carry-pages.json');
if (existsSync(carryListPath)) {
  const carried = JSON.parse(readFileSync(carryListPath, 'utf8')) as Array<{ htmlSlug?: string }>;
  carriedSlugs = new Set(carried.map((p) => p.htmlSlug).filter((s): s is string => !!s));
}

// redirect-map: source pathname -> local permalink (so posts hit /<slug>/ not /post/<slug>)
const redirectTo = new Map<string, string>();
const rmPath = join(originDir, 'redirect-map.json');
if (existsSync(rmPath)) {
  const rm = JSON.parse(readFileSync(rmPath, 'utf8')) as Array<{ from: string; to: string }>;
  for (const r of rm) redirectTo.set(r.from.replace(/\/$/, ''), r.to);
}
const navFor = (pathname: string) => redirectTo.get(pathname.replace(/\/$/, '')) ?? pathname;

mkdirSync(join(replicaDir, 'desktop'), { recursive: true });
mkdirSync(join(replicaDir, 'mobile'), { recursive: true });

async function settle(page: import('playwright').Page) {
  await page.evaluate(async () => {
    // Only the TOP viewport is screenshotted (liberate_compare scores the top region),
    // so scroll just enough to trigger top + near-fold lazy images — NOT the whole page,
    // which on a long carried page is the dominant cost.
    const span = Math.min(document.body.scrollHeight, window.innerHeight * 2);
    for (let y = 0; y < span; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    // Wait only for images within the captured region — below-fold lazy imgs we never
    // scrolled to would otherwise leave decode() pending until the timeout.
    const imgs = Array.from(document.images).filter((im) => im.getBoundingClientRect().top < window.innerHeight * 2);
    const wait = Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : im.decode().catch(() => undefined))));
    await Promise.race([wait, new Promise((r) => setTimeout(r, 4000))]);
  });
  const hasFrame = await page.evaluate(() => !!document.querySelector('.lib-carry-mobile-frame'));
  await page.waitForTimeout(hasFrame ? 2500 : 400);
}

// Worker-pool capture over (url, viewport) work items — NO batch barrier, so a slow
// heavy page (big DOM + the multi-MB carried CSS) never stalls the others and every
// worker stays busy; desktop + mobile of the same URL also run in parallel. The carry
// site is LOCAL (no 429 risk) and the Studio PHP server handles concurrent requests, so
// the real limiter is browser-side render CPU — set the pool near the core count.
// Override via 4th arg or CONCURRENCY env. Clamped to [1, 12]; default 6.
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.argv[5] ?? process.env.CONCURRENCY ?? 6) || 6));
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

type Vp = { vp: { width: number; height: number }; scale: number; dir: 'desktop' | 'mobile'; mobile: boolean };
const VIEWPORTS: Vp[] = [
  { vp: { width: 1440, height: 900 }, scale: 0.7, dir: 'desktop', mobile: false },
  { vp: { width: 390, height: 844 }, scale: 1, dir: 'mobile', mobile: true },
];

async function run() {
  const base = carryBaseUrl.replace(/\/$/, '');
  const browser = await chromium.launch();
  const filtered = Object.entries(entries).filter(
    ([, info]) => info.slug && (!carriedSlugs || carriedSlugs.has(info.slug)),
  ) as Array<[string, { slug: string }]>;

  // One manifest entry per URL, pre-populated so the desktop + mobile workers for the
  // same URL only set their own viewport key (never race to recreate the entry).
  const filesByUrl = new Map<string, Record<string, string>>();
  for (const [url, info] of filtered) filesByUrl.set(url, { slug: info.slug });

  // One work item per (url, viewport), fanned out via the shared mapPool worker pool.
  const items: Array<{ url: string; slug: string } & Vp> = [];
  for (const [url, info] of filtered) for (const v of VIEWPORTS) items.push({ url, slug: info.slug, ...v });

  let fails = 0;
  await mapPool(items, CONCURRENCY, async (w) => {
    const pathname = new URL(w.url).pathname;
    const ctx = await browser.newContext(
      w.mobile
        ? { viewport: w.vp, deviceScaleFactor: w.scale, isMobile: true, hasTouch: true, userAgent: MOBILE_UA }
        : { viewport: w.vp, deviceScaleFactor: w.scale },
    );
    const page = await ctx.newPage();
    await shimNames(page);
    try {
      // Heavy carried pages (big DOM + multi-MB CSS) can blow the goto timeout when
      // several render at once under concurrency. Retry — by the next attempt other
      // workers have usually finished and freed CPU. (Backoff between tries.)
      for (let attempt = 1; ; attempt++) {
        try {
          await page.goto(base + navFor(pathname), { waitUntil: 'load', timeout: 45000 });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await page.waitForTimeout(1500 * attempt);
        }
      }
      await settle(page);
      const rel = `${w.dir}/${w.slug}.png`;
      // Clip to the viewport — the top region liberate_compare actually scores — not
      // fullPage. The compare crops the fullPage SOURCE to this same region, so scores
      // are unchanged; this avoids rendering/encoding the whole (long) carried page.
      // (For a full-page visual diff, use scripts/_qa-shot.ts.)
      await page.screenshot({ path: join(replicaDir, rel), fullPage: false });
      filesByUrl.get(w.url)![w.dir] = rel;
    } catch (e) {
      fails++;
      console.warn(`  fail ${w.dir} ${pathname}: ${(e as Error).message.slice(0, 60)}`);
    }
    await page.close();
    await ctx.close();
  });

  const replicaManifest = { version: 1, entries: Object.fromEntries(filesByUrl) };
  writeFileSync(join(replicaDir, 'manifest.json'), JSON.stringify(replicaManifest, null, 2));
  console.log(`captured ${filesByUrl.size} urls (${fails} viewport failures, concurrency ${CONCURRENCY}) -> ${replicaDir}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
