#!/usr/bin/env node
/**
 * extract.js — Step 2: Extract all content from a Wix site
 *
 * Strategy: intercept Wix's internal JSON API calls during normal page load.
 * This gives clean structured data without parsing obfuscated HTML.
 *
 * Usage:
 *   node scripts/extract.js <wix-url> [options]
 *   node scripts/extract.js https://yoursite.wixsite.com/sitename
 *   node scripts/extract.js https://yoursite.wixsite.com/sitename --delay 2000
 *   node scripts/extract.js https://yoursite.wixsite.com/sitename --url-list output/inventory.json
 *
 * Options:
 *   --delay <ms>        Delay between pages in ms (default: 500). Increase for large sites.
 *   --url-list <file>   Use URL list from discover.js output instead of re-crawling sitemap
 *   --limit <n>         Only process first N URLs (for testing)
 *
 * Output:
 *   output/pages/<slug>.json     — extracted page data
 *   output/media/               — downloaded images and files
 *   output/extraction-log.json  — summary of what was extracted
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync, createWriteStream } from 'fs';
import { basename, extname } from 'path';
import { pipeline } from 'stream/promises';
import https from 'https';
import http from 'http';

const args = process.argv.slice(2);
const wixUrl = args.find(a => a.startsWith('http'));
if (!wixUrl) {
  console.error('Usage: node scripts/extract.js <wix-url>');
  process.exit(1);
}

const delay = parseInt(args[args.indexOf('--delay') + 1] || '500');
const limitArg = args.indexOf('--limit');
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1]) : Infinity;
const urlListArg = args.indexOf('--url-list');
const urlListFile = urlListArg !== -1 ? args[urlListArg + 1] : null;
const uaArg = args.indexOf('--user-agent');
const userAgent = uaArg !== -1 ? args[uaArg + 1] : null;
const cdpPortArg = args.indexOf('--cdp-port');
const cdpPort = cdpPortArg !== -1 ? parseInt(args[cdpPortArg + 1]) : null;

mkdirSync('output/pages', { recursive: true });
mkdirSync('output/media', { recursive: true });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function slugify(url) {
  return new URL(url).pathname.replace(/^\//, '').replace(/\//g, '--') || 'homepage';
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = createWriteStream(destPath);
    proto.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function extractImageUrls(data) {
  const urls = new Set();
  const str = JSON.stringify(data);
  // Wix image URLs: static.wixstatic.com, images.wixmp.com
  const matches = str.match(/https:\/\/[^"]*(?:wixstatic\.com|wixmp\.com)[^"]*/g) || [];
  for (const url of matches) {
    // Clean up any Wix image transform params to get the original
    const clean = url.split('/v1/')[0].split('~mv2')[0] + (url.includes('~mv2') ? url.match(/~mv2\.[a-z]+/)?.[0] || '' : '');
    urls.add(url); // Keep original URL for downloading
  }
  return [...urls];
}

async function extractPageData(page, url) {
  const captured = { apiCalls: [], globals: null, accessibility: null, text: null };

  // Intercept Wix's internal API calls
  const responseHandler = async (response) => {
    const respUrl = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    const isWixApi = respUrl.includes('/_api/') ||
                     respUrl.includes('wixapis.com') ||
                     respUrl.includes('wix.com/_api');
    if (!isWixApi) return;

    try {
      const body = await response.json();
      captured.apiCalls.push({ url: respUrl, data: body });
    } catch {}
  };

  page.on('response', responseHandler);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.error(`  Navigation failed: ${e.message}`);
  }

  page.off('response', responseHandler);

  // Extract window globals
  captured.globals = await page.evaluate(() => {
    const result = {};

    // Try known Wix globals
    const knownGlobals = ['__WIX_DATA__', '__SITE_DATA__', 'wixBiSession',
                          'wixPerformanceMeasurements', '__wixInjectedPageData'];
    for (const g of knownGlobals) {
      if (window[g]) result[g] = window[g];
    }

    // Scan for any __WIX* or _wix* globals
    for (const key of Object.keys(window)) {
      if ((key.startsWith('__WIX') || key.startsWith('_wix')) && !result[key]) {
        try { result[key] = window[key]; } catch {}
      }
    }

    // JSON-LD structured data (most reliable for SEO metadata)
    result.jsonLd = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map(s => {
      try { return JSON.parse(s.textContent); } catch { return null; }
    }).filter(Boolean);

    // Basic page metadata
    result.meta = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content,
      ogTitle: document.querySelector('meta[property="og:title"]')?.content,
      ogDescription: document.querySelector('meta[property="og:description"]')?.content,
      ogImage: document.querySelector('meta[property="og:image"]')?.content,
      canonical: document.querySelector('link[rel="canonical"]')?.href,
    };

    return result;
  });

  // Get accessibility tree for content extraction
  const client = await page.context().newCDPSession(page);
  try {
    const axResult = await client.send('Accessibility.getFullAXTree', { depth: 10 });
    // Extract just the text-bearing nodes — keeps the file size manageable
    const textNodes = (axResult.nodes || []).filter(n =>
      ['heading', 'paragraph', 'StaticText', 'link', 'img', 'list', 'listitem',
       'article', 'main', 'section'].includes(n.role?.value)
    ).map(n => ({
      role: n.role?.value,
      name: n.name?.value,
      description: n.description?.value,
    })).filter(n => n.name);
    captured.accessibility = textNodes;
  } catch (e) {
    console.error(`  Accessibility tree failed: ${e.message}`);
  }

  await client.detach();
  return captured;
}

async function getUrls(page) {
  if (urlListFile) {
    const data = JSON.parse(readFileSync(urlListFile, 'utf8'));
    return data.urls.map(u => u.url);
  }
  // Fall back to sitemap
  await page.goto(`${new URL(wixUrl).origin}/sitemap.xml`, { timeout: 15000 });
  const text = await page.content();
  const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  return locs.filter(l => !l.endsWith('.xml'));
}

async function main() {
  console.log(`Extracting: ${wixUrl}`);

  let browser, context, page;
  if (cdpPort) {
    // Connect to the user's real browser — gets their cookies, session, and correct UA
    console.log(`Connecting to browser on CDP port ${cdpPort}...`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
    console.log('Connected to user browser (cookies and login sessions available)');
  } else {
    // Fallback: launch a standalone Playwright browser (no cookies)
    console.log('No CDP port — launching standalone browser (no login sessions)');
    browser = await chromium.launch();
    context = await browser.newContext({
      ...(userAgent ? { userAgent } : {}),
    });
    page = await context.newPage();
  }
  if (userAgent && !cdpPort) {
    console.log(`User agent: ${userAgent.slice(0, 70)}...`);
  }

  const urls = (await getUrls(page)).slice(0, limit);
  console.log(`Processing ${urls.length} URLs...\n`);

  const log = { processed: [], failed: [], mediaDownloaded: [] };
  const allImageUrls = new Set();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const slug = slugify(url);
    console.log(`[${i + 1}/${urls.length}] ${url}`);

    try {
      const data = await extractPageData(page, url);
      data.sourceUrl = url;
      data.slug = slug;
      data.extractedAt = new Date().toISOString();

      writeFileSync(`output/pages/${slug}.json`, JSON.stringify(data, null, 2));

      // Collect image URLs for downloading
      for (const imgUrl of extractImageUrls(data)) {
        allImageUrls.add(imgUrl);
      }

      log.processed.push({ url, slug });
      console.log(`  API calls captured: ${data.apiCalls.length}, Globals: ${Object.keys(data.globals || {}).length}`);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      log.failed.push({ url, error: e.message });
    }

    if (i < urls.length - 1) await sleep(delay);
  }

  // Download all media
  console.log(`\nDownloading ${allImageUrls.size} media files...`);
  for (const imgUrl of allImageUrls) {
    const filename = basename(new URL(imgUrl).pathname) || `image-${Date.now()}${extname(imgUrl) || '.jpg'}`;
    const dest = `output/media/${filename}`;
    try {
      await downloadFile(imgUrl, dest);
      log.mediaDownloaded.push({ url: imgUrl, file: dest });
      process.stdout.write('.');
    } catch (e) {
      log.failed.push({ url: imgUrl, error: `Media download: ${e.message}` });
      process.stdout.write('x');
    }
  }

  await browser.close();

  writeFileSync('output/extraction-log.json', JSON.stringify(log, null, 2));
  console.log(`\n\nDone.`);
  console.log(`  Pages extracted: ${log.processed.length}`);
  console.log(`  Media downloaded: ${log.mediaDownloaded.length}`);
  console.log(`  Failures: ${log.failed.length}`);
  if (log.failed.length) console.log('  See output/extraction-log.json for details');
}

main().catch(e => { console.error(e); process.exit(1); });
