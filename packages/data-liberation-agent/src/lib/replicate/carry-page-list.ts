//
// Carry page-list + WXR-patch helpers (carry-and-scope path)
// ==========================================================
// Pure orchestration glue shared by the carry reconstruct driver
// (`scripts/carry-reconstruct-drive.ts`) and its standalone `--list` inspector.
// Deliberately imports NO reconstruct handler, so building/inspecting the page
// list is cheap (no heavy module graph) — that's what the now-removed
// `scripts/_carry_list.py` debug tool existed for; this is the single,
// site-agnostic, page+post-aware, tested source of truth instead.
//

import { readFileSync, existsSync, readdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Read a tag's text from a WXR item block, stripping an optional CDATA wrapper. */
export function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  const cd = m[1].match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cd ? cd[1] : m[1]).trim();
}

/** Prefer the full WXR (output.wxr.full, written by `slimWxrForProvision`) over the possibly-slimmed output.wxr. */
export function wxrSource(outputDir: string): string {
  const full = join(outputDir, 'output.wxr.full');
  return existsSync(full) ? full : join(outputDir, 'output.wxr');
}

export interface CarryPage {
  slug: string;
  sourceUrl: string;
  title: string;
  postType: 'page' | 'post';
  htmlSlug: string;
  isHome?: boolean;
}

export interface BuildPageListResult {
  pages: CarryPage[];
  skipped: Array<{ postType: string; postName: string; title: string; link: string; reason: string }>;
  excluded: CarryPage[];
}

export interface BuildPageListOptions {
  /**
   * Slugs OR htmlSlugs to drop from the carry set — e.g. junk pages (`404-error-page`, `sitemap`,
   * `thank-you`) or per-site curation. A site-agnostic RUNTIME filter (passed via `EXCLUDE` env at
   * the CLI); never hardcode site-specific values in source ([[feedback_scripts_must_be_site_agnostic]]).
   */
  exclude?: string[];
}

/**
 * PURE join (no filesystem): produce the carry page list from a WXR string + the manifest entries
 * + the set of captured html stems. Exported for unit tests. `buildCarryPageList` is the fs wrapper.
 *
 * Generic across platforms:
 *  - pages: WXR `post_name` → manifest slug; the front page is captured as `homepage` (matched by
 *    root-URL `<link>` OR `post_name` `home`/`homepage`).
 *  - posts: WXR `post_name` → `post--<name>` (exact, then prefix-match for %-encoded / truncated slugs).
 *  - Shopify/Squarespace namespaced slugs (`pages--<name>`, `blogs--<blog>--<name>`): fall back to the
 *    last `--` segment (products `products--*` excluded — they're WooCommerce items, not carry pages).
 */
export function joinCarryPageList(
  wxrText: string,
  entries: Record<string, { slug?: string }>,
  htmlStems: Set<string>,
  opts: BuildPageListOptions = {},
): BuildPageListResult {
  const excludeSet = new Set(opts.exclude ?? []);
  const bySlug = new Map<string, { sourceUrl: string }>();
  for (const [url, e] of Object.entries(entries)) if (e.slug) bySlug.set(e.slug, { sourceUrl: url });

  const byLastSeg = new Map<string, string>();
  for (const slug of bySlug.keys()) {
    if (slug.startsWith('products--')) continue;
    const seg = slug.includes('--') ? slug.slice(slug.lastIndexOf('--') + 2) : slug;
    if (!byLastSeg.has(seg)) byLastSeg.set(seg, slug); // first wins (stable order)
  }

  const items = wxrText.split('<item>').slice(1).map((s) => s.split('</item>')[0]);
  const pages: CarryPage[] = [];
  const skipped: BuildPageListResult['skipped'] = [];
  const excluded: CarryPage[] = [];
  for (const it of items) {
    const postType = tag(it, 'wp:post_type');
    if (postType !== 'page' && postType !== 'post') continue; // skip attachments + nav_menu_item
    const postName = tag(it, 'wp:post_name');
    const title = tag(it, 'title');
    const link = tag(it, 'link');
    const rootLink = /^https?:\/\/[^/]+\/?$/.test(link);

    let htmlSlug: string | null = null;
    let sourceUrl = link;
    if (postType === 'page') {
      if (bySlug.has(postName)) { htmlSlug = postName; sourceUrl = bySlug.get(postName)!.sourceUrl; }
      else if (htmlStems.has(postName)) htmlSlug = postName;
      else if ((rootLink || postName === 'home' || postName === 'homepage') && bySlug.has('homepage')) {
        htmlSlug = 'homepage';
        sourceUrl = bySlug.get('homepage')!.sourceUrl;
      }
      else if (byLastSeg.has(postName)) { htmlSlug = byLastSeg.get(postName)!; sourceUrl = bySlug.get(htmlSlug)!.sourceUrl; }
    } else {
      const exact = `post--${postName}`;
      if (bySlug.has(exact)) { htmlSlug = exact; sourceUrl = bySlug.get(exact)!.sourceUrl; }
      else {
        const cand = [...bySlug.keys()].filter((k) => k.startsWith('post--') && (k.startsWith(exact) || exact.startsWith(k)));
        if (cand.length === 1) { htmlSlug = cand[0]; sourceUrl = bySlug.get(cand[0])!.sourceUrl; }
        else if (byLastSeg.has(postName)) { htmlSlug = byLastSeg.get(postName)!; sourceUrl = bySlug.get(htmlSlug)!.sourceUrl; }
      }
    }

    if (!htmlSlug || !htmlStems.has(htmlSlug)) {
      skipped.push({ postType, postName, title, link, reason: htmlSlug ? 'html-missing' : 'no-manifest-match' });
      continue;
    }
    const isHome = postType === 'page' && (htmlSlug === 'homepage' || rootLink);
    const page: CarryPage = { slug: isHome ? (postName || 'home') : postName, sourceUrl, title, postType, htmlSlug, ...(isHome ? { isHome: true } : {}) };
    if (excludeSet.has(page.slug) || excludeSet.has(htmlSlug)) excluded.push(page);
    else pages.push(page);
  }
  return { pages, skipped, excluded };
}

/** Filesystem wrapper: read `output.wxr`(.full) + `screenshots/manifest.json` + `html/` from an extraction dir. */
export function buildCarryPageList(outputDir: string, opts: BuildPageListOptions = {}): BuildPageListResult {
  const wxr = readFileSync(wxrSource(outputDir), 'utf8');
  const manifest = JSON.parse(readFileSync(join(outputDir, 'screenshots', 'manifest.json'), 'utf8'));
  const entries: Record<string, { slug?: string }> = manifest.entries ?? manifest;
  const htmlStems = new Set(readdirSync(join(outputDir, 'html')).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -'.html'.length)));
  return joinCarryPageList(wxr, entries, htmlStems, opts);
}

/**
 * Patch carry islands into the FULL WXR -> output-carry.wxr. Per-item transform with a FUNCTION
 * replacer (never a string — avoids the `$&`/`$1` footgun, see [[project_capture_document_nesting_bug]]);
 * CDATA-escapes any `]]>` in the island; leaves attachments + nav untouched. Returns counters so the
 * caller can verify the round-trip.
 */
export function buildOutputCarryWxr(outputDir: string, islandsDir: string): {
  items: number; patched: number; cdataBalanced: boolean; outPath: string;
} {
  const src = readFileSync(wxrSource(outputDir), 'utf8');
  const parts = src.split(/(<item>[\s\S]*?<\/item>)/);
  let items = 0;
  let patched = 0;
  const out = parts.map((p) => {
    if (!p.startsWith('<item>')) return p;
    items++;
    const postType = tag(p, 'wp:post_type');
    if (postType !== 'page' && postType !== 'post') return p;
    const postName = tag(p, 'wp:post_name');
    const islandPath = join(islandsDir, `${postName}.html`);
    if (!existsSync(islandPath)) return p;
    const island = readFileSync(islandPath, 'utf8').replace(/]]>/g, ']]]]><![CDATA[>');
    const replacement = `<content:encoded><![CDATA[${island}]]></content:encoded>`;
    return p.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/, () => { patched++; return replacement; });
  }).join('');
  const outPath = join(outputDir, 'output-carry.wxr');
  writeFileSync(outPath, out);
  const cdataBalanced = (out.match(/<!\[CDATA\[/g) || []).length === (out.match(/]]>/g) || []).length;
  return { items, patched, cdataBalanced, outPath };
}

/**
 * Remove STALE island files from a prior, wider-scope run. `buildOutputCarryWxr` patches a
 * WXR item whenever `<post_name>.html` EXISTS in the islands dir (and `_swap.php` only swaps
 * the slugs it's handed), so an island left over from an earlier run — e.g. a post carried in
 * a full run but excluded in a later hybrid run — would silently re-enter output-carry.wxr and
 * overwrite a now-native post. Deletes `<stem>.html` whose stem isn't in `currentSlugs`; keeps
 * `_swap.php` and any non-`.html` file. Returns the removed stems (for logging). No-op when the
 * dir is absent.
 */
export function reconcileCarryIslands(islandsDir: string, currentSlugs: string[]): string[] {
  if (!existsSync(islandsDir)) return [];
  const keep = new Set(currentSlugs);
  const removed: string[] = [];
  for (const file of readdirSync(islandsDir)) {
    if (!file.endsWith('.html')) continue;
    const stem = file.slice(0, -'.html'.length);
    if (!keep.has(stem)) {
      rmSync(join(islandsDir, file));
      removed.push(stem);
    }
  }
  return removed;
}

/**
 * PURE: slim a WXR for Studio provisioning — drop every `attachment` `<item>` and flip
 * `draft`→`publish` status (so the live preview resolves). Returns the slimmed WXR + counts.
 * A surgical text transform (no DOM reserialize), so the rest of the document is preserved
 * byte-for-byte — exactly what the import deliverable needs.
 */
export function slimWxr(wxrText: string): { wxr: string; dropped: number; flipped: number } {
  let dropped = 0;
  let flipped = 0;
  const wxr = wxrText.split(/(<item>[\s\S]*?<\/item>)/).map((part) => {
    if (!part.startsWith('<item>')) return part;
    if (/<wp:post_type>attachment<\/wp:post_type>/.test(part)) { dropped++; return ''; }
    const flippedPart = part.replace(/<wp:status>draft<\/wp:status>/g, '<wp:status>publish</wp:status>');
    if (flippedPart !== part) flipped++;
    return flippedPart;
  }).join('');
  return { wxr, dropped, flipped };
}

/**
 * FS wrapper for the carry provision step. Backs `output.wxr` up to `output.wxr.full` ONCE (the
 * pristine full WXR — `output-carry.wxr` is later rebuilt from it), then writes the slimmed WXR
 * back to `output.wxr` so `liberate_preview` imports pages/posts only — no attachment items, hence
 * no Studio ~120s blueprint-import timeout (see [[project_studio_import_heartbeat]]). Always slims
 * FROM the `.full` backup, so re-runs are idempotent; the driver restores `output.wxr` from `.full`
 * when the reconstruct finishes, so the slim is transient and the dir is never left lossy.
 */
export function slimWxrForProvision(outputDir: string): { dropped: number; flipped: number } {
  const wxrPath = join(outputDir, 'output.wxr');
  const fullPath = join(outputDir, 'output.wxr.full');
  if (!existsSync(fullPath)) copyFileSync(wxrPath, fullPath);
  const { wxr, dropped, flipped } = slimWxr(readFileSync(fullPath, 'utf8'));
  writeFileSync(wxrPath, wxr);
  return { dropped, flipped };
}
