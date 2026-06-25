// src/lib/replicate/local-data/inject-query-loops.ts
//
// Splice query loops into composed page markup. An empty JS-mount div like
// `<div id="newestGrid" class="obj-grid obj-grid--4"></div>` is emitted by the
// normal compose path as an EMPTY core/group carrying the mount id as its
// `anchor`:
//
//   <!-- wp:group {"anchor":"newestGrid","tagName":"div","className":"obj-grid ..."} -->
//   <div id="newestGrid" class="wp-block-group obj-grid obj-grid--4"></div>
//   <!-- /wp:group -->
//
// For each model mount we replace that whole (empty) group block with the
// core/query > core/post-template > dla/data-card markup from buildQueryLoop,
// and collect the li-flatten CSS. Matching is by the group's anchor === mount id
// (deterministic, no fuzzy DOM join); non-empty groups are left alone (a mount
// that somehow carries content is surfaced, never silently clobbered).
import type { MountSpec } from './types.js';
import { buildQueryLoop } from './query-loop.js';

export interface InjectQueryLoopsResult {
  markup: string;
  /** Mount ids that were replaced with a query loop. */
  injected: string[];
  /** Mount ids present in the model but not found as an empty group here. */
  missing: string[];
  /** Concatenated li-flatten CSS for the injected loops. */
  css: string;
}

import { anchorId, escapeRegExp as escapeRe } from './string-utils.js';

/**
 * Replace each mount's empty anchor-group in `markup` with its query loop.
 * Mounts whose id isn't present (or whose group isn't empty) are reported in
 * `missing` and left untouched.
 */
export function injectQueryLoops(markup: string, mounts: MountSpec[]): InjectQueryLoopsResult {
  let out = markup;
  const injected: string[] = [];
  const missing: string[] = [];
  const cssChunks: string[] = [];

  mounts.forEach((mount, index) => {
    const id = anchorId(mount.selector);
    if (!id) {
      missing.push(mount.selector);
      return;
    }
    // The empty anchor-group: open delimiter carrying "anchor":"<id>", the empty
    // mount div, then the matching close. Inner div is asserted empty (><) so a
    // group that gained content is not swallowed.
    const re = new RegExp(
      `<!-- wp:group\\s+\\{[^{}]*"anchor":"${escapeRe(id)}"[^{}]*\\}\\s*-->` +
        `\\s*<div id="${escapeRe(id)}"[^>]*>\\s*</div>\\s*` +
        `<!-- /wp:group -->`,
    );
    if (!re.test(out)) {
      missing.push(id);
      return;
    }
    const loop = buildQueryLoop(mount, index);
    out = out.replace(re, () => loop.markup);
    injected.push(id);
    if (loop.css) cssChunks.push(loop.css);
  });

  return { markup: out, injected, missing, css: cssChunks.join('\n') };
}
