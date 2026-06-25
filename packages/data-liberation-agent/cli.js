#!/usr/bin/env node
/**
 * data-liberation-agent CLI
 *
 * Interactive tool that detects browsers, checks platform logins,
 * and orchestrates the full migration pipeline.
 *
 * Usage:
 *   node cli.js                          # interactive mode
 *   node cli.js https://mysite.wix.com   # skip to extraction
 *   node cli.js --detect                 # just run browser detection
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
// node:sqlite available in Node 22+; graceful fallback for older versions
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const HOME = homedir();
const IS_MAC = platform() === 'darwin';
const IS_LINUX = platform() === 'linux';

// ─── Terminal helpers ────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function log(msg) { console.log(msg); }
function ok(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function warn(msg) { console.log(`${YELLOW}!${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }
function heading(msg) { console.log(`\n${BOLD}${msg}${RESET}\n`); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise(resolve => rl.question(`${CYAN}?${RESET} ${question} `, resolve));
}
function askChoice(question, choices) {
  log(`${CYAN}?${RESET} ${question}`);
  choices.forEach((c, i) => log(`  ${BOLD}${i + 1}${RESET}  ${c.label}`));
  return new Promise(resolve => {
    rl.question(`${DIM}  Enter number: ${RESET}`, answer => {
      const idx = parseInt(answer) - 1;
      resolve(choices[idx] || choices[0]);
    });
  });
}

// ─── Browser detection ───────────────────────────────────────

const BROWSERS = [
  {
    name: 'Google Chrome',
    cdp: true,
    mac: {
      app: '/Applications/Google Chrome.app',
      exe: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      cookies: join(HOME, 'Library/Application Support/Google/Chrome/Default/Cookies'),
      profile: join(HOME, 'Library/Application Support/Google/Chrome'),
    },
    linux: {
      exe: 'google-chrome',
      cookies: join(HOME, '.config/google-chrome/Default/Cookies'),
      profile: join(HOME, '.config/google-chrome'),
    },
  },
  {
    name: 'Microsoft Edge',
    cdp: true,
    mac: {
      app: '/Applications/Microsoft Edge.app',
      exe: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      cookies: join(HOME, 'Library/Application Support/Microsoft Edge/Default/Cookies'),
      profile: join(HOME, 'Library/Application Support/Microsoft Edge'),
    },
    linux: {
      exe: 'microsoft-edge',
      cookies: join(HOME, '.config/microsoft-edge/Default/Cookies'),
      profile: join(HOME, '.config/microsoft-edge'),
    },
  },
  {
    name: 'Brave',
    cdp: true,
    mac: {
      app: '/Applications/Brave Browser.app',
      exe: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      cookies: join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies'),
      profile: join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser'),
    },
    linux: {
      exe: 'brave-browser',
      cookies: join(HOME, '.config/BraveSoftware/Brave-Browser/Default/Cookies'),
      profile: join(HOME, '.config/BraveSoftware/Brave-Browser'),
    },
  },
  {
    name: 'Arc',
    cdp: true,
    mac: {
      app: '/Applications/Arc.app',
      exe: '/Applications/Arc.app/Contents/MacOS/Arc',
      cookies: join(HOME, 'Library/Application Support/Arc/User Data/Default/Cookies'),
      profile: join(HOME, 'Library/Application Support/Arc/User Data'),
    },
    linux: null, // Arc is macOS-only
  },
  {
    name: 'Chromium',
    cdp: true,
    mac: {
      app: '/Applications/Chromium.app',
      exe: '/Applications/Chromium.app/Contents/MacOS/Chromium',
      cookies: join(HOME, 'Library/Application Support/Chromium/Default/Cookies'),
      profile: join(HOME, 'Library/Application Support/Chromium'),
    },
    linux: {
      exe: 'chromium-browser',
      cookies: join(HOME, '.config/chromium/Default/Cookies'),
      profile: join(HOME, '.config/chromium'),
    },
  },
  {
    name: 'Firefox',
    cdp: false,
    mac: { app: '/Applications/Firefox.app' },
    linux: { exe: 'firefox' },
  },
  {
    name: 'Safari',
    cdp: false,
    mac: { app: '/Applications/Safari.app' },
    linux: null,
  },
];

function detectBrowsers() {
  const found = [];
  const plat = IS_MAC ? 'mac' : IS_LINUX ? 'linux' : null;
  if (!plat) return found;

  for (const browser of BROWSERS) {
    const config = browser[plat];
    if (!config) continue;

    let installed = false;
    if (IS_MAC && config.app) {
      installed = existsSync(config.app);
    } else if (IS_LINUX && config.exe) {
      try { execSync(`which ${config.exe}`, { stdio: 'ignore' }); installed = true; } catch {}
    }

    if (installed) {
      found.push({
        name: browser.name,
        cdp: browser.cdp,
        exe: config.exe,
        cookiePath: config.cookies,
        profilePath: config.profile,
      });
    }
  }
  return found;
}

// ─── Cookie checking ─────────────────────────────────────────

// Check if a browser has cookies for a given domain
// We can read the host_key column without decrypting cookie values
function checkCookies(cookiePath, domain) {
  if (!cookiePath || !existsSync(cookiePath)) return { found: false, reason: 'no cookie file' };

  // node:sqlite (Node 22+) — read cookie DB directly
  if (DatabaseSync) {
    try {
      const tmpPath = join(HOME, '.data-liberation-cookies-check.db');
      execSync(`cp "${cookiePath}" "${tmpPath}"`, { stdio: 'ignore' });

      const db = new DatabaseSync(tmpPath);
      const rows = db.prepare(
        `SELECT DISTINCT host_key FROM cookies WHERE host_key LIKE ?`
      ).all(`%${domain}%`);
      db.close();

      try { execSync(`rm "${tmpPath}"`, { stdio: 'ignore' }); } catch {}

      if (rows.length > 0) {
        return { found: true, hosts: rows.map(r => r.host_key) };
      }
      return { found: false, reason: 'no cookies for this domain' };
    } catch (e) {
      return { found: false, reason: e.message };
    }
  }

  // Fallback for Node <22: use sqlite3 CLI if available
  try {
    const tmpPath = join(HOME, '.data-liberation-cookies-check.db');
    execSync(`cp "${cookiePath}" "${tmpPath}"`, { stdio: 'ignore' });

    const result = execSync(
      `sqlite3 "${tmpPath}" "SELECT DISTINCT host_key FROM cookies WHERE host_key LIKE '%${domain}%' LIMIT 5"`,
      { encoding: 'utf8', timeout: 3000 }
    ).trim();

    try { execSync(`rm "${tmpPath}"`, { stdio: 'ignore' }); } catch {}

    if (result) {
      return { found: true, hosts: result.split('\n') };
    }
    return { found: false, reason: 'no cookies for this domain' };
  } catch {
    // sqlite3 not available or DB locked — cookie check is best-effort
    return { found: false, reason: 'could not read cookie database' };
  }
}

// ─── User agent detection ────────────────────────────────────

// Get the real user agent from a running CDP instance (best — gives the real non-headless UA)
async function getBrowserUserAgentViaCDP(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) {
      const data = await res.json();
      return data['User-Agent'] || null;
    }
  } catch {}
  return null;
}

// Fallback: construct the UA from the browser's version string
// (avoids launching headless which leaks "HeadlessChrome" in the UA)
function getBrowserUserAgent(browser) {
  if (!browser.exe) return null;
  try {
    const version = execSync(`"${browser.exe}" --version 2>/dev/null`, {
      encoding: 'utf8', timeout: 5000
    }).trim();
    // e.g. "Google Chrome 146.0.7680.164" or "Brave Browser 146.1.88.136"
    const match = version.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (match) {
      // Construct a standard Chrome UA with the correct version
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${match[1]} Safari/537.36`;
    }
  } catch {}
  return null;
}

// ─── Platform detection ──────────────────────────────────────

function detectPlatform(url) {
  const lower = url.toLowerCase();
  if (lower.includes('wix.com') || lower.includes('wixsite.com')) return 'wix';
  if (lower.includes('squarespace.com')) return 'squarespace';
  if (lower.includes('webflow.io') || lower.includes('webflow.com')) return 'webflow';
  if (lower.includes('shopify.com') || lower.includes('myshopify.com')) return 'shopify';
  return 'unknown';
}

// ─── CDP management ─────────────────────────────────────────

const CDP_PORTS = [9222, 9223, 9224, 9229, 9221];

async function findRunningCDP() {
  for (const port of CDP_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data = await res.json();
        return { port, browser: data.Browser || 'unknown', userAgent: data['User-Agent'] || null };
      }
    } catch {}
  }
  return null;
}

function findFreePort() {
  for (const port of CDP_PORTS) {
    try {
      execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'ignore' });
      // Port is in use, skip
    } catch {
      return port; // lsof failed = port is free
    }
  }
  return 9225; // Fallback
}

// Launch a browser with CDP enabled so we get the user's real cookies and session.
// Returns { port, process, userAgent } or null on failure.
async function launchBrowserWithCDP(browser) {
  if (!browser.exe) return null;

  const port = findFreePort();
  const plat = IS_MAC ? 'mac' : 'linux';

  // Chromium-based browsers need a non-default user-data-dir to accept --remote-debugging-port
  // if they're already running. We symlink to the real profile to keep cookies.
  const profileDir = browser.profilePath;
  const cdpDir = join(HOME, '.data-liberation', 'cdp-profile', browser.name.toLowerCase().replace(/\s+/g, '-'));
  mkdirSync(cdpDir, { recursive: true });

  // Symlink the real profile's Default directory and Local State (for cookie decryption keys)
  if (profileDir) {
    const defaultProfile = join(profileDir, 'Default');
    const localState = join(profileDir, 'Local State');
    const cdpDefault = join(cdpDir, 'Default');
    const cdpLocalState = join(cdpDir, 'Local State');

    if (existsSync(defaultProfile) && !existsSync(cdpDefault)) {
      try { execSync(`ln -s "${defaultProfile}" "${cdpDefault}"`, { stdio: 'ignore' }); } catch {}
    }
    if (existsSync(localState) && !existsSync(cdpLocalState)) {
      try { execSync(`ln -s "${localState}" "${cdpLocalState}"`, { stdio: 'ignore' }); } catch {}
    }
  }

  log(`  Launching ${browser.name} with remote debugging on port ${port}...`);

  const child = spawn(browser.exe, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    `--user-data-dir=${cdpDir}`,
    '--restore-last-session',
  ], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data = await res.json();
        return { port, browser: data.Browser || browser.name, userAgent: data['User-Agent'] || null, pid: child.pid };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }

  warn(`  ${browser.name} launched but CDP not responding after 30s`);
  return null;
}

// ─── Main flow ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const detectOnly = args.includes('--detect');
  const urlArg = args.find(a => a.startsWith('http'));

  // ── Step 1: Browser detection ──

  heading('Browser Detection');

  const browsers = detectBrowsers();
  const cdpBrowsers = browsers.filter(b => b.cdp);

  if (browsers.length === 0) {
    fail('No browsers detected');
    process.exit(1);
  }

  for (const b of browsers) {
    if (b.cdp) {
      ok(`${b.name} ${DIM}(supports remote control via CDP)${RESET}`);
    } else {
      warn(`${b.name} ${DIM}(no CDP support — can't remote control)${RESET}`);
    }
  }

  if (cdpBrowsers.length === 0) {
    fail('No CDP-capable browser found. Install Chrome, Edge, Brave, or Arc.');
    process.exit(1);
  }

  // Check for already-running CDP
  let runningCDP = await findRunningCDP();
  if (runningCDP) {
    ok(`Found running CDP on port ${runningCDP.port}: ${runningCDP.browser}`);
  }

  // ── Step 2: Check platform cookies ──

  heading('Login Detection');

  const platforms = [
    { name: 'Wix', domain: '.wix.com' },
    { name: 'Squarespace', domain: '.squarespace.com' },
    { name: 'Webflow', domain: '.webflow.com' },
    { name: 'Shopify', domain: '.shopify.com' },
    { name: 'WordPress.com', domain: '.wordpress.com' },
  ];

  const loggedIn = {};
  for (const plat of platforms) {
    let found = false;
    let foundIn = null;
    for (const browser of cdpBrowsers) {
      const result = checkCookies(browser.cookiePath, plat.domain);
      if (result.found) {
        found = true;
        foundIn = browser.name;
        break;
      }
    }
    loggedIn[plat.name] = found;
    if (found) {
      ok(`${plat.name} — cookies found in ${foundIn}`);
    } else {
      info(`${plat.name} — not logged in (or cookies expired)`);
    }
  }

  if (detectOnly) {
    rl.close();
    return;
  }

  // ── Step 3: Get site URL ──

  heading('Migration Setup');

  let siteUrl = urlArg;
  if (!siteUrl) {
    siteUrl = await ask('Enter the URL of the site you want to migrate:');
  }

  // Normalize URL
  if (!siteUrl.startsWith('http')) siteUrl = 'https://' + siteUrl;
  siteUrl = siteUrl.replace(/\/$/, '');

  const detectedPlatform = detectPlatform(siteUrl);
  if (detectedPlatform !== 'unknown') {
    ok(`Detected platform: ${BOLD}${detectedPlatform}${RESET}`);
  } else {
    const platChoice = await askChoice('Which platform is this site on?', [
      { label: 'Wix', value: 'wix' },
      { label: 'Squarespace', value: 'squarespace' },
      { label: 'Webflow', value: 'webflow' },
      { label: 'Other / not sure', value: 'unknown' },
    ]);
    // Use first choice as default if detection fails
  }

  const activePlatform = detectedPlatform !== 'unknown' ? detectedPlatform : 'wix';

  // Check if we have scripts for this platform
  if (!existsSync(`scripts/${activePlatform}`)) {
    warn(`No extraction scripts for ${activePlatform} yet.`);
    log(`\n  Currently supported: Wix`);
    log(`  Shopify, Squarespace, Webflow coming soon.`);
    log(`\n  Want to help? See CONTRIBUTING.md for how to add a new platform.\n`);
    rl.close();
    return;
  }

  // Pick which browser to use
  let selectedBrowser = cdpBrowsers[0];
  if (cdpBrowsers.length > 1) {
    // Prefer the one that's logged into the platform
    for (const browser of cdpBrowsers) {
      const cookies = checkCookies(browser.cookiePath, `.${activePlatform}.com`);
      if (cookies.found) {
        selectedBrowser = browser;
        break;
      }
    }
  }
  ok(`Using ${selectedBrowser.name} for extraction`);

  // Ensure we have a CDP connection to the user's real browser (with cookies/session)
  if (!runningCDP) {
    log('');
    info('No browser with remote debugging detected.');
    info(`Launching ${selectedBrowser.name} with CDP enabled...`);
    log(`  ${DIM}(This uses your real browser profile so your login sessions carry over)${RESET}`);
    runningCDP = await launchBrowserWithCDP(selectedBrowser);
    if (runningCDP) {
      ok(`${selectedBrowser.name} ready on port ${runningCDP.port}`);
    } else {
      warn('Could not launch browser with CDP. Falling back to Playwright (no cookies).');
      log(`  ${DIM}You can manually launch your browser with: "${selectedBrowser.exe}" --remote-debugging-port=9222${RESET}`);
    }
  }

  // Get the real user agent from the CDP connection (matches the actual browser)
  let userAgent = runningCDP?.userAgent || null;
  if (!userAgent) {
    userAgent = getBrowserUserAgent(selectedBrowser);
  }
  if (userAgent) {
    ok(`Matched user agent: ${DIM}${userAgent.slice(0, 60)}...${RESET}`);
  } else {
    warn('Could not detect user agent — Playwright will use its default');
  }

  // Pass the CDP port to extraction scripts so they connect to the real browser
  const cdpPort = runningCDP?.port || null;

  // ── Step 4: Run discovery ──

  heading('Step 1: Discovering Site Content');
  log(`Scanning ${siteUrl} for all pages, posts, and media...\n`);

  mkdirSync('output', { recursive: true });

  const uaArgs = userAgent ? ['--user-agent', userAgent] : [];
  const cdpArgs = cdpPort ? ['--cdp-port', String(cdpPort)] : [];
  const discoverResult = await runScript(`scripts/${activePlatform}/discover.js`, [siteUrl, ...uaArgs, ...cdpArgs]);
  if (discoverResult.code !== 0) {
    fail('Discovery failed. See output above.');
    const retry = await ask('Try again? (y/n)');
    if (retry.toLowerCase() !== 'y') { rl.close(); return; }
  }

  // Show inventory summary
  if (existsSync('output/inventory.json')) {
    const inventory = JSON.parse(readFileSync('output/inventory.json', 'utf8'));
    log('');
    heading('Site Inventory');
    for (const [type, count] of Object.entries(inventory.counts || {})) {
      log(`  ${type}: ${BOLD}${count}${RESET}`);
    }
    log(`\n  Total: ${BOLD}${inventory.urls?.length || 0}${RESET} URLs`);
    if (inventory.navigation?.length) {
      log(`  Navigation items: ${inventory.navigation.length}`);
    }
  }

  const proceed = await ask('\nProceed with extraction? (y/n)');
  if (proceed.toLowerCase() !== 'y') {
    log('\nInventory saved to output/inventory.json — review and re-run when ready.');
    rl.close();
    return;
  }

  // ── Step 5: Extract content ──

  heading('Step 2: Extracting Content');
  log(`Extracting all pages, posts, and media from ${siteUrl}...\n`);

  const extractResult = await runScript(`scripts/${activePlatform}/extract.js`, [
    siteUrl,
    '--url-list', 'output/inventory.json',
    ...uaArgs,
    ...cdpArgs
  ]);

  if (extractResult.code !== 0) {
    warn('Extraction completed with errors. Check output/extraction-log.json');
  }

  if (existsSync('output/extraction-log.json')) {
    const extractLog = JSON.parse(readFileSync('output/extraction-log.json', 'utf8'));
    log('');
    ok(`Pages extracted: ${extractLog.processed?.length || 0}`);
    ok(`Media downloaded: ${extractLog.mediaDownloaded?.length || 0}`);
    if (extractLog.failed?.length) {
      warn(`Failures: ${extractLog.failed.length} (see output/extraction-log.json)`);
    }
  }

  // ── Step 6: WordPress.com setup ──

  heading('Step 3: WordPress.com Import');
  log('Your extracted content is in output/. Now we need to import it to WordPress.com.\n');

  log('You need:');
  log(`  1. A WordPress.com account (${BOLD}$4/mo Personal plan${RESET} supports plugins & themes)`);
  log('  2. An Application Password for API access\n');
  log(`  Create one at: ${CYAN}https://wordpress.com/me/security/application-passwords${RESET}\n`);

  const wpSite = await ask('Your WordPress.com site domain (e.g. mysite.wordpress.com):');
  const wpToken = await ask('Application password:');

  if (!wpSite || !wpToken) {
    log('\nSkipping import. Your content is saved in output/');
    log('Run later: node scripts/import.js --site <domain> --token <password>');
    rl.close();
    return;
  }

  // Dry run first
  heading('Import Preview (Dry Run)');
  await runScript('scripts/import.js', [
    '--site', wpSite,
    '--token', wpToken,
    '--dry-run'
  ]);

  const doImport = await ask('\nLooks good? Import for real? (y/n)');
  if (doImport.toLowerCase() !== 'y') {
    log('\nRun later: node scripts/import.js --site ' + wpSite + ' --token <password>');
    rl.close();
    return;
  }

  heading('Importing to WordPress.com');
  await runScript('scripts/import.js', ['--site', wpSite, '--token', wpToken]);

  // ── Done ──

  heading('Migration Complete');
  ok('Content extracted and imported as drafts');
  log('');
  log('Next steps:');
  log(`  1. Review drafts at ${CYAN}https://${wpSite}/wp-admin/${RESET}`);
  log('  2. Publish pages and posts after review');
  log('  3. Set up redirects from output/redirect-map.json');
  log('  4. Update DNS to point your domain to WordPress.com');
  log('');

  if (existsSync('output/extraction-log.json')) {
    const extractLog = JSON.parse(readFileSync('output/extraction-log.json', 'utf8'));
    if (extractLog.failed?.length) {
      warn(`${extractLog.failed.length} items had issues — check output/extraction-log.json`);
    }
  }

  rl.close();
}

// ─── Script runner ───────────────────────────────────────────

function runScript(script, args = []) {
  return new Promise(resolve => {
    const child = spawn('node', [script, ...args], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.on('close', code => resolve({ code }));
    child.on('error', err => {
      fail(`Failed to run ${script}: ${err.message}`);
      resolve({ code: 1 });
    });
  });
}

// ─── Run ─────────────────────────────────────────────────────

main().catch(e => {
  fail(e.message);
  process.exit(1);
});
