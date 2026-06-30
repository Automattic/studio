//
// Post-existence poller
// =====================
// Resolves the WordPress post ID for a given source URL by querying the
// running site's `_source_url` postmeta. Used by `liberate_block_transform_apply`
// to avoid the compose-then-apply race: compose can finish before the WXR
// import finishes landing the post, so we poll a small number of times with
// backoff before giving up.
//
// Backoff schedule: 500ms, 2000ms, 5000ms (3 retries). After all 3 attempts
// fail, the apply tool skips with a warning and the page keeps its raw
// `post_content` from WXR import.
//
// Studio path is the v1 target. We invoke `studio wp post list` with a
// `--meta_key=_source_url --meta_value=<url> --field=ID --format=json`
// filter and parse the resulting JSON array. Studio runs WP-CLI inside the
// site VFS, so we get the live post ID even though Studio uses SQLite under
// the hood.
//
// Only Studio is supported. Non-Studio callers receive a not-yet-supported
// error from liberate_block_transform_apply before reaching this path.
//

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PostExistencePollOpts {
  /** Running replica URL e.g. http://localhost:9400. Kept for caller compatibility. */
  siteUrl: string;
  /** `_source_url` meta value to match against. */
  sourceUrl: string;
  /** Studio site path passed to `studio wp --path <studioSitePath>`. */
  studioSitePath?: string;
  /**
   * Override the underlying CLI runner. Tests inject a fake; production
   * defaults to spawning `studio wp`.
   */
  runner?: PollRunner;
  /** Override the backoff schedule (ms). Defaults to [500, 2000, 5000]. */
  backoffMs?: number[];
  /** Sleep function — overridden in tests so we don't wait for real backoff. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PostExistenceResult {
  found: boolean;
  postId: number | null;
  attempts: number;
}

/** Inject point for tests — replicates the relevant `execFile` shape. */
export type PollRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;

const DEFAULT_BACKOFF_MS = [500, 2000, 5000];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultRunner: PollRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout };
};

/** Parse the stdout of `wp post list ... --field=ID --format=json` into a number. */
function parsePostId(stdout: string): number | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  // wp-cli with --format=json --field=ID returns `[123]` or `[]`. Some
  // wrappers prepend status lines before the JSON; find the first `[`.
  const start = trimmed.indexOf('[');
  if (start < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const first = parsed[0];
  if (typeof first === 'number') return first;
  if (typeof first === 'string' && /^\d+$/.test(first)) return Number(first);
  return null;
}

/**
 * Poll the running WP for a post matching `_source_url` meta. 3 retries with
 * 500ms / 2000ms / 5000ms backoff. Returns `{found, postId, attempts}`.
 */
export async function pollForPost(
  opts: PostExistencePollOpts,
): Promise<PostExistenceResult> {
  const runner = opts.runner ?? defaultRunner;
  const sleep = opts.sleep ?? defaultSleep;
  const schedule = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = schedule.length;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let postId: number | null = null;
    try {
      if (opts.studioSitePath) {
        const args = [
          'wp',
          '--path',
          opts.studioSitePath,
          'post',
          'list',
          `--meta_key=_source_url`,
          `--meta_value=${opts.sourceUrl}`,
          '--post_type=any',
          '--post_status=any',
          '--field=ID',
          '--format=json',
        ];
        const { stdout } = await runner('studio', args);
        postId = parsePostId(stdout);
      }
    } catch {
      // Treat runner failures as "not found this attempt" — try again.
      postId = null;
    }

    if (postId !== null && postId > 0) {
      return { found: true, postId, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      await sleep(schedule[attempt - 1]);
    }
  }

  return { found: false, postId: null, attempts: maxAttempts };
}
