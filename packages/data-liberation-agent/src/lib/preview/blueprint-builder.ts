import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type BlueprintStep =
  | { step: 'installPlugin'; pluginData: { resource: string; slug: string } }
  | { step: 'wp-cli'; command: string }
  | { step: 'writeFile'; path: string; data: string };

export interface Blueprint {
  preferredVersions: { php: string; wp: string };
  login: boolean;
  steps: BlueprintStep[];
}

export interface BuildBlueprintOpts {
  outputDir: string;
}

export function buildBlueprint({ outputDir }: BuildBlueprintOpts): Blueprint {
  const abs = resolve(outputDir);
  const hasProducts = existsSync(join(abs, 'products.csv'));

  const steps: BlueprintStep[] = [];

  // Studio's blueprint runs INSIDE the `start-server` IPC window (120s
  // no-activity). The `importWxr` step hardcodes FETCH_ATTACHMENTS
  // = true, so for sites with many media items it blows the window fetching
  // from the origin CDN.
  //
  // Instead we only install plugins in the blueprint and stage the WXR +
  // media files post-create. startStudioPreview then rewrites the WXR's
  // attachment URLs to `http://localhost:<port>/wp-content/uploads/liberation/<filename>`
  // (served by the local WP) and invokes `wp import --fetch-attachments`
  // out-of-band — localhost fetches are fast so we comfortably stay inside
  // the wp-cli-command IPC window too.
  steps.push({
    step: 'installPlugin',
    pluginData: { resource: 'wordpress.org/plugins', slug: 'wordpress-importer' },
  });
  if (hasProducts) {
    steps.push({
      step: 'installPlugin',
      pluginData: { resource: 'wordpress.org/plugins', slug: 'woocommerce' },
    });
    // Product CSV import happens out-of-band via `wp eval-file` in
    // startStudioPreview — WC core has no CLI CSV-import subcommand, and the
    // blueprint schema has no native wc_product_importer step.
  }

  // Studio errors hard on `landingPage` — "WordPress server process
  // exited unexpectedly" follows the warning. Omit it entirely.
  return {
    preferredVersions: {
      php: '8.2',
      wp: process.env.DLA_PREVIEW_WP_VERSION ?? 'latest',
    },
    login: true,
    steps,
  };
}

export function persistBlueprint(outputDir: string): string {
  const bp = buildBlueprint({ outputDir });
  const dir = join(resolve(outputDir), 'blueprint');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'blueprint.studio.json');
  writeFileSync(filePath, JSON.stringify(bp, null, 2));
  return filePath;
}
