/**
 * Local helper: snapshot a list of homepage URLs into output/<host>/html/homepage.html
 * as SELF-CONTAINED HTML (external stylesheets inlined) so the segmentation
 * fixture harness can lay them out offline + deterministically.
 *
 * Usage: tsx scripts/_snapshot-corpus.ts <urls-file>   (one URL per line, # comments ok)
 *
 * Site-agnostic: identity (slug) derived from each URL's hostname. Not committed.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countBodyTags, isStackingArtifact } from '../src/lib/screenshot/document-integrity.js';
import { newShimmedPage } from './_pw.js';

const urlsFile = process.argv[2];
if (!urlsFile) { console.error('usage: tsx scripts/_snapshot-corpus.ts <urls-file>'); process.exit(1); }
const urls = readFileSync(urlsFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const slugFor = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.replace(/[^a-z0-9.]+/gi, '-'); }
};

async function fetchCss(href: string): Promise<string> {
  try {
    const res = await fetch(href, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return '';
    return await res.text();
  } catch { return ''; }
}

const browser = await chromium.launch();
const results: Array<{ url: string; slug: string; ok: boolean; bytes?: number; sheets?: number; err?: string }> = [];

for (const url of urls) {
  const slug = slugFor(url);
  const page = await newShimmedPage(browser); // installs the __name shim (see _pw.ts)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4500);
    // Settle lazy media so the snapshot bakes LOADED images, not placeholders.
    // Scroll the whole page slowly (gives IntersectionObserver lazy-loaders time
    // to swap data-src -> src AND to drop their grey placeholder backgrounds, the
    // "loaded" state). Then force any stragglers (data-src/data-srcset that never
    // tripped) and wait for decode + network idle before serializing.
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)); // __name-shimmed (see _pw.ts)
      let h = document.body.scrollHeight;
      for (let y = 0; y < h; y += 400) {
        window.scrollTo(0, y);
        await sleep(140);
        h = Math.max(h, document.body.scrollHeight); // page can grow as content loads
      }
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(500);
      window.scrollTo(0, 0);
      await sleep(300);
      // Fallback for lazy images the natural scroll didn't trip.
      for (const im of Array.from(document.querySelectorAll('img[data-src]'))) {
        const s = im.getAttribute('data-src');
        if (s && !im.getAttribute('src')) im.setAttribute('src', s);
      }
      for (const im of Array.from(document.querySelectorAll('img[data-srcset], source[data-srcset]'))) {
        const s = im.getAttribute('data-srcset');
        if (s) im.setAttribute('srcset', s);
      }
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // Wait for in-DOM images to finish decoding so layout is final at capture.
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images)
          .filter((i) => !i.complete)
          .map((i) => i.decode().catch(() => undefined)),
      );
    });
    await page.waitForTimeout(800);
    // Collect external stylesheet hrefs (absolute) + the rendered HTML.
    const { linkHrefs, html } = await page.evaluate(() => {
      const hrefs = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))
        .map((l) => (l as HTMLLinkElement).href)
        .filter(Boolean);
      return { linkHrefs: hrefs, html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML };
    });
    // Fetch external CSS in node (cross-origin safe) and inline it; strip <link>s.
    let css = '';
    for (const href of [...new Set(linkHrefs)]) css += `\n/* ${href} */\n` + (await fetchCss(href));
    // Inject the inlined CSS with FUNCTION replacements. A string replacement
    // interprets `$` patterns in the replacement (`$\`` = pre-match, `$'` =
    // post-match, `$&` = match), and fetched CSS routinely contains `$\`` / `$'`
    // (e.g. in `content:` strings) — each one spliced a COPY of the surrounding
    // HTML (the whole <body>) into the file, yielding the 11× document nesting
    // that corrupted these fixtures. A function replacement is taken verbatim.
    const styleBlock = `<style data-inlined-corpus>\n${css}\n</style>\n</head>`;
    let out = html.replace(/<link[^>]*rel=["']?stylesheet[^>]*>/gi, () => '');
    out = out.replace(/<\/head>/i, () => styleBlock);
    // Belt-and-suspenders: never persist a poisoned fixture. If anything still
    // left >1 document, fail this URL loudly rather than corrupting the corpus.
    if (isStackingArtifact(out)) {
      throw new Error(`${countBodyTags(out)} documents in output — refusing to write a stacking-artifact fixture`);
    }
    const dir = join('output', slug, 'html');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'homepage.html'), out);
    results.push({ url, slug, ok: true, bytes: out.length, sheets: linkHrefs.length });
    console.error(`OK   ${slug}  ${(out.length / 1024).toFixed(0)}KB  (${linkHrefs.length} sheets inlined)`);
  } catch (e) {
    results.push({ url, slug, ok: false, err: e instanceof Error ? e.message : String(e) });
    console.error(`FAIL ${slug}  ${e instanceof Error ? e.message : e}`);
  } finally {
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify({ ok: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length, results }, null, 2));
