import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ImportSession } from '../../lib/resume-state/index.js';
import { blockifyWxrFile } from '../../lib/extraction/blockify-wxr.js';
import type { Handler } from '../handler-types.js';

/**
 * Bulk-convert post/page bodies in output.wxr to Gutenberg blocks via the source
 * platform adapter's block recipe (seam 2). Blocks reconstruct path only — the
 * blocks flow calls this after extraction and before import; the theme/carry path
 * never does. No-op when the platform has no block recipe (returns skipped:true).
 */
export const blockifyWxrHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string | undefined;
  if (!outputDir) return ctx.errorResult('liberate_blockify_wxr requires `outputDir`.');

  const wxrPath = (args.wxrPath as string | undefined) ?? join(outputDir, 'output.wxr');
  if (!existsSync(wxrPath)) return ctx.errorResult(`WXR not found at ${wxrPath}`);

  // Prefer an explicit override, else the platform recorded at extraction.
  const platform = (args.platform as string | undefined) ?? ImportSession.readAdapter(outputDir) ?? undefined;
  const adapter = platform ? ctx.findAdapter(platform) : null;
  if (!adapter?.blocks) {
    return ctx.textResult({
      wxrPath,
      converted: 0,
      skipped: true,
      reason: platform
        ? `adapter '${platform}' has no block recipe — bodies left as source HTML`
        : 'no platform recorded in session.json (pass `platform` to override)',
    });
  }

  try {
    const result = blockifyWxrFile(wxrPath, adapter.blocks);
    return ctx.textResult({ wxrPath, platform, ...result });
  } catch (err) {
    // A corrupt/unreadable WXR shouldn't surface as an unhandled throw.
    return ctx.errorResult(`blockify failed for ${wxrPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
};
