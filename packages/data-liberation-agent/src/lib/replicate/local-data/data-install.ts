// src/lib/replicate/local-data/data-install.ts
//
// Install the WordPress-driven data model onto a running Studio site:
//   1) write the generated mu-plugins (CPT/taxonomy/meta + dla/data-card block)
//      into wp-content/mu-plugins so the type is registered on every request,
//   2) insert the taxonomy terms + content items (idempotent by _dla_item_id)
//      via `studio wp eval-file install-data.php <payload>`.
//
// The mu-plugins are written BEFORE the eval-file so the CPT exists when posts
// are inserted (mu-plugins always load under wp-cli). Mirrors the post-install
// staging convention: payloads live under <sitePath>/.dla-scripts so Studio's
// wp-cli (which rejects host paths) can read them from the mounted site dir.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataModel } from './types.js';
import { buildCptMuPlugin, cptMuPluginFilename } from './cpt-plugin.js';
import { buildDataCardPlugin, dataCardPluginFilename } from './card-render-php.js';
import { installMediaFiles, type MediaFile, type MediaFilesResult } from '../../streaming/media-install.js';

const execFileAsync = promisify(execFile);

/** Injectable exec seam (tests stub it; production runs `studio wp`). */
export type ExecFn = (
  file: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number },
) => Promise<{ stdout: string; stderr: string }>;

const INSTALL_DATA_SCRIPT_HOST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'preview',
  'scripts',
  'install-data.php',
);

const SCRIPTS_SUBDIR = '.dla-scripts';
const SCRIPTS_VFS_PREFIX = '/wordpress';

/** The eval-file payload (terms + items + field list) for install-data.php. */
export interface DataPayload {
  cpt: string;
  taxonomy: string;
  fields: string[];
  terms: Array<{ slug: string; label: string }>;
  items: Array<{
    id: string;
    title: string;
    content: string;
    terms: string[];
    meta: Record<string, string | number | boolean>;
    gallery: Array<{ caption: string; url?: string }>;
  }>;
}

/** Build the JSON payload install-data.php consumes (pure; unit-tested). */
export function buildDataPayload(model: DataModel): DataPayload {
  return {
    cpt: model.cpt.slug,
    taxonomy: model.taxonomy.slug,
    fields: model.fields.map((f) => f.key),
    terms: model.taxonomy.terms.map((t) => ({ slug: t.slug, label: t.label })),
    items: model.items.map((it) => ({
      id: it.id,
      title: it.title,
      content: it.content ?? '',
      terms: it.terms,
      meta: it.meta,
      gallery: it.gallery,
    })),
  };
}

/** Write the CPT + data-card mu-plugins into wp-content/mu-plugins. Returns the
 *  filenames written. */
export function writeDataMuPlugins(wpRoot: string, model: DataModel): string[] {
  const dir = join(wpRoot, 'wp-content', 'mu-plugins');
  mkdirSync(dir, { recursive: true });
  const cptFile = cptMuPluginFilename(model);
  writeFileSync(join(dir, cptFile), buildCptMuPlugin(model));
  const written = [cptFile];
  if (model.card) {
    const cardFile = dataCardPluginFilename(model);
    writeFileSync(join(dir, cardFile), buildDataCardPlugin(model));
    written.push(cardFile);
  }
  return written;
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']);

export function collectModelImages(model: DataModel, sourceDir: string): Array<{ relPath: string; absPath: string }> {
  const sourceRoot = resolve(sourceDir);
  const insidePrefix = sourceRoot.endsWith(sep) ? sourceRoot : `${sourceRoot}${sep}`;
  const seen = new Set<string>();
  const images: Array<{ relPath: string; absPath: string }> = [];

  const consider = (value: string) => {
    const relPath = normalizeModelMediaPath(value);
    if (!relPath || seen.has(relPath)) return;

    const absPath = resolve(sourceRoot, relPath);
    if (!absPath.startsWith(insidePrefix)) return;
    if (!IMAGE_EXTENSIONS.has(extname(absPath).toLowerCase())) return;

    try {
      if (!statSync(absPath).isFile()) return;
    } catch {
      return;
    }

    seen.add(relPath);
    images.push({ relPath, absPath });
  };

  for (const item of model.items) {
    for (const value of Object.values(item.meta)) {
      if (typeof value === 'string') consider(value);
    }
    for (const image of item.gallery ?? []) {
      if (typeof image.url === 'string') consider(image.url);
    }
  }

  return images;
}

function normalizeModelMediaPath(value: string): string {
  return value.replace(/^(?:\.\/)+/, '');
}

function rewriteModelMediaUrls(model: DataModel, relToLocalUrl: Map<string, string>): void {
  if (relToLocalUrl.size === 0) return;

  for (const item of model.items) {
    for (const [key, value] of Object.entries(item.meta)) {
      if (typeof value !== 'string') continue;
      const localUrl = relToLocalUrl.get(normalizeModelMediaPath(value));
      if (localUrl) item.meta[key] = localUrl;
    }
    for (const image of item.gallery ?? []) {
      if (typeof image.url !== 'string') continue;
      const localUrl = relToLocalUrl.get(normalizeModelMediaPath(image.url));
      if (localUrl) image.url = localUrl;
    }
  }
}

export interface InstallDataOpts {
  model: DataModel;
  /** Studio site path on host (e.g. ~/Studio/maison). */
  studioSitePath: string;
  /** WP root (dir containing wp-content); usually resolved from studioSitePath. */
  wpRoot: string;
  /** Local static site source directory; used to import card/gallery images. */
  sourceDir?: string;
  /** Injected media installer for tests. */
  _installMedia?: typeof installMediaFiles;
  /** Injected exec for tests. */
  exec?: ExecFn;
  /** Injected unique suffix for the payload filename (tests pass a fixed value). */
  uniqueSuffix?: string;
}

export interface InstallDataResult {
  muPlugins: string[];
  inserted: number;
  updated: number;
  /** Posts left untouched because a human edited them after the last import. */
  skippedModified: number;
  /** Items whose slug was already owned by a non-DLA post. */
  collisions: number;
  terms: number;
  /** WordPress seed defaults ("Hello world!" / "Sample Page") trashed so they
   *  don't pollute the query loops. */
  defaultsTrashed: number;
  /** Source-local card/gallery images imported into WP media. */
  mediaInstalled: number;
  /** Non-fatal media import errors; source paths are left unchanged. */
  mediaErrors: Array<{ sourceUrl: string; error: string }>;
  /** Raw wp-cli stdout (for diagnostics). */
  raw: string;
}

/**
 * Provision the data model on the Studio site: write mu-plugins, then run the
 * idempotent term/post insert. Throws if the eval-file output can't be parsed.
 */
export async function installLocalData(opts: InstallDataOpts): Promise<InstallDataResult> {
  const { model, studioSitePath, wpRoot } = opts;
  const exec = opts.exec ?? (execFileAsync as unknown as ExecFn);

  const muPlugins = writeDataMuPlugins(wpRoot, model);
  let mediaInstalled = 0;
  const mediaErrors: MediaFilesResult['errors'] = [];

  if (opts.sourceDir) {
    const images = collectModelImages(model, opts.sourceDir);
    if (images.length > 0) {
      const files: MediaFile[] = images.map((image) => ({
        absPath: image.absPath,
        sourceUrl: image.relPath,
      }));
      try {
        const media = await (opts._installMedia ?? installMediaFiles)({ files, wpRoot });
        mediaInstalled = media.installed.length;
        mediaErrors.push(...media.errors);
        rewriteModelMediaUrls(
          model,
          new Map(media.installed.map((entry) => [entry.sourceUrl, entry.localUrl])),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        mediaErrors.push(...images.map((image) => ({ sourceUrl: image.relPath, error: message })));
      }
    }
  }

  // Stage script + payload under the mounted site dir.
  const scriptsDir = join(studioSitePath, SCRIPTS_SUBDIR);
  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(INSTALL_DATA_SCRIPT_HOST, join(scriptsDir, 'install-data.php'));
  const scriptVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/install-data.php`;

  const suffix = opts.uniqueSuffix ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payloadName = `install-data-${suffix}.json`;
  writeFileSync(join(scriptsDir, payloadName), JSON.stringify(buildDataPayload(model)));
  const payloadVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/${payloadName}`;

  const { stdout } = await exec(
    'studio',
    ['wp', '--path', studioSitePath, 'eval-file', scriptVfs, payloadVfs],
    { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );

  const raw = stdout.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`install-data.php produced no JSON result: ${raw.slice(0, 400)}`);
  }
  const parsed = JSON.parse(match[0]) as {
    inserted?: number;
    updated?: number;
    skippedModified?: number;
    collisions?: number;
    terms?: number;
    defaultsTrashed?: number;
    error?: string;
  };
  if (parsed.error) {
    throw new Error(`install-data.php error: ${parsed.error}`);
  }
  return {
    muPlugins,
    inserted: parsed.inserted ?? 0,
    updated: parsed.updated ?? 0,
    skippedModified: parsed.skippedModified ?? 0,
    collisions: parsed.collisions ?? 0,
    terms: parsed.terms ?? 0,
    defaultsTrashed: parsed.defaultsTrashed ?? 0,
    mediaInstalled,
    mediaErrors,
    raw,
  };
}
