//
// liberate_media_install MCP handler
// ==================================
// Phase 1.5: install pending media for one URL into the running replica WP
// site. Wraps `installMediaForUrl` and surfaces its structured result.
//
// Args:
//   outputDir: liberation output directory
//   url:       source URL whose media we're installing (kept for logging;
//              the underlying installer processes ALL pending media each
//              call thanks to MediaStubStore-keyed idempotency)
//   target:    { kind: 'studio', sitePath: string }   — Studio site path
//
// Studio sitePath is the per-site directory Studio created (e.g.
// ~/Studio/<slug>); the WP install root inside it is `<sitePath>/wordpress`.
//
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Handler } from '../handler-types.js';
import { installMediaForUrl, type MediaInstallResult } from '../../lib/streaming/media-install.js';

interface StudioTarget { kind: 'studio'; sitePath: string }
type Target = StudioTarget;

function parseTarget(raw: unknown): Target | string {
  if (!raw || typeof raw !== 'object') {
    return 'target must be an object with kind ("studio") + sitePath';
  }
  const t = raw as Record<string, unknown>;
  const kind = t.kind;
  const sitePath = t.sitePath;
  if (typeof sitePath !== 'string' || !sitePath) {
    return 'target.sitePath must be a non-empty string';
  }
  if (kind === 'studio') {
    return { kind, sitePath };
  }
  return 'target.kind must be "studio"';
}

/**
 * Resolve the WP install root from a Studio target by probing the on-disk
 * layout — mirrors the detection in install-theme.ts. Studio sites exist in
 * two shapes:
 *   - flat:   <sitePath>/wp-content          (current Studio versions)
 *   - nested: <sitePath>/wordpress/wp-content (older layouts)
 * Hardcoding `<sitePath>/wordpress` (the previous behavior) wrote uploads into
 * a phantom `wordpress/` subdir on flat sites, so attachments never appeared in
 * the running library. Probe instead.
 */
export function wpRootFor(target: Target): string {
  const sitePath = resolve(target.sitePath);
  if (existsSync(join(sitePath, 'wp-content'))) return sitePath;
  const nested = join(sitePath, 'wordpress');
  if (existsSync(join(nested, 'wp-content'))) return nested;
  // Neither layout found; fall back to flat (sitePath) and let the installer
  // surface a concrete copy/eval error rather than silently using a wrong dir.
  return sitePath;
}

export const mediaInstallHandler: Handler = async (args, ctx) => {
  const outputDir = args.outputDir as string | undefined;
  const url = args.url as string | undefined;
  const target = parseTarget(args.target);

  if (!outputDir || !url) {
    return ctx.errorResult('liberate_media_install requires outputDir + url');
  }
  if (typeof target === 'string') {
    return ctx.errorResult(`liberate_media_install: ${target}`);
  }

  const wpRoot = wpRootFor(target);

  let result: MediaInstallResult;
  try {
    result = await installMediaForUrl({
      outputDir,
      url,
      wpRoot,
    });
  } catch (err) {
    return ctx.errorResult(`liberate_media_install failed: ${(err as Error).message}`);
  }

  return ctx.textResult({
    ok: result.errors.length === 0,
    target: target.kind,
    counts: {
      installed: result.installed.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
    },
    // SVG routing tally (svg survival): how many SVG-origin assets uploaded
    // as SVG vs. were substituted with their PNG raster sibling, plus whether
    // safe-svg was auto-ensured for this batch.
    svg: result.svg,
    installed: result.installed,
    skipped: result.skipped,
    errors: result.errors,
  });
};
