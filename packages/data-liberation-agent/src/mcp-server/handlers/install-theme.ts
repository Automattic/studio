//
// liberate_install_theme
// ======================
// Streaming-friendly companion to liberate_preview. Installs replica theme
// files + block plugins into an *already-running* Studio site instead of
// creating one. Used by the streaming watch loop's theme-piece and
// archetype-template judgments — the pre-started Studio site already has
// streamed content, so we must not call liberate_preview (which routes
// through startStudioPreview and creates a `-2` duplicate site).
//
// Differences from liberate_preview:
//   - No site creation. Caller passes `studioSitePath` to the running site.
//   - No content import. Per-URL inserts already populated the DB.
//   - Just writes files into wp-content/{themes,plugins} and activates.
//
// Returns the warnings collected during plugin/theme activate so the agent
// can surface non-fatal failures (e.g. activate fails because
// register_block_type errored — file was written but plugin didn't load).
//

import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  writeReplicaFilesToHost,
  validateReplicaInputs,
} from '../../lib/preview/replica-install.js';
import type { ReplicaFile, ReplicaBlockPlugin } from '../../lib/preview/types.js';
import type { Handler } from '../handler-types.js';
import { studioWp } from '../../lib/preview/studio.js';

interface InstallThemeArgs {
  outputDir?: string;
  studioSitePath?: string;
  themeFiles?: ReplicaFile[];
  blockPlugins?: ReplicaBlockPlugin[];
  themeSlug?: string;
}

export function deriveInstallThemeSlug(outputDir: string): string {
  const base = basename(outputDir).toLowerCase();
  const sanitized = base.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized ? `${sanitized}-replica` : 'site-replica';
}

export function resolveInstallThemeSlug(args: {
  outputDir: string;
  requestedThemeSlug?: string;
  wpRoot: string;
}): string {
  const shellThemeSlug = deriveInstallThemeSlug(args.outputDir);
  if (!args.requestedThemeSlug) return shellThemeSlug;
  if (args.requestedThemeSlug === shellThemeSlug) return args.requestedThemeSlug;

  const shellStylePath = join(
    args.wpRoot,
    'wp-content',
    'themes',
    shellThemeSlug,
    'style.css',
  );
  return existsSync(shellStylePath) ? shellThemeSlug : args.requestedThemeSlug;
}

export const installThemeHandler: Handler = async (args, ctx) => {
  const a = args as InstallThemeArgs;

  const outputDir = a.outputDir;
  const studioSitePath = a.studioSitePath;
  const themeFiles = a.themeFiles;
  const blockPlugins = a.blockPlugins;
  let themeSlug = a.themeSlug;

  if (!outputDir) {
    return ctx.errorResult('liberate_install_theme requires `outputDir`.');
  }
  if (!studioSitePath) {
    return ctx.errorResult(
      'liberate_install_theme requires `studioSitePath` — the on-disk path to the running Studio site (e.g. ~/Studio/example-com).',
    );
  }
  // Studio mounts the host site directory at VFS path `/wordpress`. In current
  // Studio versions the host site directory IS the wp-root (wp-content/ sits
  // directly inside it). Older layouts nested everything under a `wordpress/`
  // subdir on the host. Detect by probing for wp-content rather than assuming.
  const sitePathResolved = resolve(studioSitePath);
  let wpRoot = sitePathResolved;
  if (!existsSync(join(wpRoot, 'wp-content'))) {
    const nested = join(sitePathResolved, 'wordpress');
    if (existsSync(join(nested, 'wp-content'))) {
      wpRoot = nested;
    } else {
      return ctx.errorResult(
        `studioSitePath has no wp-content (looked at ${join(sitePathResolved, 'wp-content')} and ${join(nested, 'wp-content')}). Pass the running Studio site dir.`,
      );
    }
  }

  const hasTheme = !!themeFiles && themeFiles.length > 0;
  const hasPlugins = !!blockPlugins && blockPlugins.length > 0;
  if (!hasTheme && !hasPlugins) {
    return ctx.errorResult(
      'liberate_install_theme needs themeFiles[] or blockPlugins[] (or both). Got neither.',
    );
  }
  if (hasTheme) {
    themeSlug = resolveInstallThemeSlug({
      outputDir,
      requestedThemeSlug: themeSlug,
      wpRoot,
    });
  }

  // Up-front validation — slug shape, path traversal, etc. — before any
  // writes hit disk.
  try {
    validateReplicaInputs(themeFiles, blockPlugins, themeSlug);
  } catch (err) {
    return ctx.errorResult(`Replica input invalid: ${(err as Error).message}`);
  }

  let written: { themeWritten: number; pluginsWritten: number; pluginSlugs: string[]; assetsCopied: number };
  try {
    written = writeReplicaFilesToHost({
      wpRoot,
      themeSlug,
      themeFiles,
      blockPlugins,
      // Copy on-disk binary theme assets (self-hosted fonts, localized logo, icon
      // SVGs) that string themeFiles[] can't carry — previously bridged by hand.
      assetSourceDir: join(resolve(outputDir), 'theme'),
    });
  } catch (err) {
    return ctx.errorResult(`Failed to write replica files: ${(err as Error).message}`);
  }

  const warnings: string[] = [];
  for (const slug of written.pluginSlugs) {
    try {
      await studioWp(studioSitePath, ['plugin', 'activate', slug]);
    } catch (err) {
      warnings.push(`Plugin activate "${slug}" failed: ${(err as Error).message.trim()}`);
    }
  }
  if (hasTheme && themeSlug) {
    try {
      await studioWp(studioSitePath, ['theme', 'activate', themeSlug]);
    } catch (err) {
      warnings.push(`Theme activate "${themeSlug}" failed: ${(err as Error).message.trim()}`);
    }
    // Flush caches so freshly-written block patterns + templates render
    // immediately. Block themes cache `patterns/*.php` registration and
    // template resolution; without a flush the just-installed front-page /
    // patterns can render as the stale (empty) version until WP next clears
    // its cache. Best-effort — never fatal to a successful install.
    for (const wpArgs of themeCacheFlushCommands()) {
      try {
        await studioWp(studioSitePath, wpArgs);
      } catch { /* best-effort */ }
    }
  }

  return ctx.textResult({
    ok: true,
    studioSitePath,
    themeSlug: themeSlug ?? null,
    themeWritten: written.themeWritten,
    assetsCopied: written.assetsCopied,
    pluginsWritten: written.pluginsWritten,
    pluginSlugs: written.pluginSlugs,
    activated: {
      theme: hasTheme && themeSlug ? !warnings.some((w) => w.startsWith(`Theme activate "${themeSlug}"`)) : null,
      plugins: written.pluginSlugs.filter(
        (s) => !warnings.some((w) => w.startsWith(`Plugin activate "${s}"`)),
      ),
    },
    warnings,
  });
};

/**
 * The post-theme-activate cache-flush sequence, as ordered `wp` CLI argument
 * vectors. Extracted as a pure function so the ordering + completeness can be
 * unit-tested without shelling out to Studio.
 *
 * Three steps, each best-effort:
 *   1. `transient delete --all` — clears DB-backed transients broadly.
 *   2. `cache flush` — clears the runtime object cache.
 *   3. `eval $wpdb->query(DELETE ... wp_theme_files_patterns-*)` — the
 *      load-bearing step for RE-installs (run via $wpdb, not `db query`, which
 *      is MySQL-only and fails on Studio's SQLite). `WP_Theme::get_block_patterns()` memoizes the theme's
 *      `patterns/*.php` file list in the `wp_theme_files_patterns-<hash>`
 *      transient. On a non-persistent object cache (Studio's SQLite), `cache
 *      flush` does NOT remove that DB-backed transient, so a newly-added pattern
 *      file stays UNregistered and its `wp:pattern` reference renders EMPTY —
 *      the page silently loses its reconstructed content. Deleting these
 *      transients forces the registry to rescan the patterns dir next request.
 *      (`transient delete --all` would also catch them, but is sometimes scoped
 *      to expired/timeout rows by site config, so we delete the pattern-file
 *      transients explicitly and unconditionally.)
 */
export function themeCacheFlushCommands(): string[][] {
  return [
    ['transient', 'delete', '--all'],
    ['cache', 'flush'],
    // The theme's block-pattern file list (patterns/*.php) is cached in the
    // `wp_theme_files_patterns` transient. WordPress stores it as a SITE
    // transient (`_site_transient_*`), not a regular transient — on a
    // single-site install `transient delete --all` does NOT clear site
    // transients, so a newly-added patterns/page-<slug>.php never gets scanned
    // and its `wp:pattern` resolves to empty until the transient TTL lapses.
    // Delete BOTH the regular and the site-transient option rows (value +
    // timeout) so the next request re-scans the patterns directory and
    // registers the just-installed pattern. Without the `_site_transient_`
    // variant the freshly-reconstructed page renders a blank pattern.
    //
    // Run the DELETE through `wp eval` (i.e. $wpdb), NOT `wp db query`: the
    // latter shells out to the mysql client and dies with `Undefined constant
    // DB_HOST` on Studio's SQLite, so the load-bearing purge silently failed on
    // every convert (the recurring "cache flush failed (db query)" warning).
    // $wpdb routes through the SQLite drop-in on Studio and MySQL elsewhere, so
    // this is driver-agnostic. `{$wpdb->options}` respects the table prefix.
    [
      'eval',
      'global $wpdb; $wpdb->query("DELETE FROM {$wpdb->options} WHERE ' +
        "option_name LIKE '_transient_wp_theme_files_patterns-%' " +
        "OR option_name LIKE '_transient_timeout_wp_theme_files_patterns-%' " +
        "OR option_name LIKE '_site_transient_wp_theme_files_patterns-%' " +
        "OR option_name LIKE '_site_transient_timeout_wp_theme_files_patterns-%\");",
    ],
  ];
}

