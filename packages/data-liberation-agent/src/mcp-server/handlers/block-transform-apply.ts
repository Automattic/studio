//
// liberate_block_transform_apply
// ==============================
// Applies composed block markup to the running WP site for a given URL.
// Sequencing (per the streaming plan, Phase 3):
//
//   1. parse_blocks roundtrip validation — ensure the input is at least
//      lexically valid block markup. We don't have wp_parse_blocks() here,
//      so do a structural sanity check (matching open/close comments).
//   2. output-verify — confirm every text node in the proposed blocks is
//      a substring of the source HTML's plain text (anti-hallucination).
//   3. post-existence poll — find the post id matching `_source_url=<url>`
//      with 3 retries + 500ms/2s/5s backoff (avoid the compose-then-apply
//      race when WXR import hasn't landed yet).
//   4. Idempotency — short-circuit when block-transform-log records a
//      successful apply with the same `sourceHash`.
//   5. Apply — `wp post update <postId> --post_content=<blocks>`.
//   6. Append to block-transform-log.jsonl on success.
//
// `target` selects the application path. Studio is the only supported target;
// other kinds return a not-yet-supported error so callers handle it explicitly.
//

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import type { Handler } from '../handler-types.js';
import { verifyComposedOutput } from '../../lib/streaming/output-verify.js';
import { pollForPost } from '../../lib/streaming/post-existence-poll.js';
import {
  appendTransform,
  findLastTransform,
  type BlockTransformEntry,
} from '../../lib/streaming/block-transform-log.js';
import {
  blockMarkupRoundtrips,
  readSourceHtmlFromManifest,
  slugFromUrl,
  countBlocks,
} from '../../lib/streaming/block-markup-validate.js';
import {
  containsCustomHtmlBlock,
  customHtmlBlockError,
} from '../../lib/wordpress/block-policy.js';

const execFileAsync = promisify(execFile);

interface ApplyTarget {
  /** "studio". */
  kind?: string;
  /** Studio site path (parent dir, NOT the wordpress sub-dir). */
  studioSitePath?: string;
  /** Site URL — kept for forward compatibility with the poller opts shape. */
  siteUrl?: string;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export const blockTransformApplyHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const url = args.url as string;
  const blocks = args.blocks as string;
  const target = (args.target ?? {}) as ApplyTarget;

  if (!outputDir || !url || !blocks) {
    return ctx.errorResult(
      'liberate_block_transform_apply requires outputDir + url + blocks',
    );
  }

  // Pre-apply 1: parse_blocks roundtrip / structural sanity.
  const roundtrip = blockMarkupRoundtrips(blocks);
  if (!roundtrip.ok) {
    return ctx.errorResult(`Block markup failed roundtrip validation: ${roundtrip.reason}`);
  }

  if (containsCustomHtmlBlock(blocks)) {
    return ctx.errorResult(customHtmlBlockError('Applied post_content'));
  }

  // Pre-apply 2: output-verify against source HTML when available.
  const sourceHtml = readSourceHtmlFromManifest(outputDir, url);
  const verifyResult = sourceHtml ? verifyComposedOutput(blocks, sourceHtml) : null;
  if (verifyResult && !verifyResult.valid) {
    return ctx.errorResult(
      `Output verification failed — text not found in source: ${verifyResult.hallucinated.slice(0, 3).join(' | ')}`,
    );
  }

  // Pre-apply 3: idempotency check.
  const sourceHash = sha256(sourceHtml ?? url);
  const outputHash = sha256(blocks);
  const last = findLastTransform(outputDir, url);
  if (last && last.sourceHash === sourceHash && last.outputHash === outputHash) {
    return ctx.textResult({
      ok: true,
      url,
      skipped: true,
      reason: 'identical sourceHash + outputHash already applied',
      previousAppliedAt: last.transformedAt,
    });
  }

  // Pre-apply 4: post existence (3 retries with backoff).
  const studioSitePath = target.studioSitePath;
  if (!studioSitePath) {
    return ctx.errorResult(
      'Studio target requires `target.studioSitePath`. Pass `target: {kind: "studio", studioSitePath: "..."}` to specify the running Studio site.',
    );
  }

  const poll = await pollForPost({
    siteUrl: target.siteUrl ?? '',
    sourceUrl: url,
    studioSitePath,
  });
  if (!poll.found || !poll.postId) {
    return ctx.textResult({
      ok: false,
      url,
      skipped: true,
      reason: `Post for source URL not found after ${poll.attempts} attempts; WXR import may not have landed.`,
      pollAttempts: poll.attempts,
    });
  }

  // Apply via `studio wp post update`. We pass the blocks via a temp file
  // (-) rather than command-line argv to avoid shell quoting + length limits.
  const tmpDir = mkdtempSync(join(tmpdir(), 'dla-blocks-'));
  const blocksPath = join(tmpDir, `${poll.postId}.blocks.html`);
  writeFileSync(blocksPath, blocks);

  const warnings: string[] = [];
  try {
    await execFileAsync(
      'studio',
      [
        'wp',
        '--path',
        studioSitePath as string,
        'post',
        'update',
        String(poll.postId),
        blocksPath,
      ],
      { timeout: 60_000, maxBuffer: 50 * 1024 * 1024 },
    );
  } catch (err) {
    return ctx.errorResult(`wp post update failed: ${(err as Error).message}`);
  }

  const blocksCount = countBlocks(blocks);
  const entry: BlockTransformEntry = {
    url,
    slug: slugFromUrl(url),
    blocksCount,
    transformedAt: new Date().toISOString(),
    source: (args.source as 'heuristic' | 'ai') ?? 'ai',
    warnings,
    composedBy: (args.composedBy as string) ?? 'compose-page-blocks@v1.0',
    sourceHash,
    outputHash,
  };
  appendTransform(outputDir, entry);

  return ctx.textResult({
    ok: true,
    url,
    postId: poll.postId,
    pollAttempts: poll.attempts,
    blocksCount,
    appliedAt: entry.transformedAt,
    warnings,
  });
};
