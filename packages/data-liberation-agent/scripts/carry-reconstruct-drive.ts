/**
 * tsx driver for the carry-and-scope reconstruct (the `replicate-theme` path). Three modes:
 *
 *   npx tsx scripts/carry-reconstruct-drive.ts <outputDir> --slim
 *       Slim `output.wxr` for provisioning: drop attachment items + flip draft→publish, backing the
 *       full WXR up to `output.wxr.full`. Run BEFORE `liberate_preview`. (Replaces wxr-slim-publish.py.)
 *
 *   npx tsx scripts/carry-reconstruct-drive.ts <outputDir> --list
 *       Inspect-only: build + print the carry page list and write carry-pages.json. CHEAP —
 *       does NOT load the reconstruct handler. (Replaces the old `_carry_list.py` debug tool.)
 *
 *   npx tsx scripts/carry-reconstruct-drive.ts <outputDir> <studioSitePath> "<Theme Name>"
 *       Full reconstruct: drive reconstructPagesCarryHandler (theme + media + islands),
 *       write islands + _swap.php, write output-carry.wxr, restore output.wxr from .full.
 *
 * The long-lived MCP server doesn't hot-reload, so the handler must run from a fresh tsx process
 * against on-disk code. The page-list + WXR-patch logic lives in `src/lib/replicate/carry-page-list.ts`
 * (tested, handler-free — the single source of truth). Site/platform-generic — all paths from argv.
 * Optional `EXCLUDE` env (comma-separated slugs/htmlSlugs) drops junk/unwanted pages from the carry set.
 */
import { writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCarryPageList, buildOutputCarryWxr, reconcileCarryIslands, slimWxrForProvision, type BuildPageListResult } from '../src/lib/replicate/carry-page-list.js';

function reportPageList(r: BuildPageListResult): void {
  console.log(`pages: ${r.pages.length} (${r.pages.filter((p) => p.postType === 'post').length} posts, home=${r.pages.some((p) => p.isHome)})`);
  if (r.excluded.length) console.log(`excluded (${r.excluded.length}): ${r.excluded.map((p) => p.slug).join(', ')}`);
  if (r.skipped.length) console.log(`skipped — no captured html (${r.skipped.length}): ${r.skipped.map((s) => `${s.postType}:${s.postName}`).join(', ')}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const slimOnly = argv.includes('--slim');
  const [outputDir, studioSitePath, themeName = 'Liberated (Carry)'] = argv.filter((a) => a !== '--list' && a !== '--slim');
  if (!outputDir || (!listOnly && !slimOnly && !studioSitePath)) {
    console.error('usage:\n  tsx scripts/carry-reconstruct-drive.ts <outputDir> --slim   # slim output.wxr for provisioning (run BEFORE liberate_preview)\n  tsx scripts/carry-reconstruct-drive.ts <outputDir> --list   # inspect the carry page list (no handler)\n  tsx scripts/carry-reconstruct-drive.ts <outputDir> <studioSitePath> "<Theme Name>"');
    process.exit(2);
  }

  // --slim: drop attachment items + flip draft→publish so liberate_preview imports cleanly (no
  // Studio ~120s media-import timeout). Runs BEFORE provision; the full WXR is preserved at .full.
  if (slimOnly) {
    const { dropped, flipped } = slimWxrForProvision(outputDir);
    console.log(`slimmed: dropped ${dropped} attachment items, flipped ${flipped} draft->publish; full WXR preserved at output.wxr.full`);
    return;
  }

  const exclude = (process.env.EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  // 1. page list (handler-free — the same logic powers `--list`)
  const list = buildCarryPageList(outputDir, { exclude });
  writeFileSync(join(outputDir, 'carry-pages.json'), JSON.stringify(list.pages, null, 2));
  reportPageList(list);
  if (listOnly) { console.log(`wrote ${join(outputDir, 'carry-pages.json')}`); return; }

  // 2. drive the handler (lazy import — keeps `--list` cheap; runs the on-disk source)
  const { reconstructPagesCarryHandler } = await import('../src/mcp-server/handlers/reconstruct-pages-carry.js');
  const ctx = {
    textResult: (o: unknown) => ({ _data: o }),
    errorResult: (msg: string) => { throw new Error(`handler error: ${msg}`); },
  } as unknown as Parameters<typeof reconstructPagesCarryHandler>[1];
  // Default ON: emit carried bodies as the in-canvas `dla/editable-html` block (visible +
  // styled + editable in the block editor) instead of a sandboxed `core/html` island.
  // Front-end output is byte-identical. Ships + activates the block plugin. Opt OUT with
  // EDITABLE_ISLANDS=0 (or false) to force plain core/html.
  const editableIslands = ! /^(0|false)$/i.test(process.env.EDITABLE_ISLANDS ?? '');
  const res = (await reconstructPagesCarryHandler(
    { outputDir, studioSitePath, themeName, pages: list.pages, editableIslands } as unknown as Parameters<typeof reconstructPagesCarryHandler>[0],
    ctx,
  )) as { _data: { themeSlug: string; mediaInstalled: number; mediaErrors: unknown[]; fetchErrors: unknown[]; missingMediaDownloaded?: number; missingMediaFailed?: unknown[]; fontsLocalized?: number; fontsFailed?: unknown[]; residualCdnAssets?: number; residualCdnByHost?: Record<string, number>; residualCdnSamples?: string[]; islandsConverted?: number; editableHtmlPluginSlug?: string; pages: Array<{ slug: string; postContent: string }> } };
  const data = res._data;
  console.log(`theme: ${data.themeSlug}  media: ${data.mediaInstalled}  mediaErrors: ${data.mediaErrors.length}  fetchErrors: ${data.fetchErrors.length}  missingMediaDownloaded: ${data.missingMediaDownloaded ?? 0}  fontsLocalized: ${data.fontsLocalized ?? 0}`);
  if (data.missingMediaFailed?.length) console.log('  missingMediaFailed:', JSON.stringify(data.missingMediaFailed));
  if (data.fontsFailed?.length) console.log('  fontsFailed:', JSON.stringify(data.fontsFailed));
  if (editableIslands) console.log(`editable islands: converted=${data.islandsConverted ?? 0}  plugin=${data.editableHtmlPluginSlug ?? '(none)'}`);
  const residual = data.residualCdnAssets ?? 0;
  console.log(`self-host audit: residualCdnAssets=${residual}${residual ? `  byHost=${JSON.stringify(data.residualCdnByHost)}` : ' ✓'}`);
  if (residual) console.log('  residualCdnSamples:', JSON.stringify(data.residualCdnSamples));
  if (data.mediaErrors.length) console.log('  mediaErrors sample:', JSON.stringify(data.mediaErrors.slice(0, 3)));
  if (data.fetchErrors.length) console.log('  fetchErrors:', JSON.stringify(data.fetchErrors));

  // 3. islands + _swap.php (VFS path; Studio mounts the host site dir at /wordpress)
  const islandsDir = join(studioSitePath, 'wp-content/uploads/_carry-islands');
  mkdirSync(islandsDir, { recursive: true });
  const slugs = data.pages.map((p) => p.slug);
  // Drop islands left over from a prior, wider-scope run (e.g. posts carried before but
  // excluded now) — buildOutputCarryWxr patches by island-file existence, so a stale file
  // would silently re-enter output-carry.wxr.
  const removedStale = reconcileCarryIslands(islandsDir, slugs);
  if (removedStale.length) console.log(`  removed ${removedStale.length} stale island(s): ${removedStale.slice(0, 8).join(', ')}${removedStale.length > 8 ? ' …' : ''}`);
  for (const p of data.pages) writeFileSync(join(islandsDir, `${p.slug}.html`), p.postContent);
  const swap = `<?php
$dir = '/wordpress/wp-content/uploads/_carry-islands';
$slugs = ${JSON.stringify(slugs)};
foreach ($slugs as $slug) {
  $file = "$dir/$slug.html";
  if (!file_exists($file)) { echo "MISSING $slug\\n"; continue; }
  $content = file_get_contents($file);
  $posts = get_posts(['name'=>$slug,'post_type'=>['page','post'],'post_status'=>'any','numberposts'=>1]);
  if (empty($posts)) { echo "NO POST $slug\\n"; continue; }
  // wp_slash: wp_update_post() unslashes post_content, which would strip the backslashes
  // in dla/editable-html's frame-attr JSON (e.g. the -- escape for "--"),
  // corrupting the block attributes -> "invalid content" in the editor. Slash so the DB
  // write round-trips byte-exact. (Mirrors the install-post.php/install-data.php fix.)
  $r = wp_update_post(wp_slash(['ID'=>$posts[0]->ID,'post_content'=>$content,'post_status'=>'publish']), true);
  if (is_wp_error($r)) echo "ERR $slug: ".$r->get_error_message()."\\n";
  else echo "OK $slug id=".$posts[0]->ID." bytes=".strlen($content)."\\n";
}
`;
  writeFileSync(join(islandsDir, '_swap.php'), swap);
  console.log(`islands written: ${slugs.length} -> ${islandsDir}`);

  // 4. build output-carry.wxr (patch islands into the FULL WXR — the import deliverable)
  const wxr = buildOutputCarryWxr(outputDir, islandsDir);
  console.log(`output-carry.wxr: items=${wxr.items} patched=${wxr.patched} cdataBalanced=${wxr.cdataBalanced} -> ${wxr.outPath}`);

  // 5. heal the dir: the `--slim` step slimmed output.wxr in place; restore the full one
  //    so a later blocks run / liberate_verify sees the full WXR.
  const full = join(outputDir, 'output.wxr.full');
  if (existsSync(full)) {
    copyFileSync(full, join(outputDir, 'output.wxr'));
    console.log('restored output.wxr from output.wxr.full (non-lossy)');
  }

  console.log(`THEMESLUG=${data.themeSlug}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
