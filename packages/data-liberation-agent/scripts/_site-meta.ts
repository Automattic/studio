// Shared helpers for the replica-reconstruction driver scripts. Site identity is
// always derived from the run's OWN output dir (its WXR + dir name) so the
// scripts work for any extracted site — nothing is hardcoded to one source.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Single source of truth for the install theme slug (e.g.
// `output/www.example.com` → `www-example-com-replica`).
export { deriveInstallThemeSlug as installThemeSlug } from '../src/mcp-server/handlers/install-theme.js';

/**
 * Require an output dir as the first positional CLI arg (e.g. `output/www.example.com`).
 * Exits with a usage hint rather than silently defaulting to one site.
 */
export function requireOutputDir(scriptUsage = '<outputDir> [args...]'): string {
  const dir = process.argv[2];
  if (!dir) {
    console.error(`usage: tsx scripts/${scriptName()} ${scriptUsage}   (e.g. output/www.example.com)`);
    process.exit(1);
  }
  return dir;
}

function scriptName(): string {
  return process.argv[1]?.split('/').pop() ?? '<script>.ts';
}

export interface SiteMeta {
  /** Source origin, no trailing slash (e.g. `https://www.example.com`). */
  origin: string;
  /** Source hostname (e.g. `www.example.com`). */
  host: string;
  /** Site title from the WXR channel `<title>`, falling back to the host. */
  siteTitle: string;
}

/**
 * Read the source site's identity from the run's WXR: `<wp:base_site_url>` is the
 * origin and the first channel `<title>` is the site title. Throws when the WXR is
 * missing so callers fail loudly instead of producing a mislabeled theme.
 */
export function readSiteMeta(outputDir: string): SiteMeta {
  const wxrPath = join(outputDir, 'output.wxr');
  if (!existsSync(wxrPath)) {
    throw new Error(`output.wxr not found at ${wxrPath} — run extraction first.`);
  }
  const wxr = readFileSync(wxrPath, 'utf8');
  const rawOrigin =
    /<wp:base_site_url>([^<]+)<\/wp:base_site_url>/.exec(wxr)?.[1] ??
    /<link>([^<]+)<\/link>/.exec(wxr)?.[1];
  if (!rawOrigin) {
    throw new Error(`could not read <wp:base_site_url> from ${wxrPath}`);
  }
  const origin = rawOrigin.trim().replace(/\/+$/, '');
  const host = new URL(origin).hostname;
  const title = /<title>([^<]*)<\/title>/.exec(wxr)?.[1]?.trim();
  return { origin, host, siteTitle: title || host };
}

/** Current `YYYY/MM` — the default WP uploads month when one isn't supplied. */
export function defaultUploadsMonth(now = new Date()): string {
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
}
