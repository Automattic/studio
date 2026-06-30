import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from '../../lib/detect-platform/index.js';
import { ExtractionLog } from '../../lib/resume-state/index.js';
import { WxrBuilder } from '../../lib/wxr/index.js';
import { rehydrateBuilderFromWxr } from '../../lib/wxr/index.js';
import { ImportSession } from '../../lib/resume-state/index.js';
import { classifyUrl } from '../../lib/extraction/sitemap.js';
import type { Handler } from '../handler-types.js';

/**
 * Process one URL through the streaming pipeline. Used by both:
 *   - the watch CLI (in-process; calls per-url-pipeline.processOneUrl directly)
 *   - agent-first orchestration (calls this MCP tool repeatedly)
 *
 * Each call runs adapter.discover() to set up adapter state. For sites with
 * heavy discovery (Shopify GraphQL pagination, etc.) this is per-call slow;
 * a future revision can persist inventory to <outputDir>/inventory.json so
 * subsequent calls reuse it.
 */
export const extractOneHandler: Handler = async (args, ctx) => {
  const url = args.url as string;
  const outputDir = args.outputDir as string;
  const siteUrl = (args.siteUrl as string) || new URL(url).origin;

  if (!url || !outputDir) {
    return ctx.errorResult('liberate_extract_one requires url + outputDir');
  }

  const detection = await detect(siteUrl);
  const adapter = ctx.findAdapter(detection.platform);
  if (!adapter) {
    return ctx.errorResult(`No adapter available for platform: ${detection.platform}`);
  }

  mkdirSync(outputDir, { recursive: true });
  const log = new ExtractionLog(outputDir);
  if (!log.acquireLock()) {
    return ctx.errorResult('Another liberation workflow is already running in this outputDir.');
  }

  try {
    const adapterOpts = {
      token: args.token,
      cdpPort: args.cdpPort,
      adminToken: args.adminToken,
      shopDomain: args.shopDomain,
      delay: args.delay,
      resume: true,
      verbose: args.verbose,
      outputDir,
    };

    // Discover full inventory then narrow to the target URL.
    const inventory = (await adapter.discover(siteUrl, adapterOpts)) as {
      siteMeta?: { title?: string; tagline?: string; language?: string };
      urls?: Array<{ url: string; type: string }>;
      navigation?: Array<{ text: string; href: string }>;
    };

    const target = inventory.urls?.find((u) => u.url === url);
    if (!target) {
      return ctx.errorResult(
        `URL not found in adapter discovery: ${url}. The site may not include this URL in its sitemap or the URL may be off-site.`,
      );
    }

    const wxr = new WxrBuilder({
      title: inventory.siteMeta?.title || 'Imported Site',
      url: siteUrl,
      description: inventory.siteMeta?.tagline || '',
      language: inventory.siteMeta?.language || 'en-US',
    }, { contentStatus: args.contentStatus === 'publish' ? 'publish' : 'draft' });

    const wxrPath = join(outputDir, 'output.wxr');

    // extract-one always appends a single URL to an existing extraction, so
    // rehydrate the builder from any prior WXR before serialize() — otherwise we
    // write only this URL's item and silently truncate the rest (DISCOVERIES.md
    // 2026-04-30). nav_menu_items are regenerated from the current inventory.
    rehydrateBuilderFromWxr(wxr, wxrPath);

    const session = ImportSession.loadOrCreate(outputDir, detection.platform, adapterOpts, { resume: true });

    // Narrowed inventory: just this one URL. Adapter's extract() runs the
    // shared loop with limit-aware behaviour and writes media to disk.
    const narrowedInventory = {
      ...inventory,
      urls: [target],
    };

    const start = Date.now();
    await adapter.extract(narrowedInventory, wxr, adapterOpts, { log, server: ctx.server });
    const durationMs = Date.now() - start;

    // Serialize the WXR. WxrBuilder.openStream doesn't support append-on-resume
    // today; v1 extract-one writes a per-call WXR that the watch CLI is
    // expected to merge if needed. The CLI path uses processOneUrl directly
    // with a shared in-memory builder and avoids this limitation.
    if (wxr.items.length > 0) {
      wxr.serialize(wxrPath);
    }

    const archetype = classifyUrl(url);
    const summary = log.getSummary();
    const lastFailure = summary.failed.find((f) => (f as Record<string, unknown>).url === url);

    return ctx.textResult({
      ok: !lastFailure,
      url,
      archetype,
      durationMs,
      mediaCollected: summary.mediaDownloaded.length,
      failed: lastFailure ? 1 : 0,
      error: lastFailure ? (lastFailure as Record<string, unknown>).error : null,
    });
  } finally {
    log.releaseLock();
  }
};
