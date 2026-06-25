#!/usr/bin/env node
/**
 * probe.js — Connect to a running browser via CDP and extract Wix internals
 *
 * Usage:
 *   node scripts/wix/probe.js [--port 9222]
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg !== -1 ? parseInt(args[portArg + 1]) : 9222;

mkdirSync('output/probe', { recursive: true });

async function probeWixPage(page, label) {
  const url = page.url();
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Probing: ${label}`);
  console.log(`URL: ${url}`);
  console.log('='.repeat(70));

  const results = { url, label, probedAt: new Date().toISOString() };

  // 1. Window globals with wix/__ prefix
  console.log('\n--- Window Globals ---');
  results.globals = await page.evaluate(() => {
    const found = {};
    for (const key of Object.keys(window)) {
      if (key.startsWith('__') || key.toLowerCase().includes('wix') || key.startsWith('_wix')) {
        try {
          const val = window[key];
          const type = typeof val;
          if (type === 'function') {
            found[key] = { type: 'function', length: val.length };
          } else if (type === 'object' && val !== null) {
            const keys = Object.keys(val).slice(0, 30);
            const size = JSON.stringify(val).length;
            found[key] = { type: 'object', keys, jsonSize: size };
          } else if (type === 'string' && val.length > 0) {
            found[key] = { type: 'string', length: val.length, preview: val.slice(0, 200) };
          } else {
            found[key] = { type, value: val };
          }
        } catch (e) {
          found[key] = { type: 'inaccessible', error: e.message };
        }
      }
    }
    return found;
  });

  for (const [k, v] of Object.entries(results.globals)) {
    if (v.type === 'object') {
      console.log(`  ${k} (object, ${v.jsonSize} bytes, keys: ${v.keys.slice(0, 8).join(', ')}${v.keys.length > 8 ? '...' : ''})`);
    } else if (v.type === 'string') {
      console.log(`  ${k} (string, ${v.length} chars): ${v.preview.slice(0, 80)}`);
    } else if (v.type === 'function') {
      console.log(`  ${k} (function)`);
    }
  }

  // 2. JSON-LD structured data
  console.log('\n--- JSON-LD ---');
  results.jsonLd = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
      .filter(Boolean);
  });
  console.log(`  Found ${results.jsonLd.length} JSON-LD blocks`);
  for (const ld of results.jsonLd) {
    console.log(`    @type: ${ld['@type']}, name: ${ld.name || ld.headline || '(none)'}`);
  }

  // 3. Cookies for wix.com
  console.log('\n--- Cookies ---');
  const cookies = await page.context().cookies();
  results.cookies = cookies.filter(c => c.domain.includes('wix')).map(c => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    // Don't log values — just names and metadata
  }));
  console.log(`  ${results.cookies.length} wix-related cookies`);
  for (const c of results.cookies.slice(0, 15)) {
    console.log(`    ${c.name} (${c.domain})`);
  }
  if (results.cookies.length > 15) console.log(`    ... and ${results.cookies.length - 15} more`);

  // 4. Local storage
  console.log('\n--- LocalStorage ---');
  results.localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      items[key] = { length: val.length, preview: val.slice(0, 200) };
    }
    return items;
  });
  const lsKeys = Object.keys(results.localStorage);
  console.log(`  ${lsKeys.length} items`);
  for (const k of lsKeys.slice(0, 10)) {
    console.log(`    ${k} (${results.localStorage[k].length} chars)`);
  }

  // 5. Fetch/XHR: try to find Wix API endpoints in performance entries
  console.log('\n--- Network (Performance API) ---');
  results.networkEntries = await page.evaluate(() => {
    return performance.getEntriesByType('resource')
      .filter(e => e.name.includes('_api') || e.name.includes('wixapis') || e.name.includes('manage.wix'))
      .map(e => ({
        url: e.name,
        type: e.initiatorType,
        duration: Math.round(e.duration),
        size: e.transferSize || 0,
      }));
  });
  console.log(`  ${results.networkEntries.length} Wix API calls in performance log`);
  // Group by endpoint base
  const endpoints = {};
  for (const entry of results.networkEntries) {
    const path = new URL(entry.url).pathname.split('/').slice(0, 4).join('/');
    endpoints[path] = (endpoints[path] || 0) + 1;
  }
  for (const [path, count] of Object.entries(endpoints).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`    ${path} (${count}x)`);
  }

  // 6. Try to find the metaSiteId and other IDs
  console.log('\n--- Site Identity ---');
  results.identity = await page.evaluate(() => {
    // Try many known locations for site IDs
    const id = {};
    // URL params
    const params = new URLSearchParams(window.location.search);
    if (params.get('metaSiteId')) id.metaSiteId = params.get('metaSiteId');

    // wixBiSession
    if (window.wixBiSession) {
      id.msid = window.wixBiSession.msid;
      id.siteMemberId = window.wixBiSession.siteMemberId;
      id.visitorId = window.wixBiSession.visitorId;
      id.viewMode = window.wixBiSession.viewMode;
    }

    // consentPolicy
    if (window.consentPolicyManager) {
      id.consentPolicy = 'present';
    }

    return id;
  });
  for (const [k, v] of Object.entries(results.identity)) {
    console.log(`  ${k}: ${v}`);
  }

  return results;
}

async function main() {
  console.log(`Connecting to CDP on port ${port}...`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ua = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`Browser: ${ua.Browser}`);
  console.log(`User-Agent: ${ua['User-Agent']}`);

  const allResults = [];

  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const url = page.url();
      if (!url.includes('wix.com')) continue;

      const label = url.includes('editor.wix.com') ? 'Wix Editor' :
                    url.includes('manage.wix.com') ? 'Wix Dashboard' :
                    'Wix Page';
      try {
        const results = await probeWixPage(page, label);
        allResults.push(results);
      } catch (e) {
        console.error(`  Failed to probe ${label}: ${e.message}`);
      }
    }
  }

  // Save full results
  writeFileSync('output/probe/wix-probe.json', JSON.stringify(allResults, null, 2));
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Full results saved to output/probe/wix-probe.json`);
  console.log('='.repeat(70));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
