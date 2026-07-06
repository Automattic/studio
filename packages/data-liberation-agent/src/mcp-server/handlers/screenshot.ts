import { mkdirSync } from 'node:fs';
import { fetchSitemap } from '../../lib/extraction/sitemap.js';
import { ExtractionLog } from '../../lib/resume-state/index.js';
import { detect } from '../../lib/detect-platform/index.js';
import type { Handler } from '../handler-types.js';

export const screenshotHandler: Handler = async (args, ctx) => {
  const url = args.url as string;
  const outputDir = args.outputDir as string;
  // Create the output directory before acquiring the lock — the lockfile
  // write needs the directory to exist.
  mkdirSync(outputDir, { recursive: true });
  const log = new ExtractionLog(outputDir);
  if (!log.acquireLock()) {
    return ctx.errorResult('Another liberation workflow is already running in this outputDir.');
  }
  try {
    let urls: string[] = Array.isArray(args.urls) ? (args.urls as string[]) : [];
    if (urls.length === 0) {
      urls = await fetchSitemap(url);
    }
    const detection = await detect(url);
    const adapter = ctx.findAdapter(detection.platform);
    const { captureScreenshots } = await import('../../lib/screenshot/screenshotter.js');
    const result = await captureScreenshots({
      urls,
      outputDir,
      primaryUrl: url,
      types: args.types as import('../../lib/extraction/sitemap.js').UrlType[] | undefined,
      limit: args.limit as number | undefined,
      concurrency: args.concurrency as number | undefined,
      browserRestartEvery: args.browserRestartEvery as number | undefined,
      cdpPort: args.cdpPort as number | undefined,
      force: args.force as boolean | undefined,
      verbose: args.verbose as boolean | undefined,
      removeSelectors: adapter?.capture?.removeSelectors,
      prepareCapture: adapter?.capture?.prepare,
      server: ctx.server,
    });
    return ctx.textResult(result);
  } finally {
    log.releaseLock();
  }
};
