//
// localize-native-post-media.ts
// =============================
// Theme/carry path, hybrid mode: when only the custom/marketing pages are carried
// and the blog (posts + archives) stays NATIVE, the carry reconstruct rewrites the
// carried *islands'* <img>/url() to the local WP library — but native post/page
// bodies keep their source-CDN URLs. The images themselves ARE downloaded and
// installed as attachments by the media-install step; only the *content references*
// were never rewritten. This script closes that gap: it rewrites native post_content
// (and any non-carried page content) from the source CDN URL to the installed local
// upload URL, so the replica is self-hosted with no source-CDN dependency.
//
// Source→local map comes from media-stubs.json, where installMediaForUrl recorded
// `localUrl` per installed attachment. Rewrite is applied IN THE LIVE SITE via
// `studio wp eval-file` (carried pages are already local, so they're no-ops).
//
// Site-generic: all paths from argv. Run AFTER the carry reconstruct (step 3), which
// installs media + records the localUrls.
//
//   npx tsx scripts/localize-native-post-media.ts <outputDir> <studioSitePath>
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MediaStubStore } from '../src/lib/resume-state/index.js';

const [outputDir, studioSitePath] = process.argv.slice(2);
if (!outputDir || !studioSitePath) {
  console.error('usage: npx tsx scripts/localize-native-post-media.ts <outputDir> <studioSitePath>');
  process.exit(1);
}

// 1. Build the source→local URL map from the stub store. installMediaForUrl records
//    `localUrl` (e.g. http://localhost:8884/wp-content/uploads/2026/06/x.jpg) on each
//    installed stub. Sort longest-source-first so a base URL can't mangle a longer
//    variant (mirrors rewriteMediaUrls' ordering).
const store = MediaStubStore.load(resolve(outputDir));
const pairs: Array<[string, string]> = [];
let successNoUrl = 0;
for (const [url, stub] of store.list()) {
  if (stub.status !== 'success') continue;
  if (stub.localUrl) pairs.push([url, stub.localUrl]);
  else successNoUrl++;
}
pairs.sort((a, b) => b[0].length - a[0].length);
console.log(`media-stubs: ${pairs.length} source→local entries` +
  (successNoUrl ? ` (${successNoUrl} success stubs have no localUrl — run the carry reconstruct/media-install first)` : ''));
if (pairs.length === 0) {
  console.error('No localUrl entries — the media install (carry reconstruct step 3) has not run for this site. Aborting.');
  process.exit(1);
}

// 2. Stage the map + a PHP rewriter under the site's uploads, run via studio wp eval-file
//    (Studio mounts the site at the /wordpress VFS root). str_replace over the sorted
//    arrays rewrites every post/page body; only changed posts are updated.
const hostDir = join(resolve(studioSitePath), 'wp-content', 'uploads', '_carry-localize');
mkdirSync(hostDir, { recursive: true });
writeFileSync(join(hostDir, 'map.json'), JSON.stringify(pairs));

const php = `<?php
$pairs = json_decode(file_get_contents('/wordpress/wp-content/uploads/_carry-localize/map.json'), true);
if (!is_array($pairs)) { fwrite(STDERR, "map.json unreadable\\n"); exit(1); }
$search = array_map(function($p){ return $p[0]; }, $pairs);
$replace = array_map(function($p){ return $p[1]; }, $pairs);
$q = new WP_Query([
  'post_type'      => ['post', 'page'],
  'post_status'    => 'any',
  'posts_per_page' => -1,
  'fields'         => 'ids',
]);
$scanned = 0; $changed = 0; $refs = 0;
foreach ($q->posts as $id) {
  $scanned++;
  $c = get_post_field('post_content', $id);
  if ($c === '' || strpos($c, 'http') === false) continue;
  $n = str_replace($search, $replace, $c, $count);
  if ($n !== $c) {
    wp_update_post(['ID' => $id, 'post_content' => $n]);
    $changed++; $refs += $count;
  }
}
echo "LOCALIZE_RESULT scanned=$scanned changed=$changed refsRewritten=$refs\\n";
`;
writeFileSync(join(hostDir, '_localize.php'), php);

console.log(`Rewriting native post/page content in ${studioSitePath} …`);
const out = execFileSync(
  'studio',
  ['wp', '--path', resolve(studioSitePath), '--user=admin', 'eval-file',
   '/wordpress/wp-content/uploads/_carry-localize/_localize.php'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const line = out.split('\n').find((l) => l.startsWith('LOCALIZE_RESULT')) ?? out.trim();
console.log(line);
console.log('Done. Spot-check a native post in the browser: its inline images should now be /wp-content/uploads/… not the source CDN.');
