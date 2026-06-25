// src/lib/replicate/local-theme/page-plan.ts
//
// Build the WP-page install plan from stage 1a artifacts: one PageItem per
// LocalPage whose composed sidecar exists, content = sidecar block markup.
// sourceUrl is a synthetic stable key (`local-site:<root>#<slug>`) — installPost
// stores it as _source_url meta, which is what makes re-runs idempotent
// (update-in-place) and is the CP1 reconcile join key later.
//
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageItem } from '../../wxr/index.js';
import type { LocalSite } from '../local-site/types.js';

export interface PagePlan {
  items: PageItem[];
  homeSlug: string | null;
  missingSidecars: string[];
}

// Note: stability depends on site.root being stable. Moving the ingest dir breaks this key — re-running from a new path creates duplicate WP pages.
export function localSourceUrl(siteRoot: string, slug: string): string {
  return `local-site:${siteRoot}#${slug}`;
}

export function buildPagePlan(site: LocalSite, outputDir: string): PagePlan {
  const items: PageItem[] = [];
  const missingSidecars: string[] = [];
  let id = 1;
  for (const page of site.pages) {
    const sidecar = join(outputDir, 'composed', `${page.slug}.blocks.html`);
    if (!existsSync(sidecar)) {
      missingSidecars.push(page.slug);
      continue;
    }
    items.push({
      id: id++,
      type: 'page',
      title: page.title || page.slug,
      slug: page.slug,
      content: readFileSync(sidecar, 'utf8'),
      excerpt: '',
      date: '',
      parent: 0,
      menuOrder: 0,
      author: '',
      seoTitle: '',
      seoDescription: '',
      sourceUrl: localSourceUrl(site.root, page.slug),
    });
  }
  // 'home' is the canonical slug: slugFromRelPath normalizes index.html → 'home'
  const homeSlug = items.some((i) => i.slug === 'home') ? 'home' : null;
  return { items, homeSlug, missingSidecars };
}
