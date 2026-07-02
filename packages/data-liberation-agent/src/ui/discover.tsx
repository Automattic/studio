import React, { useState, useEffect } from 'react';
import { render, useApp, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { createInterface } from 'readline';
import { Header } from './header.js';
import { platformColor, confidenceBadge, pluralize } from './format.js';
import { detect, type FullDetectionResult } from '../lib/detect-platform/index.js';
import { fetchSitemap, classifyUrl } from '../lib/extraction/sitemap.js';
import { WxrBuilder } from '../lib/wxr/index.js';
import { ExtractionLog } from '../lib/resume-state/index.js';
import { godaddyWmAdapter } from '../adapters/godaddy-wm/index.js';
import { hostingerAdapter } from '../adapters/hostinger/index.js';
import { hubspotAdapter } from '../adapters/hubspot/index.js';
import { shopifyAdapter } from '../adapters/shopify/index.js';
import { squarespaceAdapter } from '../adapters/squarespace/index.js';
import { webflowAdapter } from '../adapters/webflow/index.js';
import { weeblyAdapter } from '../adapters/weebly/index.js';
import { wixAdapter, type Inventory } from '../adapters/wix/index.js';
import { defaultAdapter } from '../adapters/default/index.js';
import { resolveAdapter } from '../adapters/resolve-adapter.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { autoPreview } from './preview.js';
import { siteOutputDir, resolveOutputBase } from '../lib/paths.js';

export interface LiberateProps {
  url: string;
  outputDir: string;
  dryRun: boolean;
  resume: boolean;
  delay: number;
  verbose: boolean;
  token: string | null;
  cdpPort: number | null;
  adminToken: string | null;
  shopDomain: string | null;
  nonInteractive: boolean;
  /** Cap extraction at the first N URLs (writes a real WXR for those N). */
  limit: number | null;
  /** Capture screenshots post-extract. Results go to output/<site>/screenshots/. */
  screenshots: boolean;
  /** Concurrency for the screenshot capture loop. Default 3. */
  screenshotsConcurrency?: number;
}

type Phase =
  | 'detecting'
  | 'discovering'
  | 'discovered'
  | 'extracting'
  | 'screenshotting'
  | 'done'
  | 'error';

interface ScreenshotSummary {
  captured: number;
  skipped: number;
  failed: number;
}

interface ExtractionProgress {
  current: number;
  total: number;
  currentUrl: string;
}

interface ExtractionResult {
  pagesExtracted: number;
  postsExtracted: number;
  mediaDownloaded: number;
  productsExtracted: number;
  failed: number;
  wxrPath: string | null;
}

const adapters = [defaultAdapter, godaddyWmAdapter, hostingerAdapter, hubspotAdapter, shopifyAdapter, squarespaceAdapter, webflowAdapter, weeblyAdapter, wixAdapter];

function findAdapter(platform: string) {
  return resolveAdapter(adapters, platform);
}


function Liberate(props: LiberateProps & { onComplete?: (wxrPath: string | null) => void }) {
  const { url, outputDir, dryRun, resume, delay, verbose, token, cdpPort, adminToken, shopDomain, limit, screenshots, screenshotsConcurrency, onComplete } = props;
  const app = useApp();
  const [phase, setPhase] = useState<Phase>('detecting');
  const [detection, setDetection] = useState<FullDetectionResult | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<ExtractionProgress>({ current: 0, total: 0, currentUrl: '' });
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [actualOutputDir, setActualOutputDir] = useState<string>(outputDir);
  const [error, setError] = useState<string>('');
  const [screenshotSummary, setScreenshotSummary] = useState<ScreenshotSummary | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // If resuming and extraction already completed, skip straight to import prompt
        if (resume) {
          const siteDir = siteOutputDir(outputDir, url);
          const completePath = join(siteDir, '.discovery-complete');
          if (existsSync(completePath)) {
            const wxrPath = join(siteDir, 'output.wxr');
            const { readWxr } = await import('../lib/wxr/index.js');
            const wxrData = readWxr(wxrPath);
            setActualOutputDir(siteDir);
            const jsonlPath = join(siteDir, 'products.jsonl');
            const productCount = existsSync(jsonlPath)
              ? readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).length
              : 0;
            setResult({
              pagesExtracted: wxrData.items.filter((i) => i.type === 'page').length,
              postsExtracted: wxrData.items.filter((i) => i.type === 'post').length,
              mediaDownloaded: wxrData.items.filter((i) => i.type === 'attachment').length,
              productsExtracted: productCount,
              failed: 0,
              wxrPath,
            });
            setPhase('done');
            return;
          }
        }

        // Phase 1: Detect
        const det = await detect(url);
        setDetection(det);

        // Find adapter (falls back to the `default` adapter for unknown sites)
        const adapter = resolveAdapter(adapters, det.platform);

        if (!adapter) {
          // No adapter — fall back to sitemap-only discovery
          setPhase('discovering');
          const found = await fetchSitemap(url);
          const c: Record<string, number> = {};
          for (const u of found) {
            c[classifyUrl(u)] = (c[classifyUrl(u)] || 0) + 1;
          }
          setCounts(c);
          setPhase('discovered');
          setError(
            det.platform === 'unknown'
              ? 'Unknown platform — no adapter available'
              : `No adapter for ${det.platform} yet`
          );
          return;
        }

        // Phase 2: Discover via adapter
        setPhase('discovering');
        const opts = {
          cdpPort: cdpPort ?? undefined,
          token: token ?? undefined,
          adminToken: adminToken ?? undefined,
          shopDomain: shopDomain ?? undefined,
          delay,
          verbose,
          limit: limit ?? undefined,
        };
        const inv = await adapter.discover(url, opts) as Inventory;
        setInventory(inv);
        setCounts(inv.counts);

        // Phase 3: Extract
        setPhase('extracting');
        const siteDir = siteOutputDir(outputDir, url);
        setActualOutputDir(siteDir);
        mkdirSync(siteDir, { recursive: true });
        const log = new ExtractionLog(siteDir);
        if (!log.acquireLock()) {
          setError('Extraction already in progress in this directory.');
          setPhase('error');
          return;
        }

        try {
          const wxr = new WxrBuilder({
            title: inv.siteMeta?.title || 'Imported Site',
            url,
            description: inv.siteMeta?.tagline || '',
            language: inv.siteMeta?.language || 'en-US',
          });

          // Set up a fake server context that captures progress for the UI.
          // Effective cap mirrors shared.ts: explicit `limit` wins over
          // dryRun's implicit 3-URL cap; otherwise process all inventory URLs.
          const cap = limit ?? (dryRun ? 3 : inv.urls.length);
          const total = Math.min(cap, inv.urls.length);
          setProgress({ current: 0, total, currentUrl: '' });
          let progressCount = 0;

          const fakeServer = {
            sendLoggingMessage: (msg: { level: string; data: string }) => {
              const match = msg.data.match(/^\[(\d+)\/(\d+)\]\s+(.*)/);
              if (match) {
                progressCount++;
                setProgress({
                  current: parseInt(match[1], 10),
                  total: parseInt(match[2], 10),
                  currentUrl: match[3],
                });
              }
            },
          };

          const wxrPath = join(siteDir, 'output.wxr');
          if (!dryRun && !resume) {
            wxr.openStream(wxrPath);
          }

          const extractResult = await adapter.extract(inv, wxr, {
            ...opts,
            resume,
            dryRun,
            outputDir: siteDir,
          }, {
            log,
            server: fakeServer as any,
          });

          if (!dryRun && !resume) {
            wxr.closeStream();
          } else if (!dryRun && resume && wxr.items.length > 0) {
            wxr.serialize(wxrPath);
          }

          // Optional screenshot capture — mirrors the MCP path. Results land
          // in siteDir/screenshots/ with a manifest.json keyed by URL; any
          // cross-referencing against output.wxr / products.jsonl happens on
          // the filesystem (no WordPress-side injection).
          if (screenshots && !dryRun) {
            const { ImportSession } = await import('../lib/resume-state/index.js');
            // resume:true — we're continuing the same run the adapter just ran,
            // not starting a new one. Preserves the session.json the adapter
            // persisted so post-run status reflects actual extraction state.
            const session = ImportSession.loadOrCreate(siteDir, det.platform, opts, { resume: true });
            session.setStage('screenshotting');
            setPhase('screenshotting');
            const processedUrls = Array.from(log.getProcessedUrls());
            const { captureScreenshots } = await import('../lib/screenshot/screenshotter.js');
            const shotResult = await captureScreenshots({
              urls: processedUrls,
              outputDir: siteDir,
              primaryUrl: url,
              concurrency: screenshotsConcurrency,
            });
            setScreenshotSummary({
              captured: shotResult.captured,
              skipped: shotResult.skipped,
              failed: shotResult.failed,
            });
            session.setStage('finalizing');
          }

          const summary = log.getSummary();
          if (!dryRun) {
            writeFileSync(join(siteDir, '.discovery-complete'), new Date().toISOString(), 'utf8');
            const { readWxr } = await import('../lib/wxr/index.js');
            const wxrData = readWxr(wxrPath);
            setResult({
              pagesExtracted: wxrData.items.filter((i) => i.type === 'page').length,
              postsExtracted: wxrData.items.filter((i) => i.type === 'post').length,
              mediaDownloaded: wxrData.items.filter((i) => i.type === 'attachment').length,
              productsExtracted: (extractResult as any)?.productsExtracted ?? 0,
              failed: summary.failed.length,
              wxrPath,
            });
          } else {
            setResult({
              pagesExtracted: wxr.items.filter((i) => i.type === 'page').length,
              postsExtracted: wxr.items.filter((i) => i.type === 'post').length,
              mediaDownloaded: wxr.items.filter((i) => i.type === 'attachment').length,
              productsExtracted: (extractResult as any)?.productsExtracted ?? 0,
              failed: summary.failed.length,
              wxrPath: null,
            });
          }
          setPhase('done');
        } finally {
          log.releaseLock();
        }
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, [url]);

  // Exit after rendering the final state so the caller can proceed
  useEffect(() => {
    if (phase === 'done' || phase === 'error' || phase === 'discovered') {
      const timer = setTimeout(() => {
        onComplete?.(result?.wxrPath ?? null);
        app.exit();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header subtitle={url} />

      {/* Detection */}
      <Box>
        {phase === 'detecting' ? (
          <>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text> Detecting platform...</Text>
          </>
        ) : detection ? (
          <>
            <Text color="green">✓</Text>
            <Text> Platform: </Text>
            <Text bold color={platformColor(detection.platform)}>
              {detection.platform === 'unknown' ? 'Unknown' : detection.platform}
            </Text>
            <Text dimColor> {confidenceBadge(detection.confidence)} {detection.confidence}</Text>
            {detection.signals.length > 0 && (
              <Text dimColor> ({detection.signals[0]})</Text>
            )}
          </>
        ) : null}
      </Box>

      {/* Discovery */}
      {phase !== 'detecting' && (
        <Box>
          {phase === 'discovering' ? (
            <>
              <Text color="yellow"><Spinner type="dots" /></Text>
              <Text> Discovering content...</Text>
            </>
          ) : Object.keys(counts).length > 0 ? (
            <>
              <Text color="green">✓</Text>
              <Text> Found </Text>
              <Text bold>{Object.values(counts).reduce((a, b) => a + b, 0)}</Text>
              <Text> URLs</Text>
            </>
          ) : null}
        </Box>
      )}

      {/* Content breakdown */}
      {Object.keys(counts).length > 0 && phase !== 'discovering' && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <Box key={type}>
                <Text dimColor>{String(count).padStart(4)} </Text>
                <Text>{pluralize(type, count)}</Text>
              </Box>
            ))}
        </Box>
      )}

      {/* Extraction progress */}
      {phase === 'extracting' && (
        <Box marginTop={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Extracting </Text>
          <Text bold>{progress.current}</Text>
          <Text>/{progress.total}</Text>
          {progress.currentUrl && (
            <Text dimColor> {progress.currentUrl.length > 50 ? '...' + progress.currentUrl.slice(-47) : progress.currentUrl}</Text>
          )}
        </Box>
      )}

      {/* Screenshotting */}
      {phase === 'screenshotting' && (
        <Box marginTop={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text> Capturing screenshots...</Text>
        </Box>
      )}

      {/* Results */}
      {phase === 'done' && result && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="green">✓</Text>
            <Text> Extraction complete{dryRun ? ' (dry run)' : ''}</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2} marginTop={1}>
            <Text><Text dimColor>{String(result.pagesExtracted).padStart(4)} </Text>pages</Text>
            <Text><Text dimColor>{String(result.postsExtracted).padStart(4)} </Text>posts</Text>
            <Text><Text dimColor>{String(result.mediaDownloaded).padStart(4)} </Text>media files</Text>
            {result.productsExtracted > 0 && (
              <Text><Text dimColor>{String(result.productsExtracted).padStart(4)} </Text>products</Text>
            )}
            {result.failed > 0 && (
              <Text color="red"><Text dimColor>{String(result.failed).padStart(4)} </Text>failed</Text>
            )}
          </Box>
          {screenshotSummary && (
            <Box marginTop={1}>
              <Text color="green">✓</Text>
              <Text> Screenshots: </Text>
              <Text bold>{screenshotSummary.captured}</Text>
              <Text dimColor> captured</Text>
              {screenshotSummary.skipped > 0 && (
                <Text dimColor>, {screenshotSummary.skipped} skipped</Text>
              )}
              {screenshotSummary.failed > 0 && (
                <Text color="red">, {screenshotSummary.failed} failed</Text>
              )}
            </Box>
          )}
          {result.wxrPath && (
            <Box marginTop={1}>
              <Text dimColor>WXR: {result.wxrPath}</Text>
            </Box>
          )}
          <Box marginTop={0}>
            <Text dimColor>Output: {actualOutputDir}</Text>
          </Box>
        </Box>
      )}

      {/* Import prompt handled by runDiscover after component exits */}

      {/* No adapter — discovery-only result */}
      {phase === 'discovered' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">! {error}</Text>
          <Text dimColor>Supported: GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix.</Text>
        </Box>
      )}

      {/* Unknown platform warning */}
      {phase === 'done' && detection?.platform === 'unknown' && (
        <Box marginTop={1}>
          <Text color="yellow">! Supported platforms: GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix</Text>
        </Box>
      )}

      {/* Error */}
      {phase === 'error' && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  );
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function runDiscover(url: string, opts: Partial<LiberateProps> = {}): void {
  let wxrPath: string | null = null;

  const props: LiberateProps = {
    url,
    outputDir: opts.outputDir || resolveOutputBase(),
    dryRun: opts.dryRun || false,
    resume: opts.resume || false,
    delay: opts.delay || 500,
    verbose: opts.verbose || false,
    token: opts.token || null,
    cdpPort: opts.cdpPort || null,
    adminToken: opts.adminToken || null,
    shopDomain: opts.shopDomain || null,
    nonInteractive: opts.nonInteractive || false,
    limit: opts.limit ?? null,
    screenshots: opts.screenshots || false,
    screenshotsConcurrency: opts.screenshotsConcurrency,
  };
  const { waitUntilExit } = render(
    <Liberate {...props} onComplete={(path) => { wxrPath = path; }} />,
  );
  waitUntilExit()
    .then(async () => {
      if (!wxrPath) return;
      // Post-extract: always boot a local Studio site so the user can verify
      // content before importing anywhere real. autoPreview honors
      // nonInteractive internally — it still boots the site but skips
      // browser/app auto-open so scripts get a URL.
      const outputDir = dirname(wxrPath);
      await autoPreview(outputDir, { nonInteractive: props.nonInteractive });
      if (props.nonInteractive) return;
      const answer = await ask('\nReady to import to WordPress? (y/N) ');
      if (answer.toLowerCase() !== 'y') {
        console.log('\n  Import to WordPress later with:\n');
        console.log(`  npm run liberate -- import ${wxrPath} \\`);
        console.log('    --site <your-site.com> --username <user> --token <app-password>');
        console.log('');
        console.log('  (Use --import-authors to create WordPress users for each author,');
        console.log('   or omit to assign all content to the authenticated user.)');
        console.log('');
        return;
      }

      const hasSite = await ask('Do you already have a WordPress site? (y/N) ');
      if (hasSite.toLowerCase() !== 'y') {
        console.log('\n  To import, you need a WordPress site. Here\'s how to get started:\n');
        console.log('  1. Create a WordPress site (wordpress.com, self-hosted, or WordPress Studio for local development)');
        console.log('  2. Create an Application Password at WordPress Admin > Users > Profile > Application Passwords');
        console.log('     (WordPress.com / wpcomstaging.com sites: generate it from the site\'s own wp-admin, NOT wordpress.com/me/security)');
        console.log('  3. Save the generated token\n');
        console.log('  Once you have your site, username, and application password, continue below.\n');
      }

      const site = await ask('WordPress site domain (e.g. mysite.com or localhost:8881): ');
      if (!site) { console.log('Skipping import.'); return; }

      const username = await ask('WordPress username: ');
      if (!username) { console.log('Skipping import.'); return; }

      let token = process.env.WP_APP_PASSWORD || '';
      if (!token) {
        token = await ask('Application password (or set WP_APP_PASSWORD): ');
      } else {
        console.log('Using WP_APP_PASSWORD from environment.');
      }
      if (!token) { console.log('Skipping import.'); return; }

      // Validate the connection before importing
      console.log('\nValidating WordPress connection...');
      const { validateWpConnection } = await import('../lib/setup/wp-setup.js');
      const report = await validateWpConnection({ site, username, token });

      if (!report.authenticated) {
        console.log('');
        for (const err of report.errors) console.log(`  ✗ ${err}`);
        if (report.guidance.length > 0) {
          console.log('\n  How to fix:');
          for (const g of report.guidance) console.log(`    - ${g}`);
        }
        console.log('');
        const retry = await ask('Try again with different credentials? (y/N) ');
        if (retry.toLowerCase() !== 'y') { console.log('Skipping import.'); return; }

        const site2 = await ask('WordPress site domain: ');
        const username2 = await ask('WordPress username: ');
        const token2 = await ask('Application password: ');
        if (!site2 || !username2 || !token2) { console.log('Skipping import.'); return; }

        const report2 = await validateWpConnection({ site: site2, username: username2, token: token2 });
        if (!report2.authenticated) {
          for (const err of report2.errors) console.log(`  ✗ ${err}`);
          console.log('\nImport aborted. Run `data-liberation setup` to troubleshoot.');
          return;
        }
        console.log(`  ✓ Connected to ${report2.siteName || site2} as ${report2.userName}`);

        const authorsAnswer2 = await ask('Import original authors as WordPress users? If no, all content will be owned by you. (y/N) ');

        const { runImport } = await import('./import.js');
        runImport({ wxrFile: wxrPath, site: site2, username: username2, token: token2, dryRun: false, delay: 500, verbose: false, only: null, importAuthors: authorsAnswer2.toLowerCase() === 'y' });
        return;
      }

      console.log(`  ✓ Connected to ${report.siteName || site} as ${report.userName}\n`);

      const authorsAnswer = await ask('Import original authors as WordPress users? If no, all content will be owned by you. (y/N) ');
      const importAuthors = authorsAnswer.toLowerCase() === 'y';

      const { runImport } = await import('./import.js');
      runImport({
        wxrFile: wxrPath,
        site: report.siteUrl || site,
        username,
        token,
        dryRun: false,
        delay: 500,
        verbose: false,
        only: null,
        importAuthors,
      });
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
