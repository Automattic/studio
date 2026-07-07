import { detect } from '../../lib/detect-platform/index.js';
import { fetchSitemap, classifyUrl } from '../../lib/extraction/sitemap.js';
import type { Handler } from '../handler-types.js';

export const inspectHandler: Handler = async (args, ctx) => {
  const detection = await detect(args.url as string);
  const result: Record<string, unknown> = {
    url: args.url,
    platform: detection.platform,
    confidence: detection.confidence,
    signals: detection.signals,
    sitemapFound: false,
    urlCount: 0,
    counts: {} as Record<string, number>,
    probeResults: [],
    authRequired: false,
    extractionFeasibility: detection.platform === 'unknown' ? 'limited' : 'ready',
  };

  const urls = await fetchSitemap(args.url as string);
  result.sitemapFound = urls.length > 0;
  result.urlCount = urls.length;

  const counts: Record<string, number> = {};
  for (const url of urls) {
    const type = classifyUrl(url);
    counts[type] = (counts[type] || 0) + 1;
  }
  result.counts = counts;

  const adapter = ctx.findAdapter(detection.platform);
  if (adapter && typeof adapter.probe === 'function') {
    const opts = { token: args.token, cdpPort: args.cdpPort };
    result.probeResults = await adapter.probe(args.url as string, urls.slice(0, 3), opts);
  }

  const { detectFeatures } = await import('../../lib/features/detect-features.js');
  const featureUrls = urls.length > 0 ? urls : [args.url as string];
  result.platformFeatures = detectFeatures(detection.platform, featureUrls, []);

  return ctx.textResult(result);
};
