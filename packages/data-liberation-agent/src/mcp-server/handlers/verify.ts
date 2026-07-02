import { join } from 'node:path';
import type { Handler } from '../handler-types.js';
import { compactResult } from '../result-compaction.js';

export const verifyHandler: Handler = async (args, ctx) => {
  const { verifyExtraction } = await import('../../lib/verification/verify.js');
  const outputDir = args.outputDir as string;
  const report = await verifyExtraction(outputDir);

  // A media-heavy site can push the stale-CDN buckets + failure lists past the
  // MCP token cap. Cap the genuinely-huge arrays inline and spill the full
  // report to <outputDir>/.verify.json when large. All counts/summary scalars
  // (counts, qualityScores, redirectCount, manualAttentionItems wording) and the
  // *lengths* of staleCdnUrls/buckets are preserved verbatim — callers depend on
  // them. The `*Truncated` markers expose any capping; `fullResultPath` recovers
  // the complete set.
  const compact = compactResult(report as unknown as Record<string, unknown>, {
    arrayFields: [
      'staleCdnUrls',
      'cdnInContentNoLocalCopy',
      'cdnInContentDownloadedNotRewritten',
      'failedUrls',
      'failedMedia',
    ],
    fullResultPath: join(outputDir, '.verify.json'),
  });
  return ctx.textResult(compact);
};
