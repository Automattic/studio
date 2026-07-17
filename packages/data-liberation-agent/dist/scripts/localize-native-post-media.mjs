import { createRequire as __bundleCreateRequire } from 'node:module';
const require = __bundleCreateRequire(import.meta.url);
import{a}from"./chunk-Z226PWLO.mjs";import"./chunk-4TKBPMF4.mjs";import{writeFileSync as p,mkdirSync as d}from"node:fs";import{join as n,resolve as i}from"node:path";import{execFileSync as $}from"node:child_process";var[u,o]=process.argv.slice(2);(!u||!o)&&(console.error("usage: node scripts/run.mjs localize-native-post-media <outputDir> <studioSitePath>"),process.exit(1));var f=a.load(i(u)),s=[],r=0;for(let[e,t]of f.list())t.status==="success"&&(t.localUrl?s.push([e,t.localUrl]):r++);s.sort((e,t)=>t[0].length-e[0].length);console.log(`media-stubs: ${s.length} source\u2192local entries`+(r?` (${r} success stubs have no localUrl \u2014 run the carry reconstruct/media-install first)`:""));s.length===0&&(console.error("No localUrl entries \u2014 the media install (carry reconstruct step 3) has not run for this site. Aborting."),process.exit(1));var c=n(i(o),"wp-content","uploads","_carry-localize");d(c,{recursive:!0});p(n(c,"map.json"),JSON.stringify(s));var h=`<?php
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
`;p(n(c,"_localize.php"),h);console.log(`Rewriting native post/page content in ${o} \u2026`);var l=$("studio",["wp","--path",i(o),"--user=admin","eval-file","/wordpress/wp-content/uploads/_carry-localize/_localize.php"],{encoding:"utf8",maxBuffer:64*1024*1024}),g=l.split(`
`).find(e=>e.startsWith("LOCALIZE_RESULT"))??l.trim();console.log(g);console.log("Done. Spot-check a native post in the browser: its inline images should now be /wp-content/uploads/\u2026 not the source CDN.");
