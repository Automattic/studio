import type { Handler } from '../handler-types.js';
import { extractSignature, extractFullFromUrl } from '../../lib/replicate/section-extract.js';

export const sectionExtractHandler: Handler = async (args, ctx) => {
  const url = args.url as string | undefined;
  const detail = args.detail as string | undefined;
  if (!url || !detail) return ctx.errorResult('url and detail are required');

  if (detail === 'signature') {
    const html = args.html as string | undefined;
    if (!html) return ctx.errorResult('html is required for detail=signature');
    return ctx.textResult(extractSignature(url, html, html.length));
  }

  if (detail === 'full') {
    // mediaMap rewrites captured CDN image URLs to the pipeline's uploaded WP
    // URLs. Optional — when absent, image URLs are kept as captured.
    const mediaMap = (args.mediaMap as Record<string, string> | undefined) ?? {};
    const cdpPort = typeof args.cdpPort === 'number' ? (args.cdpPort as number) : undefined;
    try {
      const { specs } = await extractFullFromUrl(url, mediaMap, { cdpPort });
      return ctx.textResult(specs);
    } catch (err) {
      return ctx.errorResult(
        `section_extract detail=full failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return ctx.errorResult(`unknown detail: ${detail} (expected 'signature' or 'full')`);
};
