/**
 * Enrich WooCommerce products with their source marketing (carry path)
 * ===================================================================
 * A Shopify product page is a long rich marketing page; the carry path imports the
 * product as a WooCommerce item (functional buy box) but otherwise loses everything
 * below the buy box. This step rebuilds that marketing from the section specs captured
 * during the screenshot pass (`sections/<slug>.json`) into each product's post_content
 * as CORE blocks (with a per-section core/html fallback where reconstruction would drop
 * content — see product-marketing-island.ts), and sets the short Shopify blurb as the
 * product excerpt (rendered by `woocommerce/product-summary` in the buy box).
 *
 * The single-product.html template (theme-scaffold-carry) renders this post_content
 * full-width below the buy box via `core/post-content`.
 *
 * Site-generic: everything is derived from the run's outputDir + the running Studio
 * site. Re-runnable/idempotent (re-updates the same products).
 *
 *   npx tsx scripts/enrich-product-marketing.ts <outputDir> <studioSitePath> [themeSlug]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildProductMarketing } from '../src/lib/replicate/product-marketing-island.js';
import { loadCarryDesignTokens } from '../src/lib/replicate/carry-design-tokens.js';

const [outputDir, studioSitePath, themeSlugArg] = process.argv.slice(2);
if (!outputDir || !studioSitePath) {
  console.error('usage: tsx scripts/enrich-product-marketing.ts <outputDir> <studioSitePath> [themeSlug]');
  process.exit(2);
}

const wp = (args: string[]): string =>
  execFileSync('studio', ['wp', '--path', studioSitePath, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// Resolve the carry theme (for writing icon assets the reconstructed blocks reference).
const themesDir = join(studioSitePath, 'wp-content', 'themes');
const themeSlug =
  themeSlugArg ??
  (existsSync(themesDir) ? readdirSync(themesDir).find((d) => d.endsWith('-carry')) : undefined);
if (!themeSlug) {
  console.error(`could not find a *-carry theme under ${themesDir}; pass themeSlug explicitly`);
  process.exit(2);
}
const themeRoot = join(themesDir, themeSlug);

// Staging dir inside the site — holds the media map + per-product content for one bulk update.
const stageDir = join(studioSitePath, 'wp-content', 'uploads', 'liberation', 'products');
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// 1. CDN→local media map, rebuilt from the attachments' `_dla_source_url` meta (the
//    source URL the media importer recorded). One query covers the whole library, so
//    already-installed media is included (installRunMediaMap would only see new installs).
//    wp WRITES the map to a file (Studio's stdout proxy truncates large output) and we
//    read it back from the host filesystem.
console.log('building media map from attachment meta…');
wp([
  'eval',
  `$all=(new WP_Query(["post_type"=>"attachment","posts_per_page"=>-1,"fields"=>"ids","post_status"=>"any"]))->posts;` +
    `$m=[];foreach($all as $id){$s=get_post_meta($id,"_dla_source_url",true);if($s){$u=wp_get_attachment_url($id);if($u)$m[$s]=$u;}}` +
    `$up=wp_upload_dir();file_put_contents($up["basedir"]."/liberation/products/media-map.json",json_encode($m));echo count($m);`,
]);
const mediaUrlMap = new Map<string, string>(
  Object.entries(JSON.parse(readFileSync(join(stageDir, 'media-map.json'), 'utf8')) as Record<string, string>),
);
console.log(`  media map: ${mediaUrlMap.size} entries`);

// 2. Design tokens (palette + fonts) — same slugs theme.json registers, so block token
//    references resolve. Built from the captured palette.json / typography.json.
const tokens = loadCarryDesignTokens(outputDir);

// 3. URL → capture slug, from the screenshot manifest (keys sections/<slug>.json).
const manifest = JSON.parse(readFileSync(join(resolve(outputDir), 'screenshots', 'manifest.json'), 'utf8'));
const entries: Record<string, { slug?: string }> = manifest.entries || manifest;
const slugForUrl = (url: string): string | undefined => entries[url]?.slug ?? entries[url.replace(/\/$/, '')]?.slug;

// 4. Build each parent product's marketing markup + stage it for one bulk DB update.
interface Update { sku: string; file: string; excerpt: string; name: string }
const updates: Update[] = [];
const skipped: Array<{ name: string; reason: string }> = [];
let iconsWritten = 0;

const lines = readFileSync(join(resolve(outputDir), 'products.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
for (const line of lines) {
  // Per-product error isolation: a single corrupt products.jsonl line, unreadable/invalid
  // section spec, or reconstruction failure must NOT abort the whole run (all other
  // products would otherwise go un-enriched) — record it and move on.
  let p: { name?: string; sku?: string; sourceUrl?: string; description?: string };
  try {
    p = JSON.parse(line);
  } catch {
    skipped.push({ name: line.slice(0, 40), reason: 'malformed products.jsonl line' });
    continue;
  }
  // Parents only — variations carry no sourceUrl (and inherit the parent page).
  if (!p.sourceUrl || !p.sku) continue;
  try {
    const slug = slugForUrl(p.sourceUrl);
    if (!slug) { skipped.push({ name: p.name ?? p.sku, reason: 'no manifest slug' }); continue; }
    const specPath = join(resolve(outputDir), 'sections', `${slug}.json`);
    if (!existsSync(specPath)) { skipped.push({ name: p.name ?? p.sku, reason: `no section spec (${slug})` }); continue; }

    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const r = buildProductMarketing(spec, {
      paletteTokens: tokens.paletteTokens,
      fontFamilies: tokens.fontFamilies,
      mediaUrlMap,
      title: p.name,
      patternSlug: `${themeSlug}/product-marketing`,
    });
    if (!r.postContent) { skipped.push({ name: p.name ?? p.sku, reason: 'no marketing sections' }); continue; }

    for (const a of r.iconAssets) {
      // Never let a reconstructed asset path escape the theme dir.
      if (!a.path || a.path.includes('..') || a.path.startsWith('/')) continue;
      try {
        const dest = join(themeRoot, a.path);
        mkdirSync(join(dest, '..'), { recursive: true });
        writeFileSync(dest, a.svg);
        iconsWritten++;
      } catch { /* best-effort */ }
    }

    // Index-prefixed so two SKUs that sanitize to the same string can't clobber each
    // other's staged content before the DB write (Shopify SKUs are non-unique/optional).
    const fileName = `${updates.length}-${p.sku.replace(/[^a-z0-9._-]/gi, '_')}.html`;
    writeFileSync(join(stageDir, fileName), r.postContent);
    updates.push({ sku: p.sku, file: fileName, excerpt: p.description ?? '', name: p.name ?? p.sku });
    const islands = (r.postContent.match(/<!-- wp:html -->/g) || []).length;
    const core = (r.postContent.match(/<!-- wp:(?!html)/g) || []).length;
    console.log(`  ${p.name}: ${core} core blocks, ${islands} html islands (${r.keptIndices.length} sections)`);
  } catch (err) {
    skipped.push({ name: p.name ?? p.sku ?? '?', reason: `error: ${err instanceof Error ? err.message : String(err)}` });
  }
}

writeFileSync(join(stageDir, 'manifest.json'), JSON.stringify(updates));
console.log(`staged ${updates.length} products (${iconsWritten} icon assets), ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skip ${s.name}: ${s.reason}`);

// 5. Apply all updates in one DB pass (join by SKU). kses_remove_filters keeps the
//    block markup + inline styles intact (admin would otherwise sanitize them).
const res = wp([
  'eval',
  `kses_remove_filters();$up=wp_upload_dir();$dir=$up["basedir"]."/liberation/products";` +
    `$man=json_decode(file_get_contents($dir."/manifest.json"),true);$n=0;$miss=[];` +
    `foreach($man as $u){$id=wc_get_product_id_by_sku($u["sku"]);if(!$id){$miss[]=$u["sku"];continue;}` +
    `$c=file_get_contents($dir."/".$u["file"]);wp_update_post(["ID"=>$id,"post_content"=>$c,"post_excerpt"=>$u["excerpt"]]);$n++;}` +
    `echo "updated ".$n."/".count($man).(count($miss)?(" — no product for SKUs: ".implode(",",$miss)):"");`,
]);
console.log(res);
