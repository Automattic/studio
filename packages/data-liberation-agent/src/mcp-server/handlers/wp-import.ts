import { join } from 'node:path';
import type { Handler } from '../handler-types.js';

export const wpImportHandler: Handler = async (args, ctx) => {
  const wxrFile = args.wxrFile as string;

  // Delegate mode: return a structured import manifest
  if (args.delegate) {
    const outputDir = join(wxrFile, '..');
    const { existsSync } = await import('node:fs');
    const mediaDir = join(outputDir, 'media');
    const productsCsvPath = join(outputDir, 'products.csv');
    const redirectMapPath = join(outputDir, 'redirect-map.json');

    return ctx.textResult({
      mode: 'delegate',
      manifest: {
        wxrFile,
        outputDir,
        mediaDir: existsSync(mediaDir) ? mediaDir : null,
        productsCsv: existsSync(productsCsvPath) ? productsCsvPath : null,
        redirectMap: existsSync(redirectMapPath) ? redirectMapPath : null,
        importAuthors: (args.importAuthors as boolean) ?? false,
      },
    });
  }

  // REST API mode: import directly
  try {
    const { importToWordPress } = await import('../../lib/import/wp-importer.js');
    const { resolveSiteUrl } = await import('../../lib/import/resolve-site-url.js');
    const resolvedSite = await resolveSiteUrl(args.site as string);
    const importResult = await importToWordPress({
      wxrFile,
      site: resolvedSite,
      username: args.username as string,
      token: args.token as string,
      dryRun: (args.dryRun as boolean) ?? false,
      delay: (args.delay as number) ?? 500,
      only: (args.only as string) ?? undefined,
      resume: (args.resume as boolean) ?? false,
      verbose: (args.verbose as boolean) ?? false,
      importAuthors: (args.importAuthors as boolean) ?? false,
      woocommerceKey: (args.woocommerceKey as string) ?? undefined,
      woocommerceSecret: (args.woocommerceSecret as string) ?? undefined,
      onProgress: (stage, current, total, label) => {
        ctx.server.sendLoggingMessage({
          level: 'info',
          data: `[${stage}] ${current}/${total} ${label}`,
        });
      },
    });
    return ctx.textResult(importResult);
  } catch (err) {
    return ctx.errorResult(`Import failed: ${(err as Error).message}`);
  }
};
