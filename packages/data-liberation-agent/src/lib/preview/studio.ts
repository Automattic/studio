import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { persistBlueprint } from './blueprint-builder.js';
import { buildMediaUrlMap, rewriteWxrAttachmentUrls } from './media-url-map.js';
import { writeReplicaFilesToHost, validateReplicaInputs } from './replica-install.js';
import {
  readSiteMetaFromWxr,
  wpOptionUpdatesForSiteMeta,
  type SourceSiteMeta,
} from './site-options.js';
import type { ReplicaFile, ReplicaBlockPlugin, StartPreviewResult } from './types.js';
import { resolveStudioRoot } from '../paths.js';
import { expandTilde, studioWpRoot } from './studio-site.js';

const execFileAsync = promisify(execFile);

const UPLOADS_SUBDIR = 'wp-content/uploads/liberation';
/**
 * Scripts live OUTSIDE wp-content/uploads to rule out any Studio-side
 * special handling of the uploads dir. A dotfile-prefixed dir at the site
 * root is out of the way of WordPress itself and unambiguously ours.
 */
const SCRIPTS_SUBDIR = '.dla-scripts';

/**
 * Studio mounts the host site directory at VFS path `/wordpress` (see
 * wordpress-server-child.mjs in the Studio bundle: `mounts: [{ hostPath:
 * config.sitePath, vfsPath: "/wordpress" }, ...]`). Any path we pass to
 * `studio wp eval-file`, or that gets consumed by PHP running inside the
 * site, must use the VFS prefix — host paths resolve to "does not exist".
 */
const STUDIO_VFS_ROOT = '/wordpress';

/** Translate a site-relative path into the VFS path PHP sees inside Studio. */
export function toVfsPath(siteRelativePath: string): string {
  return `${STUDIO_VFS_ROOT}/${siteRelativePath.replace(/^\/+/, '')}`;
}

/** Absolute path to the vendored product-importer PHP script. */
const PRODUCT_IMPORT_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'scripts',
  'import-products.php',
);

/**
 * Absolute path to the vendored WXR-importer PHP script. Installs a
 * `pre_http_request` filter that short-circuits attachment HTTP fetches by
 * basename-match against the source dir, then runs WP_Import::import().
 * Needed because Studio's bundled wp-cli predates `wp import --source-dir`.
 */
const WXR_IMPORT_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'scripts',
  'import-wxr.php',
);

export interface StudioSite {
  id: string;
  name: string;
  path: string;
  port: number;
  url: string;
  running: boolean;
  adminUsername: string;
  adminPassword: string;
}

/**
 * Returns true if the `studio` CLI binary is reachable on PATH.
 * Fast-fails on any error so callers can surface a clear 'install Studio' error.
 */
export function isStudioAvailable(): boolean {
  try {
    execFileSync('studio', ['--version'], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize an outputDir basename (a domain-derived slug) into a Studio site
 * name. If the slug already matches an existing site, append `-2`, `-3`, etc.
 * until it's unique. Callers pass the current `studio site list` output so we
 * don't clobber user sites.
 */
export function makeStudioSiteName(
  outputDir: string,
  existingNames: string[] = [],
  explicitName?: string,
): string {
  const raw = explicitName && explicitName.trim() ? explicitName : basename(resolve(outputDir));
  const base = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'site';
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Resolve the on-disk WP root for a Studio site by probing its layout.
 *
 * Studio sites exist in two shapes:
 *   - flat:   <sitePath>/wp-content          (current Studio versions)
 *   - nested: <sitePath>/wordpress/wp-content (older layouts)
 *
 * Hardcoding `<sitePath>/wordpress` (the prior behavior in the theme-write
 * step) wrote the replica theme into a phantom `wordpress/wp-content/themes/`
 * dir on flat sites, so `wp theme activate` could not find it ("theme could not
 * be found"). Probe instead — mirrors media-install.wpRootFor and the
 * install-theme handler. Falls back to flat so a concrete error surfaces rather
 * than silently writing to the wrong place.
 */
export function resolveStudioWpRoot(sitePath: string): string {
  // Non-null variant of studioWpRoot: falls back to the (resolved) flat path so
  // a concrete "theme could not be found" error surfaces downstream rather than
  // a null deref here.
  return studioWpRoot(sitePath) ?? resolve(expandTilde(sitePath));
}

async function listStudioSites(): Promise<StudioSite[]> {
  const { stdout } = await execFileAsync('studio', ['site', 'list', '--format', 'json'], {
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const trimmed = stdout.slice(stdout.indexOf('['));
  return JSON.parse(trimmed) as StudioSite[];
}

/**
 * Run `studio wp --path <sitePath> <args>` and return raw stdout. The single
 * Studio wp-cli exec wrapper — handlers import this instead of re-spelling the
 * `execFileAsync('studio', ['wp', '--path', …])` boilerplate. Timeout/buffer
 * default to the long-running 5min/50MB envelope; callers running short or
 * large-output commands override via opts.
 */
export async function studioWp(
  sitePath: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    'studio',
    ['wp', '--path', sitePath, ...args],
    { timeout: opts.timeout ?? 300_000, maxBuffer: opts.maxBuffer ?? 50 * 1024 * 1024 },
  );
  return stdout;
}

type StudioWpRunner = (sitePath: string, args: string[]) => Promise<string>;

export async function updateStudioSiteOptions(
  sitePath: string,
  siteMeta: SourceSiteMeta | null | undefined,
  runWp: StudioWpRunner = studioWp,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const [optionName, optionValue] of wpOptionUpdatesForSiteMeta(siteMeta)) {
    try {
      await runWp(sitePath, ['option', 'update', optionName, optionValue]);
    } catch (err) {
      warnings.push(`Site option "${optionName}" update failed: ${(err as Error).message.trim()}`);
    }
  }
  return warnings;
}

/** WP-default demo content created by every fresh install, identified by slug. */
export const WP_DEFAULT_CONTENT_SLUGS = ['hello-world', 'sample-page', 'privacy-policy'];

/**
 * Delete WP's default demo content (Hello world! post, Sample Page, the
 * auto-drafted Privacy Policy) BEFORE importing the source WXR. Two reasons:
 *  1. It pollutes a faithful replica (a replica reflects the SOURCE, not WP).
 *  2. The default `privacy-policy` draft STEALS the slug, so the source's own
 *     privacy page imports as `privacy-policy-2` — which then mismatches the
 *     slug the reconstruct step targets, writing the reconstruction into the
 *     wrong post. Clearing the defaults first lets source pages claim their
 *     natural slugs. Best-effort + per-slug isolated: one failure never blocks
 *     the import. Idempotent (a re-run finds nothing to delete).
 */
export async function deleteDefaultWpContent(
  sitePath: string,
  runWp: StudioWpRunner = studioWp,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const slug of WP_DEFAULT_CONTENT_SLUGS) {
    try {
      const out = await runWp(sitePath, [
        'post', 'list', `--name=${slug}`, '--post_type=post,page',
        '--post_status=any', '--field=ID', '--format=ids',
      ]);
      const ids = out.trim().split(/\s+/).filter(Boolean);
      if (ids.length > 0) await runWp(sitePath, ['post', 'delete', ...ids, '--force']);
    } catch (err) {
      warnings.push(`WP-default cleanup for "${slug}" failed: ${(err as Error).message.trim()}`);
    }
  }
  return warnings;
}

/**
 * Best-effort cleanup for a Studio site that `startStudioPreview` created but
 * then failed to finish setting up (staging, wp import, etc.). We'd rather
 * leak disk than leave half-imported sites cluttering `studio site list`.
 * Studio's `site delete` prompts interactively — we send 'y\n' on stdin.
 * Identified by `--path` (the CLI has no --name) so callers pass the on-disk
 * site path, not the site's display name.
 */
async function removeStudioSite(sitePath: string): Promise<void> {
  try {
    const child = execFile(
      'studio',
      ['site', 'delete', '--path', sitePath],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    child.stdin?.end('y\n');
    await new Promise<void>((resolve, reject) => {
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`studio site delete exited with ${code}`))));
      child.on('error', reject);
    });
  } catch {
    // Removal itself failed — log once and give up; the user can clean
    // manually via `studio site delete`.
    console.error(`[preview] could not auto-remove orphaned Studio site at "${sitePath}"; remove manually with: studio site delete --path ${sitePath}`);
  }
}

/**
 * Stage extraction artifacts (media, WXR, products.csv) plus our vendored
 * PHP importer scripts into the Studio site directory. Scripts MUST live
 * under the site path because Studio's wp-cli runtime rejects host paths
 * — `wp eval-file /Users/.../import-wxr.php` errors with "does not exist".
 * Data artifacts go under wp-content/uploads/liberation/; scripts go under
 * .dla-scripts/ at the site root (separate from uploads so Studio can't
 * apply any upload-dir-specific handling to them).
 *
 * Exported for unit-test access. Not part of the public API.
 */
export function stageArtifacts(outputDir: string, sitePath: string): {
  wxrRelPath: string | null;
  productsCsvRelPath: string | null;
  wxrScriptRelPath: string;
  productScriptRelPath: string;
  hasMedia: boolean;
} {
  const absOutput = resolve(outputDir);
  const stageDir = join(sitePath, UPLOADS_SUBDIR);
  mkdirSync(stageDir, { recursive: true });

  const mediaSrc = join(absOutput, 'media');
  let hasMedia = false;
  if (existsSync(mediaSrc)) {
    cpSync(mediaSrc, stageDir, { recursive: true });
    hasMedia = true;
  }

  const wxrSrc = join(absOutput, 'output.wxr');
  let wxrRelPath: string | null = null;
  if (existsSync(wxrSrc)) {
    const wxrDest = join(stageDir, 'output.wxr');
    copyFileSync(wxrSrc, wxrDest);
    wxrRelPath = `${UPLOADS_SUBDIR}/output.wxr`;
  }

  const productsSrc = join(absOutput, 'products.csv');
  let productsCsvRelPath: string | null = null;
  if (existsSync(productsSrc)) {
    const productsDest = join(stageDir, 'products.csv');
    copyFileSync(productsSrc, productsDest);
    productsCsvRelPath = `${UPLOADS_SUBDIR}/products.csv`;
  }

  // Vendored PHP scripts. Studio's wp-cli can't eval-file host paths, so copy
  // them under the site dir. Placed at the site root (not under uploads) so
  // Studio can't special-case them. Idempotent / overwrite-safe across reruns.
  const scriptsDir = join(sitePath, SCRIPTS_SUBDIR);
  mkdirSync(scriptsDir, { recursive: true });
  const wxrScriptDest = join(scriptsDir, 'import-wxr.php');
  const productScriptDest = join(scriptsDir, 'import-products.php');
  copyFileSync(WXR_IMPORT_SCRIPT, wxrScriptDest);
  copyFileSync(PRODUCT_IMPORT_SCRIPT, productScriptDest);
  if (!existsSync(wxrScriptDest) || !existsSync(productScriptDest)) {
    throw new Error(
      `stageArtifacts: copied scripts are not at expected paths (${wxrScriptDest}, ${productScriptDest})`,
    );
  }
  const wxrScriptRelPath = `${SCRIPTS_SUBDIR}/import-wxr.php`;
  const productScriptRelPath = `${SCRIPTS_SUBDIR}/import-products.php`;

  return {
    wxrRelPath,
    productsCsvRelPath,
    wxrScriptRelPath,
    productScriptRelPath,
    hasMedia,
  };
}

export interface StartStudioOpts {
  outputDir: string;
  themeFiles?: ReplicaFile[];
  blockPlugins?: ReplicaBlockPlugin[];
  themeSlug?: string;
  /**
   * Explicit Studio site name (sanitized + uniqued). When omitted, derived
   * from the outputDir basename. Lets the replica install path name the site
   * `<siteSlug>-replica` independent of the output directory.
   */
  siteName?: string;
}

/**
 * Full-fidelity Studio preview:
 *   1. Create a site with a blueprint that only pre-installs wordpress-importer
 *      + WooCommerce (if products.csv exists). We intentionally do NOT inline
 *      the WXR via `importWxr` — that step hardcodes FETCH_ATTACHMENTS=true,
 *      and fetching 100s of attachments from the origin CDN easily blows
 *      Studio's 120s `start-server` silence timeout.
 *   2. Stage media, the WXR, and products.csv into wp-content/uploads/liberation/.
 *   3. Rewrite `<wp:attachment_url>` entries so their basename matches the
 *      staged filename — collision suffixes (`foo-2.jpg`) would otherwise
 *      mismatch the original URL's basename.
 *   4. Run the vendored `import-wxr.php` via `wp eval-file`. It installs a
 *      `pre_http_request` filter that basename-matches attachment URLs
 *      against the staged source dir and short-circuits the fetch — no HTTP,
 *      no CDN round-trips, no deadlock with Studio's SinglePHPInstanceManager.
 *      (Studio's bundled wp-cli predates `wp import --source-dir`, so we
 *      replicate that behavior ourselves.)
 *   5. Run the vendored import-products.php via `wp eval-file` — WC core has
 *      no CLI CSV-import subcommand, so we invoke WC_Product_CSV_Importer
 *      directly. Product-import failures are non-fatal.
 *
 * Studio's `site create` blocks until the blueprint finishes, and studioWp
 * calls block until WP-CLI returns — so when we resolve, the full import is
 * actually done and it's safe to open the browser / prompt for the real
 * WordPress import.
 */
/**
 * Studio-only preview entry point. Hard-requires Studio — no fallback.
 * `isAvailable` is injectable for testing (defaults to the real check).
 */
export async function startPreview(
  opts: StartStudioOpts,
  isAvailable: () => boolean = isStudioAvailable,
): Promise<StartPreviewResult> {
  if (!isAvailable()) {
    return {
      status: 'failed',
      error: 'Studio is required for preview/import. Install it from https://developer.wordpress.com/studio/',
    };
  }
  return startStudioPreview(opts);
}

export async function startStudioPreview(opts: StartStudioOpts): Promise<StartPreviewResult> {
  // Validate replica inputs up front — fail fast before creating a site.
  validateReplicaInputs(opts.themeFiles, opts.blockPlugins, opts.themeSlug);

  const blueprintPath = persistBlueprint(opts.outputDir);
  let existingSites: StudioSite[] = [];
  try {
    existingSites = await listStudioSites();
  } catch {
    // If we can't list sites, proceed with the base slug — `studio site create`
    // will error on true collision and we'll surface that to the user.
  }
  const existingNames = existingSites.map((s) => s.name);
  const existingPaths = new Set(existingSites.map((s) => resolve(s.path)));
  const name = makeStudioSiteName(opts.outputDir, existingNames, opts.siteName);
  const sitePath = join(resolveStudioRoot(), name);
  const absOutput = resolve(opts.outputDir);
  const hasProducts = existsSync(join(absOutput, 'products.csv'));

  // Clean exactly the sitePath we're about to create — and ONLY that path —
  // if it exists on disk with no matching daemon record. That's the orphan
  // signature from a prior failed run: Studio reuses the dir silently (skips
  // "Creating site directory…"), then WP crashes during blueprint apply
  // because SQLite/plugins/etc. collide with the reused state. Gated on the
  // path living under Studio's root so we never touch a user directory.
  const resolvedSitePath = resolve(sitePath);
  if (
    existsSync(resolvedSitePath) &&
    !existingPaths.has(resolvedSitePath) &&
    resolvedSitePath.startsWith(resolve(resolveStudioRoot()) + '/')
  ) {
    rmSync(resolvedSitePath, { recursive: true, force: true });
  }

  try {
    await execFileAsync(
      'studio',
      [
        'site', 'create',
        '--name', name,
        '--path', sitePath,
        '--blueprint', blueprintPath,
        '--skip-browser',
        '--skip-log-details',
        '--start',
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (err) {
    return {
      status: 'failed',
      error: `studio site create failed: ${(err as Error).message}`,
    };
  }

  // From here on, the site exists (with plugins installed by the blueprint)
  // but NO content is imported yet. Stage artifacts, then run `wp import`.
  // Infra failures (staging, site lookup) trigger cleanup; content-import
  // failures bubble up the same way. Product-CSV failure is demoted to a
  // warning since losing the whole site over products is too destructive.
  const warnings: string[] = [];
  try {
    const staged = stageArtifacts(opts.outputDir, sitePath);

    if (staged.wxrRelPath) {
      // Clear WP-default demo content BEFORE import so source pages claim their
      // natural slugs (esp. the default privacy-policy draft, which would force
      // the source privacy page to import as privacy-policy-2). Best-effort.
      warnings.push(...await deleteDefaultWpContent(sitePath));
      // File paths for the rewrite step are host paths (Node writes locally).
      const wxrHostPath = join(sitePath, staged.wxrRelPath);
      // Paths passed to `studio wp` must be VFS paths — Studio mounts the
      // site dir at /wordpress inside PHP.
      const wxrVfsPath = toVfsPath(staged.wxrRelPath);
      const wxrScriptVfsPath = toVfsPath(staged.wxrScriptRelPath);
      const sourceDirVfsPath = toVfsPath(UPLOADS_SUBDIR);

      // Studio's bundled wp-cli lacks `wp import --source-dir` (newer flag),
      // so we drive the import from our own PHP script which installs a
      // `pre_http_request` filter to basename-match attachment URLs against
      // the local staged dir. Collision-suffixed filenames (`foo-2.jpg`)
      // would mismatch the origin URL's basename — rewrite those URLs so
      // basename matches the staged file. 127.0.0.1 is chosen as the
      // rewrite host because wp_http_validate_url accepts numeric IPs
      // unconditionally (it only does DNS lookups for named hosts) and the
      // PHP script whitelists it via http_request_host_is_external.
      const mediaMap = buildMediaUrlMap(opts.outputDir);
      rewriteWxrAttachmentUrls(wxrHostPath, mediaMap, 'http://127.0.0.1');
      // --skip-plugins=wordpress-importer prevents WP-CLI's bootstrap from
      // loading the plugin (its entry-point function is declared outside the
      // WP_LOAD_IMPORTERS guard, so a subsequent re-include would fatal on
      // `Cannot redeclare`). Our script loads it fresh with WP_LOAD_IMPORTERS
      // already set.
      await studioWp(sitePath, [
        '--skip-plugins=wordpress-importer',
        'eval-file', wxrScriptVfsPath, wxrVfsPath, sourceDirVfsPath,
      ]);
    }

    if (hasProducts && staged.productsCsvRelPath) {
      const csvVfsPath = toVfsPath(staged.productsCsvRelPath);
      const productScriptVfsPath = toVfsPath(staged.productScriptRelPath);
      try {
        await studioWp(sitePath, [
          'eval-file', productScriptVfsPath, csvVfsPath, '--user=admin',
        ]);
      } catch (err) {
        // Content is already in; losing the whole site over products is too
        // destructive. Surface as a warning so the user can retry the import
        // via `wp eval-file` or the admin UI.
        warnings.push(`Product import failed: ${(err as Error).message.trim()}`);
      }
    }

    // WooCommerce 8.x+ ships "Coming soon" mode ON by default (store-pages-only),
    // which hides the shop + product pages behind a placeholder ("Great things are
    // on the horizon…"). Disable it so the imported store actually renders. Only
    // relevant when a store was installed; best-effort.
    if (hasProducts) {
      try {
        await studioWp(sitePath, ['option', 'update', 'woocommerce_coming_soon', 'no']);
      } catch (err) {
        warnings.push(`Disable WooCommerce coming-soon failed: ${(err as Error).message.trim()}`);
      }
    }

    warnings.push(...await updateStudioSiteOptions(sitePath, readSiteMetaFromWxr(opts.outputDir)));

    // Replica theme + block plugin install. Happens after content import so
    // wp-cli activate sees a fully-imported environment. Files are written
    // directly to the host filesystem under the probed WP root; activation
    // is via `studio wp` CLI. Failures here are NOT fatal to the imported
    // content — surface as warnings and let the caller decide.
    if (
      (opts.themeFiles && opts.themeFiles.length > 0) ||
      (opts.blockPlugins && opts.blockPlugins.length > 0)
    ) {
      const wpRoot = resolveStudioWpRoot(sitePath);
      try {
        const written = writeReplicaFilesToHost({
          wpRoot,
          themeSlug: opts.themeSlug,
          themeFiles: opts.themeFiles,
          blockPlugins: opts.blockPlugins,
          // Bridge on-disk BINARY assets (self-hosted fonts, logo.png, icon SVGs)
          // that string themeFiles[] can't carry — same as liberate_install_theme.
          // Without this the replica renders with system fonts + a broken logo.
          assetSourceDir: join(resolve(opts.outputDir), 'theme'),
        });
        for (const slug of written.pluginSlugs) {
          try {
            await studioWp(sitePath, ['plugin', 'activate', slug]);
          } catch (err) {
            warnings.push(`Plugin activate "${slug}" failed: ${(err as Error).message.trim()}`);
          }
        }
        if (opts.themeFiles && opts.themeFiles.length > 0 && opts.themeSlug) {
          try {
            await studioWp(sitePath, ['theme', 'activate', opts.themeSlug]);
          } catch (err) {
            warnings.push(`Theme activate "${opts.themeSlug}" failed: ${(err as Error).message.trim()}`);
          }
        }
      } catch (err) {
        // Bubble up — file-write failures usually mean the site path is
        // wrong, the slug is invalid, or someone tried path traversal. None
        // are recoverable mid-flow.
        throw new Error(`Replica install failed: ${(err as Error).message}`);
      }
    }

    const sites = await listStudioSites();
    const site = sites.find((s) => s.name === name);
    if (!site) {
      throw new Error(`Studio site "${name}" not found after creation`);
    }
    return {
      status: 'ready',
      url: site.url,
      port: site.port,
      warnings,
      source: 'studio',
      siteName: site.name,
      path: resolveStudioWpRoot(site.path),
    };
  } catch (err) {
    await removeStudioSite(sitePath);
    return {
      status: 'failed',
      error: `Studio preview setup failed (site removed): ${(err as Error).message}`,
    };
  }
}
