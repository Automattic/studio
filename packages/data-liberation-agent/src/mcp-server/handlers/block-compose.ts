//
// liberate_block_compose
// =======================
// Validates composed block markup and writes it to a sidecar file
// (`<outputDir>/composed/<slug>.blocks.html`) for the streaming watch
// loop to pick up before the post is inserted into WordPress. This is
// the **compose-then-install** counterpart to
// `liberate_block_transform_apply` (install-then-update).
//
// Why a separate tool: the streaming flow buffers extracted URLs and
// only installs them once the design foundation exists, so the first
// (and only) `wp_insert_post` carries block markup as `post_content`.
// The agent that produces the markup needs a way to hand the result
// back to the runner WITHOUT touching the database. This handler is
// that hand-off — same validation rules as apply (markup roundtrip +
// output-verify against source HTML), same idempotency log, but no
// `wp post update`.
//
// The runner reads `<outputDir>/composed/<slug>.blocks.html` after the
// agent returns and passes the contents as `installPost.contentOverride`.
//

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Handler } from '../handler-types.js';
import { verifyComposedOutput } from '../../lib/streaming/output-verify.js';
import {
  appendTransform,
  findLastTransform,
  type BlockTransformEntry,
} from '../../lib/streaming/block-transform-log.js';
import {
  blockMarkupRoundtrips,
  readSourceHtmlFromManifest,
  composedSidecarPath,
  countBlocks,
} from '../../lib/streaming/block-markup-validate.js';
import {
  containsCustomHtmlBlock,
  customHtmlBlockError,
} from '../../lib/wordpress/block-policy.js';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export const blockComposeHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string;
  const url = args.url as string;
  const slug = args.slug as string;
  const blocks = args.blocks as string;
  const sourceHtmlArg = args.sourceHtml as string | undefined;
  const composedBy = (args.composedBy as string) ?? 'compose-page-blocks@v1.0';
  const source = (args.source as 'heuristic' | 'ai') ?? 'ai';

  if (!outputDir || !url || !slug || !blocks) {
    return ctx.errorResult(
      'liberate_block_compose requires outputDir + url + slug + blocks',
    );
  }

  // Validation gate 1: markup is structurally well-formed.
  const roundtrip = blockMarkupRoundtrips(blocks);
  if (!roundtrip.ok) {
    return ctx.errorResult(`Block markup failed roundtrip validation: ${roundtrip.reason}`);
  }

  if (containsCustomHtmlBlock(blocks)) {
    return ctx.errorResult(customHtmlBlockError('Composed post_content'));
  }

  // Validation gate 2: every text node in the proposed blocks must appear
  // in the source HTML (anti-hallucination). Same rule as apply — if the
  // caller didn't pass sourceHtml, fall back to reading from the
  // screenshot manifest.
  const sourceHtml = sourceHtmlArg ?? readSourceHtmlFromManifest(outputDir, url) ?? null;
  if (sourceHtml) {
    const verifyResult = verifyComposedOutput(blocks, sourceHtml);
    if (!verifyResult.valid) {
      return ctx.errorResult(
        `Output verification failed — text not found in source: ${verifyResult.hallucinated.slice(0, 3).join(' | ')}`,
      );
    }
  }

  // Idempotency: if we already composed identical input → output, the
  // sidecar should already be on disk. Short-circuit so resume runs
  // don't re-write or re-log.
  const sourceHash = sha256(sourceHtml ?? url);
  const outputHash = sha256(blocks);
  const last = findLastTransform(outputDir, url);
  const sidecarPath = composedSidecarPath(outputDir, slug);
  if (last && last.sourceHash === sourceHash && last.outputHash === outputHash) {
    return ctx.textResult({
      ok: true,
      url,
      slug,
      composedPath: sidecarPath,
      skipped: true,
      reason: 'identical sourceHash + outputHash already composed',
      previousAt: last.transformedAt,
    });
  }

  // Write sidecar atomically-ish (writeFileSync + mkdir parents). The
  // runner reads this exact path; mismatch → installPost falls back to
  // raw HTML (NO_AGENT path), so the contract is "the file at this path
  // is the canonical block markup for <slug>".
  try {
    mkdirSync(dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, blocks, 'utf8');
  } catch (err) {
    return ctx.errorResult(`Failed to write composed sidecar: ${(err as Error).message}`);
  }

  // Append to the same block-transform-log apply uses, so downstream
  // tooling (audit, idempotency checks) sees a unified history.
  const entry: BlockTransformEntry = {
    url,
    slug,
    blocksCount: countBlocks(blocks),
    transformedAt: new Date().toISOString(),
    source,
    warnings: [],
    composedBy,
    sourceHash,
    outputHash,
  };
  appendTransform(outputDir, entry);

  return ctx.textResult({
    ok: true,
    url,
    slug,
    composedPath: sidecarPath,
    blocksCount: entry.blocksCount,
    composedAt: entry.transformedAt,
  });
};
