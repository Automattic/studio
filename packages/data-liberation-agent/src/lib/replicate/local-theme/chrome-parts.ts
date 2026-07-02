// src/lib/replicate/local-theme/chrome-parts.ts
//
// Local DLA chrome helpers that remain after the engine siteToTheme adoption.
// Header/footer/mount builders now come from @automattic/blocks-engine/theme.
// DLA keeps the sidebar carry helper because the B8b onRefine path still uses
// it to preserve page-local layout rails exactly.
import { rewriteInternalHrefs } from '../local-site/href-rewrite.js';
import type { Section } from '../local-site/types.js';

export function buildCarriedSidebarPart(
  sidebar: Section,
  opts: {
    pageSlugs?: string[];
  } = {},
): string {
  let html = sidebar.html;
  if (opts.pageSlugs?.length) html = rewriteInternalHrefs(html, opts.pageSlugs);
  // Preserve source chrome structure: docs sidebars often carry a `.sidebar-nav`
  // nav plus a per-page `.toc-list`; block emission flattens plain nav wrappers.
  return html.trim();
}
