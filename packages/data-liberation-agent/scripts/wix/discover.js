#!/usr/bin/env node
/**
 * discover.js — Step 1: Inventory a Wix site
 *
 * Fetches the sitemap, categorizes all URLs, and extracts navigation structure.
 *
 * Usage:
 *   node scripts/discover.js https://yoursite.wixsite.com/sitename
 *
 * Output:
 *   output/inventory.json — categorized list of all content URLs
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const args = process.argv.slice(2);
const wixUrl = args.find(a => a.startsWith('http'));
if (!wixUrl) {
  console.error('Usage: node scripts/discover.js <wix-url>');
  process.exit(1);
}
const uaArg = args.indexOf('--user-agent');
const userAgent = uaArg !== -1 ? args[uaArg + 1] : null;
const cdpPortArg = args.indexOf('--cdp-port');
const cdpPort = cdpPortArg !== -1 ? parseInt(args[cdpPortArg + 1]) : null;

const base = new URL(wixUrl).origin + new URL(wixUrl).pathname.replace(/\/$/, '');
mkdirSync('output', { recursive: true });

// Classify a URL into a content type
function classify(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.includes('/blog/') || path.includes('/post/')) return 'blog-post';
  if (path.includes('/product/') || path.includes('/store/')) return 'product';
  if (path.includes('/gallery') || path.includes('/portfolio')) return 'gallery';
  if (path.includes('/event') || path.includes('/events')) return 'event';
  if (path === '/' || path === '') return 'homepage';
  return 'page';
}

async function fetchSitemap(page, url) {
  const urls = [];
  try {
    const response = await page.goto(url, { timeout: 15000 });
    if (!response.ok()) return urls;
    const text = await page.content();
    const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
    for (const loc of locs) {
      // Recurse into sitemap indexes
      if (loc.endsWith('.xml')) {
        const sub = await fetchSitemap(page, loc);
        urls.push(...sub);
      } else {
        urls.push(loc);
      }
    }
  } catch (e) {
    console.error(`  Sitemap fetch failed for ${url}: ${e.message}`);
  }
  return urls;
}

async function extractNav(page) {
  return page.evaluate(() => {
    const navLinks = [];
    document.querySelectorAll('nav a, header a, [role="navigation"] a').forEach(a => {
      const text = a.textContent.trim();
      const href = a.href;
      if (text && href && !href.includes('#') && !navLinks.find(l => l.href === href)) {
        navLinks.push({ text, href });
      }
    });
    return navLinks;
  });
}

async function main() {
  console.log(`Discovering: ${wixUrl}`);
  let browser, context, page;
  if (cdpPort) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    context = browser.contexts()[0] || await browser.newContext();
    page = await context.newPage();
  } else {
    browser = await chromium.launch();
    context = await browser.newContext({
      ...(userAgent ? { userAgent } : {}),
    });
    page = await context.newPage();
  }

  // Fetch sitemap
  console.log('Fetching sitemap...');
  const sitemapUrls = await fetchSitemap(page, `${base}/sitemap.xml`);
  console.log(`  Found ${sitemapUrls.length} URLs in sitemap`);

  // If sitemap is empty, try the page's own links
  let allUrls = sitemapUrls;
  if (allUrls.length === 0) {
    console.log('Sitemap empty or not found. Crawling homepage for links...');
    await page.goto(wixUrl, { waitUntil: 'networkidle', timeout: 30000 });
    allUrls = await page.evaluate((origin) => {
      return [...new Set([...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.startsWith(origin) && !h.includes('#'))
      )];
    }, new URL(wixUrl).origin);
  }

  // Extract navigation from homepage
  console.log('Extracting navigation structure...');
  await page.goto(wixUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const nav = await extractNav(page);

  // Categorize URLs
  const inventory = {
    siteUrl: wixUrl,
    discoveredAt: new Date().toISOString(),
    navigation: nav,
    counts: {},
    urls: []
  };

  for (const url of allUrls) {
    const type = classify(url);
    inventory.urls.push({ url, type });
    inventory.counts[type] = (inventory.counts[type] || 0) + 1;
  }

  await browser.close();

  writeFileSync('output/inventory.json', JSON.stringify(inventory, null, 2));

  console.log('\nInventory summary:');
  for (const [type, count] of Object.entries(inventory.counts)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nTotal: ${inventory.urls.length} URLs`);
  console.log('Written to output/inventory.json');
  console.log('\nReview this inventory before running extract.js');
}

main().catch(e => { console.error(e); process.exit(1); });
