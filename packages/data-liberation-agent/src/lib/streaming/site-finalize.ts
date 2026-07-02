//
// Site finalize (one-shot)
// ========================
// Applies the post-install site finalization writes — option updates
// (blogname etc.), per-page _wp_page_template assigns, and the static
// front-page pair — in ONE `studio wp eval-file site-finalize.php <json>`
// call, via the same VFS bridging install-post.ts uses.
//
// Why one call: Studio's IPC layer flakes on bursts of individual argv
// commands ("Timeout waiting for response to message wp-cli-command: No
// activity for 120s") while eval-file invocations succeed reliably — one
// IPC slot, values shipped via JSON file rather than argv. On a fresh site
// a dropped blogname (the site-title block renders the wrong brand) or a
// dropped _wp_page_template assign (wrong template) is a structural parity
// failure the repair loop cannot fix, so these writes ride the reliable
// channel.
//
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

/** Vendored PHP file that performs the option/meta writes. */
const SITE_FINALIZE_SCRIPT_HOST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'preview',
  'scripts',
  'site-finalize.php',
);

const SCRIPTS_SUBDIR = '.dla-scripts';
const SCRIPTS_VFS_PREFIX = '/wordpress';

export interface SiteFinalizePayload {
  /** wp option updates to apply (blogname etc.). */
  options: Record<string, string>;
  /** _wp_page_template assigns. `slug` rides along for warning text only —
   * the PHP keys its error items as `template:<slug>`. */
  templateAssigns: Array<{ postId: number; slug: string; template: string }>;
  /** When set: show_on_front=page + page_on_front=<id> (applied as a pair). */
  frontPageId?: number;
}

export interface SiteFinalizeResult {
  /** False when any item errored (per-item granularity in `errors`). */
  ok: boolean;
  applied: { options: string[]; templates: number[]; frontPage: boolean };
  errors: Array<{ item: string; error: string }>;
}

export interface FinalizeSiteOpts {
  payload: SiteFinalizePayload;
  /** Studio site path on host (e.g. ~/Studio/example-com). */
  studioSitePath: string;
}

/** Pure: pull the result JSON out of (possibly prefixed) wp-cli stdout.
 * Studio's wp-cli wrapper sometimes prefixes lines — same extraction
 * install-post.ts uses. Throws on stdout with no JSON object (the caller
 * treats that as a whole-call failure). */
export function parseFinalizeStdout(stdout: string): SiteFinalizeResult {
  const trimmed = stdout.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`unexpected stdout: ${trimmed.slice(0, 200)}`);
  }
  const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as {
    ok?: unknown;
    applied?: { options?: string[]; templates?: number[]; frontPage?: unknown };
    errors?: Array<{ item: string; error: string }>;
  };
  return {
    ok: parsed.ok === true,
    applied: {
      options: parsed.applied?.options ?? [],
      templates: parsed.applied?.templates ?? [],
      frontPage: parsed.applied?.frontPage === true,
    },
    errors: parsed.errors ?? [],
  };
}

/**
 * Apply the finalize payload to the running Studio site in one eval-file
 * round-trip. Per-item failures come back in `result.errors` (the call
 * still resolves); transport-level failures — exec error, timeout, garbage
 * stdout — REJECT, so callers can map them to a single whole-call warning.
 */
export async function finalizeSite(opts: FinalizeSiteOpts): Promise<SiteFinalizeResult> {
  const { payload, studioSitePath } = opts;

  // Nothing to apply → succeed without an IPC round-trip (and without
  // staging any files into the site dir).
  if (
    Object.keys(payload.options).length === 0 &&
    payload.templateAssigns.length === 0 &&
    payload.frontPageId === undefined
  ) {
    return { ok: true, applied: { options: [], templates: [], frontPage: false }, errors: [] };
  }

  // Stage the script + JSON payload under <sitePath>/.dla-scripts/.
  // Studio's wp-cli rejects host paths, so payloads must live inside the
  // mounted site dir (same bridging install-post.ts uses).
  const scriptsDir = join(studioSitePath, SCRIPTS_SUBDIR);
  mkdirSync(scriptsDir, { recursive: true });
  const scriptVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/site-finalize.php`;
  const payloadHost = join(scriptsDir, `site-finalize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  const payloadVfs = `${SCRIPTS_VFS_PREFIX}/${SCRIPTS_SUBDIR}/${payloadHost.split('/').pop()}`;

  // Copy script in (overwrite-safe; matches install-post.ts pattern).
  const scriptHost = join(scriptsDir, 'site-finalize.php');
  copyFileSync(SITE_FINALIZE_SCRIPT_HOST, scriptHost);
  writeFileSync(payloadHost, JSON.stringify(payload), 'utf8');

  try {
    const { stdout } = await execFileAsync(
      'studio',
      ['wp', '--path', studioSitePath, 'eval-file', scriptVfs, payloadVfs],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
    );
    return parseFinalizeStdout(stdout);
  } catch (err) {
    // execFileAsync errors carry stderr/stdout on the Error object — the
    // default `.message` is just "Command failed: <argv>" with no PHP
    // detail. Pull stderr (and stdout when present) into the surfaced
    // error so the caller's warning shows what site-finalize.php said.
    const e = err as Error & { stderr?: string; stdout?: string };
    const parts: string[] = [e.message];
    if (e.stderr && e.stderr.trim()) parts.push(`stderr: ${e.stderr.trim().slice(-1000)}`);
    if (e.stdout && e.stdout.trim()) parts.push(`stdout: ${e.stdout.trim().slice(-1000)}`);
    throw new Error(parts.join(' | '));
  }
}
