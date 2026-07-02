#!/usr/bin/env node
/**
 * map-apis.js — Comprehensive Wix API mapper
 *
 * Connects to a running browser via CDP, navigates through every section
 * of the Wix dashboard, and logs ALL network requests + responses.
 * Produces a full API map for reverse engineering.
 *
 * Usage:
 *   node scripts/wix/map-apis.js --cdp-port 9223
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const args = process.argv.slice(2);
const cdpPortArg = args.indexOf('--cdp-port');
const cdpPort = cdpPortArg !== -1 ? parseInt(args[cdpPortArg + 1]) : 9223;

mkdirSync('output/api-map', { recursive: true });

// ─── Network logger ─────────────────────────────────────────

class NetworkLogger {
  constructor(label) {
    this.label = label;
    this.requests = [];
    this.responses = new Map();
    this.bodies = new Map();
  }

  async attach(page, context) {
    this.client = await context.newCDPSession(page);
    await this.client.send('Network.enable', { maxPostDataSize: 65536 });

    this.client.on('Network.requestWillBeSent', (params) => {
      this.requests.push({
        requestId: params.requestId,
        timestamp: params.timestamp,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData || null,
        type: params.type,
      });
    });

    this.client.on('Network.responseReceived', async (params) => {
      this.responses.set(params.requestId, {
        status: params.response.status,
        statusText: params.response.statusText,
        headers: params.response.headers,
        mimeType: params.response.mimeType,
        url: params.response.url,
      });

      // Capture response bodies for JSON API calls
      const ct = params.response.headers['content-type'] || '';
      const url = params.response.url;
      if (ct.includes('json') || url.includes('/_api/') || url.includes('wixapis')) {
        try {
          const { body } = await this.client.send('Network.getResponseBody', {
            requestId: params.requestId
          });
          this.bodies.set(params.requestId, body);
        } catch {}
      }
    });
  }

  async detach() {
    if (this.client) await this.client.detach().catch(() => {});
  }

  getResults() {
    return this.requests.map(req => {
      const resp = this.responses.get(req.requestId);
      const body = this.bodies.get(req.requestId);
      return {
        section: this.label,
        method: req.method,
        url: req.url,
        status: resp?.status,
        mimeType: resp?.mimeType,
        requestHeaders: req.headers,
        postData: req.postData,
        responseBody: body ? tryParseJSON(body) : undefined,
        type: req.type,
      };
    });
  }

  getAPICalls() {
    return this.getResults().filter(r =>
      r.url.includes('/_api/') ||
      r.url.includes('wixapis') ||
      r.url.includes('/_serverless/') ||
      r.url.includes('/ambassador/') ||
      (r.mimeType?.includes('json') && !r.url.includes('static.parastorage'))
    );
  }
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Navigation helpers ─────────────────────────────────────

async function navigateAndWait(page, url, label) {
  console.log(`\n  → ${label}`);
  console.log(`    ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log(`    ⚠ ${e.message.split('\n')[0]}`);
    // Wait extra for lazy loads
    await sleep(3000);
  }
  // Extra wait for async API calls that fire after initial load
  await sleep(2000);
}

// ─── Main flow ──────────────────────────────────────────────

async function main() {
  console.log(`Connecting to Chrome on CDP port ${cdpPort}...`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context found');

  const allAPICalls = [];
  const apiEndpoints = new Map(); // path → { methods, statuses, sections, sampleRequest, sampleResponse }

  async function mapSection(url, label) {
    const page = await context.newPage();
    const logger = new NetworkLogger(label);
    await logger.attach(page, context);

    await navigateAndWait(page, url, label);

    // Scroll down to trigger lazy loads
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(1500);

    await logger.detach();
    const calls = logger.getAPICalls();
    console.log(`    📡 ${calls.length} API calls captured`);

    for (const call of calls) {
      allAPICalls.push(call);

      // Index by endpoint path
      const urlObj = new URL(call.url);
      const path = urlObj.pathname;
      if (!apiEndpoints.has(path)) {
        apiEndpoints.set(path, {
          path,
          methods: new Set(),
          statuses: new Set(),
          sections: new Set(),
          sampleRequestHeaders: null,
          samplePostData: null,
          sampleResponse: null,
          queryParams: new Set(),
          callCount: 0,
        });
      }
      const ep = apiEndpoints.get(path);
      ep.methods.add(call.method);
      ep.statuses.add(call.status);
      ep.sections.add(label);
      ep.callCount++;
      // Save first successful response as sample
      if (call.status === 200 && !ep.sampleResponse && call.responseBody) {
        ep.sampleResponse = call.responseBody;
        ep.sampleRequestHeaders = call.requestHeaders;
        ep.samplePostData = call.postData;
      }
      // Collect query params
      for (const [key] of urlObj.searchParams) {
        ep.queryParams.add(key);
      }
    }

    await page.close();
  }

  // ── Phase 1: Account-level pages ──

  console.log('\n' + '='.repeat(70));
  console.log('PHASE 1: Account-Level Pages');
  console.log('='.repeat(70));

  await mapSection(
    'https://manage.wix.com/account/websites?referralAdditionalInfo=Dashboard',
    'account/websites'
  );

  // Extract site list from the page before we close it
  const sitesPage = await context.newPage();
  const sitesLogger = new NetworkLogger('sites-extraction');
  await sitesLogger.attach(sitesPage, context);
  await navigateAndWait(sitesPage, 'https://manage.wix.com/account/websites', 'sites list (re-fetch)');
  await sitesLogger.detach();

  // Get site IDs from API responses
  const sitesCalls = sitesLogger.getAPICalls();
  let sites = [];
  for (const call of sitesCalls) {
    allAPICalls.push(call);
    if (call.responseBody?.sites || call.responseBody?.payload?.sites) {
      sites = call.responseBody.sites || call.responseBody.payload?.sites || [];
      break;
    }
  }

  // Also try to extract from the DOM
  if (sites.length === 0) {
    sites = await sitesPage.evaluate(() => {
      // Wix renders site cards — try to find metaSiteIds in the page data
      const links = [...document.querySelectorAll('a[href*="/dashboard/"]')];
      return links.map(a => {
        const match = a.href.match(/\/dashboard\/([a-f0-9-]+)/);
        return match ? { metaSiteId: match[1], name: a.textContent.trim() } : null;
      }).filter(Boolean);
    });
  }
  await sitesPage.close();

  console.log(`\n  Found ${sites.length} site(s)`);
  for (const site of sites) {
    const id = site.metaSiteId || site.id;
    const name = site.displayName || site.name || id;
    console.log(`    • ${name} (${id})`);
  }

  // Other account pages
  await mapSection('https://manage.wix.com/account/domains', 'account/domains');
  await mapSection('https://manage.wix.com/account/subscriptions', 'account/subscriptions');
  await mapSection('https://manage.wix.com/account/account-settings', 'account/settings');

  // ── Phase 2: Per-site dashboard sections ──

  if (sites.length > 0) {
    const siteId = sites[0].metaSiteId || sites[0].id;
    const baseUrl = `https://manage.wix.com/dashboard/${siteId}`;

    console.log('\n' + '='.repeat(70));
    console.log(`PHASE 2: Site Dashboard — ${sites[0].displayName || sites[0].name || siteId}`);
    console.log('='.repeat(70));

    // Core dashboard sections
    const dashboardSections = [
      ['setup', 'dashboard/setup'],
      ['home', 'dashboard/home'],
      ['blog', 'dashboard/blog'],
      ['blog/posts', 'dashboard/blog/posts'],
      ['blog/categories', 'dashboard/blog/categories'],
      ['store/products', 'dashboard/store/products'],
      ['media-manager', 'dashboard/media-manager'],
      ['contacts', 'dashboard/contacts'],
      ['analytics/traffic', 'dashboard/analytics/traffic'],
      ['marketing/seo', 'dashboard/marketing/seo'],
      ['settings', 'dashboard/settings'],
      ['settings/site-info', 'dashboard/settings/site-info'],
    ];

    for (const [path, label] of dashboardSections) {
      await mapSection(`${baseUrl}/${path}`, label);
    }

    // ── Phase 3: Editor ──

    console.log('\n' + '='.repeat(70));
    console.log('PHASE 3: Site Editor');
    console.log('='.repeat(70));

    // The editor URL needs the site's editor ID, which may differ from metaSiteId
    // Try to find it from the dashboard
    const editorPage = await context.newPage();
    const editorLogger = new NetworkLogger('editor-launch');
    await editorLogger.attach(editorPage, context);
    await navigateAndWait(editorPage, `${baseUrl}/home`, 'dashboard (to find editor link)');

    const editorUrl = await editorPage.evaluate(() => {
      const editBtn = document.querySelector('a[href*="editor.wix.com"]');
      return editBtn?.href || null;
    });

    if (editorUrl) {
      await navigateAndWait(editorPage, editorUrl, 'site editor');
      await sleep(5000); // Editor loads a LOT of stuff
    } else {
      console.log('    ⚠ Could not find editor URL from dashboard');
    }

    await editorLogger.detach();
    for (const call of editorLogger.getAPICalls()) {
      allAPICalls.push(call);
      const urlObj = new URL(call.url);
      const path = urlObj.pathname;
      if (!apiEndpoints.has(path)) {
        apiEndpoints.set(path, {
          path, methods: new Set(), statuses: new Set(), sections: new Set(),
          sampleRequestHeaders: null, samplePostData: null, sampleResponse: null,
          queryParams: new Set(), callCount: 0,
        });
      }
      const ep = apiEndpoints.get(path);
      ep.methods.add(call.method);
      ep.statuses.add(call.status);
      ep.sections.add('editor');
      ep.callCount++;
      if (call.status === 200 && !ep.sampleResponse && call.responseBody) {
        ep.sampleResponse = call.responseBody;
        ep.sampleRequestHeaders = call.requestHeaders;
        ep.samplePostData = call.postData;
      }
      for (const [key] of urlObj.searchParams) {
        ep.queryParams.add(key);
      }
    }
    await editorPage.close();
  }

  // ── Compile results ──

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));

  // Convert Sets to arrays for JSON serialization
  const endpointList = [...apiEndpoints.values()]
    .map(ep => ({
      ...ep,
      methods: [...ep.methods],
      statuses: [...ep.statuses],
      sections: [...ep.sections],
      queryParams: [...ep.queryParams],
    }))
    .sort((a, b) => b.callCount - a.callCount);

  // Categorize endpoints
  const categories = {
    'Content (blog/pages/media)': [],
    'Site Config (settings/properties)': [],
    'Auth & Identity': [],
    'Commerce (store/payments)': [],
    'Analytics & Marketing': [],
    'Communication (chat/notifications)': [],
    'Platform (experiments/apps)': [],
    'Other': [],
  };

  for (const ep of endpointList) {
    const p = ep.path.toLowerCase();
    if (p.includes('blog') || p.includes('media') || p.includes('page') || p.includes('content') || p.includes('cms') || p.includes('data-server')) {
      categories['Content (blog/pages/media)'].push(ep);
    } else if (p.includes('site') || p.includes('settings') || p.includes('properties') || p.includes('domain') || p.includes('seo')) {
      categories['Site Config (settings/properties)'].push(ep);
    } else if (p.includes('account') || p.includes('auth') || p.includes('user') || p.includes('member') || p.includes('identity') || p.includes('profile')) {
      categories['Auth & Identity'].push(ep);
    } else if (p.includes('store') || p.includes('product') || p.includes('payment') || p.includes('premium') || p.includes('subscript') || p.includes('ecom')) {
      categories['Commerce (store/payments)'].push(ep);
    } else if (p.includes('analytics') || p.includes('marketing') || p.includes('seo') || p.includes('traffic')) {
      categories['Analytics & Marketing'].push(ep);
    } else if (p.includes('chat') || p.includes('notification') || p.includes('inbox') || p.includes('contact') || p.includes('feed')) {
      categories['Communication (chat/notifications)'].push(ep);
    } else if (p.includes('laboratory') || p.includes('experiment') || p.includes('app') || p.includes('dealer') || p.includes('giza')) {
      categories['Platform (experiments/apps)'].push(ep);
    } else {
      categories['Other'].push(ep);
    }
  }

  // Print summary
  console.log(`\nTotal unique API endpoints: ${endpointList.length}`);
  console.log(`Total API calls logged: ${allAPICalls.length}\n`);

  for (const [cat, eps] of Object.entries(categories)) {
    if (eps.length === 0) continue;
    console.log(`\n── ${cat} (${eps.length} endpoints) ──`);
    for (const ep of eps.slice(0, 15)) {
      const methods = ep.methods.join('/');
      const status = ep.statuses.join(',');
      console.log(`  ${methods.padEnd(6)} [${status}] ${ep.path}`);
      if (ep.queryParams.length) {
        console.log(`         params: ${ep.queryParams.join(', ')}`);
      }
    }
    if (eps.length > 15) console.log(`  ... and ${eps.length - 15} more`);
  }

  // ── Save everything ──

  // 1. Full raw request log
  writeFileSync('output/api-map/raw-requests.json', JSON.stringify(allAPICalls, null, 2));

  // 2. Endpoint catalog (the main deliverable)
  writeFileSync('output/api-map/endpoints.json', JSON.stringify(endpointList, null, 2));

  // 3. Human-readable API map
  let markdown = `# Wix API Map\n\nGenerated: ${new Date().toISOString()}\n\n`;
  markdown += `Total endpoints: ${endpointList.length}\n`;
  markdown += `Total API calls observed: ${allAPICalls.length}\n\n`;

  for (const [cat, eps] of Object.entries(categories)) {
    if (eps.length === 0) continue;
    markdown += `## ${cat}\n\n`;
    markdown += `| Method | Status | Endpoint | Params | Seen In |\n`;
    markdown += `|--------|--------|----------|--------|---------|\n`;
    for (const ep of eps) {
      const methods = ep.methods.join('/');
      const status = ep.statuses.join(',');
      const params = ep.queryParams.join(', ') || '—';
      const sections = ep.sections.join(', ');
      markdown += `| ${methods} | ${status} | \`${ep.path}\` | ${params} | ${sections} |\n`;
    }
    markdown += '\n';
  }

  // Add auth pattern documentation
  markdown += `## Auth Patterns\n\n`;
  markdown += `### Headers observed on successful API calls:\n\n`;
  const authHeaders = new Set();
  for (const ep of endpointList) {
    if (ep.sampleRequestHeaders) {
      for (const key of Object.keys(ep.sampleRequestHeaders)) {
        if (key.toLowerCase().startsWith('x-') || key.toLowerCase() === 'authorization' ||
            key.toLowerCase() === 'commonconfig' || key.toLowerCase() === 'consent-policy') {
          authHeaders.add(key);
        }
      }
    }
  }
  for (const h of [...authHeaders].sort()) {
    markdown += `- \`${h}\`\n`;
  }

  writeFileSync('output/api-map/wix-api-map.md', markdown);

  // 4. Save samples for the most interesting content endpoints
  const contentEndpoints = endpointList.filter(ep =>
    ep.sampleResponse &&
    (ep.path.includes('blog') || ep.path.includes('media') || ep.path.includes('page') ||
     ep.path.includes('site') || ep.path.includes('content') || ep.path.includes('data'))
  );
  writeFileSync('output/api-map/content-endpoint-samples.json',
    JSON.stringify(contentEndpoints.map(ep => ({
      path: ep.path,
      methods: ep.methods,
      queryParams: ep.queryParams,
      sampleResponse: ep.sampleResponse,
      samplePostData: ep.samplePostData,
    })), null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('Files saved:');
  console.log('  output/api-map/raw-requests.json          — full request log');
  console.log('  output/api-map/endpoints.json             — endpoint catalog');
  console.log('  output/api-map/wix-api-map.md             — human-readable map');
  console.log('  output/api-map/content-endpoint-samples.json — content API samples');
  console.log('='.repeat(70));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
