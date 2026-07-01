//
// Per-URL post install
// ====================
// Inserts one extracted WXR item (page/post/product) into a running Studio
// site via `studio wp eval-file install-post.php <json>`. Idempotent —
// install-post.php looks up by `_source_url` meta first.
//
// Used by the watch loop's per-URL incremental flow: as each URL is
// extracted, the resulting WxrItem is handed to installPost so the running
// site receives content URL by URL rather than via a final batch import.
//
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WxrItem, PageItem, PostItem } from '../wxr/index.js';

const execFileAsync = promisify(execFile);

/** Vendored PHP file that performs the wp_insert_post call. */
const INSTALL_POST_SCRIPT_HOST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'preview',
  'scripts',
  'install-post.php',
);

const SCRIPTS_SUBDIR = '.dla-scripts';
const SCRIPTS_VFS_PREFIX = '/wordpress';

export interface InstallPostOpts {
  /** Single WxrItem to install. Only `page` / `post` are supported by v1. */
  item: WxrItem;
  /** Liberation outputDir (anchor for vendored script + JSON payload). */
  outputDir: string;
  /** Studio site path on host (e.g. ~/Studio/example-com). */
  studioSitePath: string;
  /** Optional content override — used after media-url-rewrite swaps source URLs for local upload URLs. */
  contentOverride?: string;
}

export interface InstallPostResult {
  sourceUrl: string;
  postId: number | null;
  action: 'inserted' | 'updated' | 'error';
  error?: string;
}

/**
 * Install one post into the running Studio site. Returns null when the item
 * isn't a supported post type (attachment, nav menu items, terms — these
 * have their own install paths).
 */
export async function installPost(opts: InstallPostOpts): Promise<InstallPostResult | null> {
  const { item, outputDir, studioSitePath, contentOverride } = opts;
  if (item.type !== 'page' && item.type !== 'post') {
    return null;
  }
  const post = item as PageItem | PostItem;

  if (!post.sourceUrl) {
    return {
      sourceUrl: '',
      postId: null,
      action: 'error',
      error: 'missing sourceUrl meta — install requires _source_url for idempotency',
    };
  }

  // Stage the script + JSON payload under <sitePath>/.dla-scripts/.
  // Studio's wp-cli rejects host paths, so payloads must live inside the
  // mounted site dir.
  const scriptsDir = join(studioSitePath, SCRIPTS_SUBDIR);
  mkdirSync(scriptsDir, { recursive: true });
  const scriptVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/install-post.php`;
  const payloadHost = join(scriptsDir, `install-post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const payloadVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/${payloadHost.split('/').pop()}`;

  // Copy script in (overwrite-safe; matches studio.ts pattern).
  const { copyFileSync } = await import('node:fs');
  const scriptHost = join(scriptsDir, 'install-post.php');
  copyFileSync(INSTALL_POST_SCRIPT_HOST, scriptHost);

  const payload = {
    _source_url: post.sourceUrl,
    post_type: post.type,
    title: post.title,
    slug: post.slug,
    content: contentOverride ?? post.content,
    excerpt: post.excerpt ?? '',
    date: post.date ?? '',
    post_status: 'publish',
    meta: {
      ...(post.seoTitle ? { _seo_title: post.seoTitle } : {}),
      ...(post.seoDescription ? { _seo_description: post.seoDescription } : {}),
    },
  };
  writeFileSync(payloadHost, JSON.stringify(payload), 'utf8');

  try {
    const { stdout } = await execFileAsync(
      'studio',
      ['wp', '--path', studioSitePath, 'eval-file', scriptVfs, payloadVfs],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    const trimmed = stdout.trim();
    // Studio's wp-cli wrapper sometimes prefixes lines; pull the JSON object out.
    const jsonStart = trimmed.indexOf('{');
    const jsonEnd = trimmed.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      return { sourceUrl: post.sourceUrl, postId: null, action: 'error', error: `unexpected stdout: ${trimmed.slice(0, 200)}` };
    }
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { post_id: number | null; action: string; error?: string };
    return {
      sourceUrl: post.sourceUrl,
      postId: parsed.post_id ?? null,
      action: parsed.action === 'inserted' ? 'inserted' : parsed.action === 'updated' ? 'updated' : 'error',
      error: parsed.error,
    };
  } catch (err) {
    // execFileAsync errors carry stderr/stdout on the Error object — the
    // default `.message` is just "Command failed: <argv>" with no PHP
    // detail. Pull stderr (and stdout when present) into the surfaced
    // error so the watch.log shows what install-post.php actually said.
    const e = err as Error & { stderr?: string; stdout?: string; code?: number };
    const parts: string[] = [e.message];
    if (e.stderr && e.stderr.trim()) parts.push(`stderr: ${e.stderr.trim().slice(-1000)}`);
    if (e.stdout && e.stdout.trim()) parts.push(`stdout: ${e.stdout.trim().slice(-1000)}`);
    return {
      sourceUrl: post.sourceUrl,
      postId: null,
      action: 'error',
      error: parts.join(' | '),
    };
  }
}
