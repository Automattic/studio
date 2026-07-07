import { join } from 'node:path';
import { detect } from '../../lib/detect-platform/index.js';
import type { Handler } from '../handler-types.js';
import { compactResult } from '../result-compaction.js';

export const discoverHandler: Handler = async (args, ctx) => {
  const detection = await detect(args.url as string);
  const adapter = ctx.findAdapter(detection.platform);
  if (!adapter) {
    return ctx.errorResult(
      `No adapter available for platform: ${detection.platform}. Supported: ${
        ctx.adapters.map((a) => a.id).join(', ') || 'none (install an adapter)'
      }`,
    );
  }
  const opts = {
    token: args.token,
    cdpPort: args.cdpPort,
    verbose: args.verbose,
  };
  const inventory = await adapter.discover(args.url as string, opts);

  const { detectFeatures } = await import('../../lib/features/detect-features.js');
  const inv = inventory as { urls?: Array<{ url: string }> };
  const urls = (inv.urls || []).map((u) => u.url);
  const platformFeatures = detectFeatures(detection.platform, urls, []);

  const result = { ...(inventory as object), platformFeatures } as Record<string, unknown>;

  // A large sitemap (one run had 616 URLs / ~68k chars) overflows the MCP token
  // cap. Cap the `urls` array inline; preserve counts, platformFeatures,
  // navigation, siteMeta verbatim. discover usually has no outputDir, so the
  // full result is only spilled to <outputDir>/.discover.json when one is passed
  // — otherwise arrays are capped inline with a `urlsTruncated` count.
  const outputDir = typeof args.outputDir === 'string' ? (args.outputDir as string) : null;
  return ctx.textResult(
    compactResult(result, {
      arrayFields: ['urls'],
      fullResultPath: outputDir ? join(outputDir, '.discover.json') : null,
    }),
  );
};
