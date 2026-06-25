//
// Shared block markup validation utilities
// =========================================
// Used by both `liberate_block_transform_apply` (write to DB) and
// `liberate_block_compose` (write to sidecar). Keeping the validation rules
// in one place ensures the compose-then-install streaming flow uses the
// same anti-hallucination guarantees as the legacy install-then-apply
// flow.
//

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Lightweight structural sanity check for block markup. WordPress's real
 * `parse_blocks` validation runs server-side; we mirror its core invariant
 * here — every `<!-- wp:foo -->` open should have a matching `<!-- /wp:foo -->`
 * close (or be self-closing with `/-->` syntax). We don't validate
 * attribute JSON; the apply path will fail loudly if attrs are malformed.
 */
export function blockMarkupRoundtrips(markup: string): { ok: true } | { ok: false; reason: string } {
  if (!markup || !markup.trim()) {
    return { ok: false, reason: 'empty markup' };
  }

  const stack: string[] = [];
  const re = /<!--\s*(\/?)wp:([a-zA-Z0-9/_-]+)([^]*?)(\/)?\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const isClose = m[1] === '/';
    const name = m[2];
    const isSelfClose = m[4] === '/';
    if (isSelfClose) continue;
    if (isClose) {
      const top = stack.pop();
      if (top !== name) {
        return {
          ok: false,
          reason: `mismatched block close: expected /wp:${top ?? '(empty)'}, got /wp:${name}`,
        };
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    return { ok: false, reason: `unclosed blocks: ${stack.join(', ')}` };
  }
  return { ok: true };
}

/** Read source HTML for a URL from `<outputDir>/screenshots/manifest.json`. */
export function readSourceHtmlFromManifest(outputDir: string, url: string): string | null {
  const manifestPath = join(outputDir, 'screenshots', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      entries?: Record<string, { html?: string }>;
    };
    const entry = manifest.entries?.[url];
    if (!entry?.html) return null;
    const htmlPath = join(outputDir, entry.html);
    if (!existsSync(htmlPath)) return null;
    return readFileSync(htmlPath, 'utf8');
  } catch {
    return null;
  }
}

/** Slug for log entries — derived from URL path, falls back to "homepage" / "page". */
export function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ?? 'homepage';
  } catch {
    return 'page';
  }
}

/** Conventional sidecar path: `<outputDir>/composed/<slug>.blocks.html`. */
export function composedSidecarPath(outputDir: string, slug: string): string {
  return join(outputDir, 'composed', `${slug}.blocks.html`);
}

/** Carried per-instance styles emitted by the normalize pass (ingest) and read
 * by the theme assembler (convert): `<outputDir>/composed/instance-styles.css`.
 * Holds the `.lib-i<hash>{…}` rules for inline styles carried as classes. */
export function instanceStylesPath(outputDir: string): string {
  return join(outputDir, 'composed', 'instance-styles.css');
}

/** Count opening block comments (excluding closing) — same heuristic both handlers use. */
export function countBlocks(markup: string): number {
  return (markup.match(/<!--\s*wp:[^/][^>]*-->/g) ?? []).length;
}
