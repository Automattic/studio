#!/usr/bin/env node
// src/cli.ts
import { join } from 'node:path';
import { resolveOutputBase } from './lib/paths.js';

const args = process.argv.slice(2);

function getArg(name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const val = args[i + 1];
  if (val === undefined || val.startsWith('--')) return null;
  return val;
}

if (args[0] === 'mcp') {
  await import('./mcp-server.js');
} else if (args[0] === '--version') {
  console.log('0.1.0');
} else if (args[0] === '--help' || args.length === 0) {
  console.log(`
  data-liberation — Extract content from closed web platforms into WXR files

  Usage:
    data-liberation <url>              Extract content from a website
    data-liberation inspect <url>      Inspect a site before extraction
    data-liberation import <wxr-file>  Import WXR file to WordPress
    data-liberation qa <wxr-file>        Compare WXR against source site
    data-liberation verify <output-dir>  Verify extraction results
    data-liberation setup                Validate WordPress connection
    data-liberation preview <outputDir>  Preview extraction in Studio
    data-liberation screenshot <url>   Capture screenshots of every URL
    data-liberation design-foundation <outputDir>  Build/validate design-foundation.json (agent fallback)
    data-liberation mcp                Start MCP server (stdio transport)
    data-liberation --version          Show version

  Extract options:
    --output <dir>       Output directory (default: <Studio root>/_liberations/<hostname>; override with --output or DLA_OUTPUT_DIR)
    --dry-run            Extract 2-3 pages and report without writing WXR
    --limit <N>          Cap extraction to the first N URLs (writes a real WXR)
    --resume             Resume a previous extraction
    --token <token>      API token for platforms requiring auth (Webflow)
    --delay <ms>         Delay between requests (default: 500)
    --verbose            Detailed extraction logging
    --non-interactive    Skip the post-extraction import prompt
    --admin-token <tok>  Shopify Admin API token — enables richer product extraction
                         via GraphQL (compareAtPrice, unitCost, inventoryPolicy, etc.)
    --shop-domain <host> Shopify myshopify.com hostname — usually auto-detected
    --no-screenshots               Skip screenshots (default: screenshots are captured after extract)
    --screenshots-concurrency <N>  Parallel screenshot captures (default 6, max 10)
                         (writes output/<site>/screenshots/ with a manifest.json keyed by URL)
    --no-html-first                Use the legacy AI-recompose path. DEFAULT is html-first design
                         capture: accumulates site.css + design sidecars during the screenshot pass,
                         assembles a blank theme at run-end, and skips the slow recompose agent judgments.
    --include-scripts              Carry the source's first-party JavaScript into site.js.
                         Use only for sites you own or trust.

  Streaming options (default behavior):
    --no-watch           Run the legacy batch pipeline instead of the streaming watch loop
    --agent <name>       Agent CLI to invoke for AI judgments (claude / codex / gemini / ...)
    --no-agent           Run deterministic-only — no AI invocations, judgmentNeeded markers
                         accumulate in <outputDir>/<site>/watch.log for later resolution
    --reset              Wipe streaming state (replicate-state.json + block-transform-log.jsonl
                         + composed/) before starting

  Import options:
    --site <domain>       WordPress site domain
    --username <user>     WordPress username
    --token <token>       Application password (or WP_APP_PASSWORD env var)
    --dry-run             Preview without importing
    --delay <ms>          Delay between requests (default: 500)
    --verbose             Detailed logging
    --only <type>         Only import specific type (categories, tags, media, pages, posts, comments, menus)
    --import-authors      Create WordPress users for authors (default: all content owned by you)

  Preview options:
    --open               Open the preview URL in the default browser
    --port <n>           Override the auto-picked port (9400-9499)
    --non-interactive    Skip the post-preview import nudge

  Screenshot options:
    --output <dir>         Output directory (default: <Studio root>/_liberations/<hostname>; override with --output or DLA_OUTPUT_DIR)
    --types <list>         Comma-separated: page,post,product,homepage,gallery,event
    --limit <N>            Cap to first N URLs
    --concurrency <N>      Parallel captures (default 6, max 10)
    --browser-restart-every <N>  Close+relaunch browser every N URLs (default 100)
    --cdp-port <n>         Connect to existing Chrome via CDP
    --force                Re-capture even if files already exist
    --urls-file <path>     Read URLs from file (one per line)
    --non-interactive      Skip preflight prompt
    --verbose              Per-URL progress

  Design-foundation options (non-agent fallback; happy path is agent-driven via MCP):
    --origin <url>       Origin URL stored in the foundation (default: unknown)
    --validate           Validate design-foundation.json against the schema + skillTodos
    --render-md          Regenerate design-foundation.md from design-foundation.json
    --force              Overwrite existing design-foundation.json

  Environment:
    LIBERATION_TOKEN     API token (alternative to --token flag for extraction)
    SHOPIFY_ADMIN_TOKEN  Shopify Admin API token (alternative to --admin-token)
    WP_APP_PASSWORD      WordPress application password (alternative to --token for import)
    DLA_AGENT_CLI        Default agent CLI for streaming (--agent overrides; "none"/"off"/"skip" = NO_AGENT)
`);
} else if (args[0] === 'inspect') {
  const url = args[1];
  if (!url || url.startsWith('-')) {
    console.error('Error: URL required. Usage: data-liberation inspect <url>');
    process.exit(1);
  }

  const token = args.includes('--token') ? args[args.indexOf('--token') + 1] : process.env.LIBERATION_TOKEN || null;

  const { runInspect } = await import('./ui/inspect.js');
  runInspect(url, { token });

} else if (args[0] === 'qa') {
  const wxrFile = args[1] || getArg('--wxr');
  if (!wxrFile || wxrFile.startsWith('-')) {
    console.error('Error: WXR file path required. Usage: data-liberation qa <wxr-file> [--fix]');
    process.exit(1);
  }
  const fix = args.includes('--fix');

  const { runQaUi } = await import('./ui/qa.js');
  runQaUi({ wxrFile, fix });

} else if (args[0] === 'verify') {
  const outputDir = args[1] || getArg('--output') || resolveOutputBase();
  if (outputDir.startsWith('-')) {
    console.error('Error: output directory required. Usage: data-liberation verify <output-dir>');
    process.exit(1);
  }

  const { runVerify } = await import('./ui/verify.js');
  runVerify(outputDir);

} else if (args[0] === 'setup') {
  const site = getArg('--site');
  const username = getArg('--username');
  const token = getArg('--token') || process.env.WP_APP_PASSWORD || null;

  const { runSetup } = await import('./ui/setup.js');
  runSetup({ site: site ?? undefined, username: username ?? undefined, token: token ?? undefined });

} else if (args[0] === 'preview') {
  const outputDir = args[1];
  if (!outputDir || outputDir.startsWith('-')) {
    console.error('Error: outputDir required. Usage: data-liberation preview <outputDir> [--open] [--port <n>] [--non-interactive]');
    process.exit(1);
  }
  const open = args.includes('--open');
  const portArg = getArg('--port');
  const port = portArg ? Number(portArg) : undefined;
  const nonInteractive = args.includes('--non-interactive') || !process.stdout.isTTY;

  const { runCliPreview } = await import('./ui/preview.js');
  await runCliPreview({ outputDir, open, port, nonInteractive });

} else if (args[0] === 'screenshot') {
  const url = args[1];
  if (!url || url.startsWith('-')) {
    console.error('Error: URL required. Usage: data-liberation screenshot <url> [options]');
    process.exit(1);
  }
  let output: string;
  const outputArg = getArg('--output');
  if (outputArg) {
    output = outputArg;
  } else {
    try {
      output = join(resolveOutputBase(), new URL(url).hostname);
    } catch {
      console.error(`Error: invalid URL: ${url}`);
      process.exit(1);
    }
  }
  const typesArg = getArg('--types');
  const types = typesArg ? typesArg.split(',').map((t) => t.trim()) : undefined;
  const limitArg = getArg('--limit');
  const limit = limitArg ? Number(limitArg) : undefined;
  const concurrencyArg = getArg('--concurrency');
  const concurrency = concurrencyArg ? Number(concurrencyArg) : undefined;
  const restartArg = getArg('--browser-restart-every');
  const browserRestartEvery = restartArg ? Number(restartArg) : undefined;
  const cdpPortArg = getArg('--cdp-port');
  const cdpPort = cdpPortArg ? Number(cdpPortArg) : undefined;
  const force = args.includes('--force');
  const verbose = args.includes('--verbose');
  const urlsFile = getArg('--urls-file');
  const nonInteractive = args.includes('--non-interactive') || !process.stdout.isTTY;

  const { runScreenshotCli } = await import('./ui/screenshot-runner.js');
  await runScreenshotCli({
    url, output: output!, types, limit, concurrency, browserRestartEvery, cdpPort, force, verbose, urlsFile, nonInteractive,
  });

} else if (args[0] === 'compare') {
  // TODO: expose --viewports / --diff-output-dir flags (the MCP handler already supports them).
  const originDir = args[1];
  const replicaDir = args[2];
  if (!originDir || !replicaDir || originDir.startsWith('-') || replicaDir.startsWith('-')) {
    console.error('Error: usage: data-liberation compare <originScreenshotsDir> <replicaScreenshotsDir>');
    process.exit(1);
  }
  const { compareScreenshotDirs } = await import('./lib/screenshot/compare.js');
  const result = await compareScreenshotDirs({ originDir, replicaDir });
  for (const r of result.results) {
    console.log(`${r.pathname}  desktop=${r.desktop.score?.toFixed(3) ?? r.desktop.status}  mobile=${r.mobile.score?.toFixed(3) ?? r.mobile.status}`);
  }
  console.log(`\nWrote ${join(replicaDir, 'comparison.json')}`);

} else if (args[0] === 'freeze-spike') {
  const originUrl = getArg('--origin-url');
  const replicaBaseUrl = getArg('--replica-base-url');
  const output = getArg('--output');
  if (!originUrl || !replicaBaseUrl || !output) {
    console.error('Error: usage: data-liberation freeze-spike --origin-url <url> --replica-base-url <url> --output <dir>');
    process.exit(1);
  }
  const { runFreezeSpike } = await import('./ui/spike-runner.js');
  await runFreezeSpike({ originUrl, replicaBaseUrl, outputDir: output });

} else if (args[0] === 'design-foundation') {
  const outputDir = args[1];
  if (!outputDir || outputDir.startsWith('-')) {
    console.error('Error: outputDir required. Usage: data-liberation design-foundation <outputDir> [--validate] [--render-md] [--force]');
    process.exit(1);
  }
  const validate = args.includes('--validate');
  const renderMd = args.includes('--render-md');
  const force = args.includes('--force');
  const verbose = args.includes('--verbose');
  const origin = getArg('--origin') ?? undefined;

  const { runDesignFoundationCliFromArgs } = await import('./ui/design-foundation-runner.js');
  await runDesignFoundationCliFromArgs({ outputDir, origin, validate, renderMd, force, verbose });

} else if (args[0] === 'import') {
  const wxrFile = args[1];
  if (!wxrFile || wxrFile.startsWith('-')) {
    console.error('Error: WXR file path required. Run with --help for usage.');
    process.exit(1);
  }

  const site = getArg('--site');
  const username = getArg('--username');
  const token = getArg('--token') || process.env.WP_APP_PASSWORD || null;
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const rawDelay = getArg('--delay') ? parseInt(getArg('--delay')!, 10) : 500;
  const delay = Number.isNaN(rawDelay) ? 500 : rawDelay;
  const only = getArg('--only');
  const importAuthors = args.includes('--import-authors');

  if (!site) {
    console.error('Error: --site is required. Run with --help for usage.');
    process.exit(1);
  }
  if (!username) {
    console.error('Error: --username is required. Run with --help for usage.');
    process.exit(1);
  }
  if (!token) {
    console.error('Error: --token or WP_APP_PASSWORD env var is required. Run with --help for usage.');
    process.exit(1);
  }

  const { runImport } = await import('./ui/import.js');
  runImport({ wxrFile, site: site as string, username: username as string, token: token as string, dryRun, delay, verbose, only, importAuthors });
} else {
  const url = args.find((a: string) => !a.startsWith('-'));
  if (!url) {
    console.error('Error: URL required. Run with --help for usage.');
    process.exit(1);
  }

  const outputDir = getArg('--output') || resolveOutputBase();
  process.stderr.write(`[output] base: ${outputDir}\n`);
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');
  const verbose = args.includes('--verbose');
  const rawDelay = getArg('--delay') ? parseInt(getArg('--delay')!, 10) : 500;
  const delay = Number.isNaN(rawDelay) ? 500 : rawDelay;
  const rawLimit = getArg('--limit') ? parseInt(getArg('--limit')!, 10) : null;
  const limit = rawLimit !== null && !Number.isNaN(rawLimit) ? rawLimit : null;
  const token = getArg('--token') || process.env.LIBERATION_TOKEN || null;
  const cdpPort = getArg('--cdp-port') ? parseInt(getArg('--cdp-port')!, 10) : null;
  const adminToken = getArg('--admin-token') || process.env.SHOPIFY_ADMIN_TOKEN || null;
  const shopDomain = getArg('--shop-domain') || null;
  const nonInteractive = args.includes('--non-interactive');
  // Screenshots are on by default. Pass --no-screenshots to skip them.
  const screenshots = !args.includes('--no-screenshots');
  const rawSsConcurrency = getArg('--screenshots-concurrency') ? parseInt(getArg('--screenshots-concurrency')!, 10) : null;
  const screenshotsConcurrency = rawSsConcurrency !== null && !Number.isNaN(rawSsConcurrency) ? rawSsConcurrency : undefined;
  // html-first design capture is the DEFAULT — it replaces the AI-recompose
  // path (per the design decision). --no-html-first falls back to the legacy
  // recompose path as a safety valve.
  const captureDesign = !args.includes('--no-html-first');
  const includeScripts = args.includes('--include-scripts');
  if (includeScripts) {
    process.stderr.write('[design] --include-scripts: carrying the source\'s FIRST-PARTY JavaScript. Use only for sites you own or trust.\n');
  }

  // Streaming flags.
  const noWatch = args.includes('--no-watch');
  const reset = args.includes('--reset');
  const noAgent = args.includes('--no-agent');
  const agentArg = getArg('--agent');

  if (!noWatch) {
    // Streaming path (default). Resolves agent from --agent | DLA_AGENT_CLI |
    // TUI prompt | NO_AGENT fallback. Deterministic-only when no agent is set.
    const { renderWatch } = await import('./ui/watch.js');
    const { NO_AGENT } = await import('./cli/agent-invoker.js');
    const agent = noAgent
      ? NO_AGENT
      : (agentArg ?? null);
    const result = await renderWatch({
      url,
      outputDir,
      agent,
      reset,
      resume,
      verbose,
      delay,
      limit,
      token,
      cdpPort,
      adminToken,
      shopDomain,
      nonInteractive,
      captureDesign,
      includeScripts,
    });
    process.exit(result.ok ? 0 : 1);
  } else {
    // Legacy batch path. Pre-streaming behavior: discover → extract → screenshot.
    const { runDiscover } = await import('./ui/discover.js');
    runDiscover(url, { outputDir, dryRun, resume, verbose, delay, limit, token, cdpPort, adminToken, shopDomain, nonInteractive, screenshots, screenshotsConcurrency });
  }
}
