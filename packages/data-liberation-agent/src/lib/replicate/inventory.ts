//
// Replicate Inventory
// ===================
// Reads a liberation outputDir and returns a structured archetype inventory
// keyed off `classifyUrl` types (homepage, page, post, product, gallery, event).
// Used by `liberate_replicate_inventory` to give the replicate skill its
// per-archetype counts and a small set of representative pages per archetype
// to inspect (vision + html).
//
// Inputs read:
//   <outputDir>/output.wxr             — content (post types + sourceUrl meta)
//   <outputDir>/products.jsonl         — Woo products (line-counted only)
//   <outputDir>/screenshots/manifest.json — URL → file map
//   <outputDir>/design-foundation.json — presence check
//
// Representative selection: per archetype, pick up to 3 URLs with the largest
// rendered HTML file. Bigger HTML is a coarse proxy for "more sections,"
// which is what the agent wants to inspect for layout variety.
//
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readWxr } from '../wxr/index.js';
import { classifyUrl, type UrlType } from '../extraction/sitemap.js';
import type { WxrItem } from '../wxr/index.js';

export interface ArchetypeRepresentative {
  url: string;
  slug: string;
  /** Path relative to outputDir (e.g. "screenshots/desktop/pages--about.png"). */
  screenshot: string | null;
  /** Path relative to outputDir for the .scrolled.png variant (or null). */
  scrolledScreenshot: string | null;
  /** Path relative to outputDir for the rendered HTML (or null). */
  html: string | null;
  /** Bytes — used as the section-count proxy that drove selection. */
  htmlBytes: number;
  /** WXR item id, or null when the URL was screenshotted but not extracted. */
  wxrItemId: number | null;
}

export interface ArchetypeBucket {
  count: number;
  urls: string[];
}

export interface ReplicateInventory {
  outputDir: string;
  siteSlug: string;
  /** Per-archetype counts and source URLs (every URL classified to that type). */
  archetypes: Record<UrlType, ArchetypeBucket>;
  /** Up to 3 representatives per archetype. Empty array when archetype count is 0. */
  representatives: Record<UrlType, ArchetypeRepresentative[]>;
  /** Path to design-foundation.json (relative to outputDir) — null when absent. */
  designFoundationPath: string | null;
  designFoundationExists: boolean;
  /** Number of products in products.jsonl (0 when file is absent or empty). */
  productCount: number;
  /** True only when at least one product was emitted. */
  hasProducts: boolean;
  hasWxr: boolean;
  /** Heads-up notes for the agent — non-fatal observations. */
  notes: string[];
}

const ARCHETYPES: UrlType[] = ['homepage', 'page', 'post', 'product', 'gallery', 'event'];
const REP_PER_ARCHETYPE = 3;

interface ManifestEntry {
  slug?: string;
  html?: string;
  desktop?: string;
  desktopScrolled?: string;
}

interface Manifest {
  version?: number;
  entries?: Record<string, ManifestEntry>;
}

function emptyBuckets(): Record<UrlType, ArchetypeBucket> {
  const out = {} as Record<UrlType, ArchetypeBucket>;
  for (const a of ARCHETYPES) out[a] = { count: 0, urls: [] };
  return out;
}

function emptyRepresentatives(): Record<UrlType, ArchetypeRepresentative[]> {
  const out = {} as Record<UrlType, ArchetypeRepresentative[]>;
  for (const a of ARCHETYPES) out[a] = [];
  return out;
}

function tryReadManifest(outputDir: string): Manifest {
  const path = join(outputDir, 'screenshots', 'manifest.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function countProductsJsonl(outputDir: string): number {
  const path = join(outputDir, 'products.jsonl');
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.size === 0) return 0;
  // Count non-empty lines without buffering the entire file twice.
  const text = readFileSync(path, 'utf8');
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) n++;
  }
  return n;
}

function htmlBytesFor(outputDir: string, htmlRel: string | undefined): number {
  if (!htmlRel) return 0;
  try {
    return statSync(join(outputDir, htmlRel)).size;
  } catch {
    return 0;
  }
}

/**
 * Build the inventory. Throws when output.wxr is missing — the WXR is the
 * source of truth for archetype counts and we cannot fabricate it.
 */
export function inventoryReplica(outputDir: string): ReplicateInventory {
  const notes: string[] = [];
  const wxrPath = join(outputDir, 'output.wxr');
  if (!existsSync(wxrPath)) {
    throw new Error(
      `inventoryReplica: output.wxr missing at ${wxrPath}. The replicate skill needs an extracted site.`,
    );
  }

  const siteSlug = sanitizeSlug(basename(outputDir));
  const manifest = tryReadManifest(outputDir);
  const entries = manifest.entries ?? {};
  const wxr = readWxr(wxrPath);

  // Bucket WXR items by archetype (using sourceUrl when available — falls back
  // to slug-based classification otherwise).
  const archetypes = emptyBuckets();
  const itemsByUrl: Map<string, WxrItem> = new Map();

  for (const item of wxr.items) {
    if (item.type === 'attachment' || item.type === 'nav_menu_item') continue;
    const sourceUrl = (item as { sourceUrl?: string }).sourceUrl ?? '';
    const url = sourceUrl || synthesizeUrl(wxr.site.url, item);
    const archetype = classifyForItem(item, url);
    archetypes[archetype].count += 1;
    if (url) {
      archetypes[archetype].urls.push(url);
      itemsByUrl.set(url, item);
    }
  }

  // The WXR usually does not include a `homepage` item — most extracted sites
  // don't capture the index URL as its own page. Surface in notes when we
  // didn't see one so the agent knows it'll be inferring the homepage.
  if (archetypes.homepage.count === 0) {
    notes.push('No homepage entry in WXR; index.html template will be inferred from other archetypes.');
  }

  // Representatives — pick up to N largest HTML pages per archetype.
  const representatives = emptyRepresentatives();
  for (const archetype of ARCHETYPES) {
    const urls = archetypes[archetype].urls;
    const ranked = urls
      .map((url) => {
        const entry = entries[url];
        const htmlBytes = htmlBytesFor(outputDir, entry?.html);
        return { url, entry, htmlBytes };
      })
      .sort((a, b) => b.htmlBytes - a.htmlBytes)
      .slice(0, REP_PER_ARCHETYPE);

    representatives[archetype] = ranked.map((r) => ({
      url: r.url,
      slug: r.entry?.slug ?? slugFromUrl(r.url),
      screenshot: r.entry?.desktop ?? null,
      scrolledScreenshot: r.entry?.desktopScrolled ?? null,
      html: r.entry?.html ?? null,
      htmlBytes: r.htmlBytes,
      wxrItemId: itemsByUrl.get(r.url)?.id ?? null,
    }));
  }

  // Design foundation is the prerequisite; absence is a hard signal for the skill.
  const dfPath = join(outputDir, 'design-foundation.json');
  const designFoundationExists = existsSync(dfPath);
  if (!designFoundationExists) {
    notes.push(
      'design-foundation.json is missing. Run the design-foundations skill first; the replicate skill consumes its semantic role assignments.',
    );
  }

  // Products
  const productCount = countProductsJsonl(outputDir);

  // Coverage — flag URLs with screenshots that aren't in the WXR (orphan
  // captures) and items with no screenshot (extracted but never rendered).
  const wxrUrlSet = new Set([...itemsByUrl.keys()]);
  const manifestUrlSet = new Set(Object.keys(entries));
  const orphansInManifest = [...manifestUrlSet].filter((u) => !wxrUrlSet.has(u));
  const wxrWithoutScreenshot = [...wxrUrlSet].filter((u) => !manifestUrlSet.has(u));
  if (orphansInManifest.length > 0) {
    notes.push(`${orphansInManifest.length} URL(s) screenshot but not in WXR (likely homepage / index pages).`);
  }
  if (wxrWithoutScreenshot.length > 0) {
    notes.push(`${wxrWithoutScreenshot.length} WXR item(s) have no screenshot — verify Step 4b coverage when picking representatives.`);
  }

  return {
    outputDir,
    siteSlug,
    archetypes,
    representatives,
    designFoundationPath: designFoundationExists ? 'design-foundation.json' : null,
    designFoundationExists,
    productCount,
    hasProducts: productCount > 0,
    hasWxr: true,
    notes,
  };
}

/**
 * Convert an output-dir name into a usable theme/site slug.
 * Strips leading "www.", replaces non-alphanumerics with hyphens, lowercases.
 */
export function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function synthesizeUrl(siteUrl: string, item: WxrItem): string {
  // For items without a stored sourceUrl, fall back to <site>/<slug>/.
  // Better than empty string — keeps representatives keyable.
  const slug = (item as { slug?: string }).slug ?? '';
  if (!slug) return '';
  if (!siteUrl) return slug;
  return `${siteUrl.replace(/\/$/, '')}/${slug}/`;
}

function classifyForItem(item: WxrItem, url: string): UrlType {
  // For posts and products the WXR post_type is the strongest signal — trust it
  // even when the URL would classify otherwise (some extractions strip the
  // /products/ segment from the sourceUrl).
  if (item.type === 'post') return 'post';
  // Pages may legitimately be product/gallery/event archetypes when the
  // adapter chose to emit them as `page` (Wix often does this). Use the URL.
  if (url) return classifyUrl(url);
  return 'page';
}

function slugFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
    return path.replace(/\//g, '--') || 'homepage';
  } catch {
    return 'unknown';
  }
}
