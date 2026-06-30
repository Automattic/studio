import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as cheerio from 'cheerio';
import type { LocalPage, LocalSite } from './types.js';

/** Recursively list *.html / *.htm files under root (skips dotdirs, node_modules, and symlinks). */
function listHtmlFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(dir, name);
      // lstat (not stat) so symlinks are seen as links: skipping them entirely
      // keeps circular links from ELOOP-crashing the walk.
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else if (name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** One path segment → slug-safe: lowercase, [^a-z0-9-] runs → '-', collapse '--', trim edge dashes. */
function sanitizeSegment(seg: string): string {
  return seg
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sanitize per-segment BEFORE joining so '-' keeps its separator semantics; drop
 *  segments that sanitize away entirely (no stray '--' across the join). */
function joinSlugSegments(parts: string[]): string {
  return parts.map(sanitizeSegment).filter(Boolean).join('-');
}

/** relPath → slug: "index.html" → "home"; "about us.html" → "about-us"; "blog/p.html" → "blog-p". */
export function slugFromRelPath(relPath: string): string {
  const noExt = relPath.replace(/\.html?$/i, '');
  const parts = noExt.split(sep).filter(Boolean);
  if (parts.length === 0) return 'home';
  const last = parts[parts.length - 1];
  if (last.toLowerCase() === 'index') {
    if (parts.length === 1) return 'home';
    return joinSlugSegments(parts.slice(0, -1)) || 'home';
  }
  // `|| 'home'` guards a path whose every segment sanitizes away (e.g. "###.html")
  // from producing an empty slug (→ empty artifact filenames), matching the
  // empty-path fallback; a duplicate trips ingest's loud slug-collision check.
  return joinSlugSegments(parts) || 'home';
}

export function ingestLocalSite(root: string): LocalSite {
  const files = listHtmlFiles(root);
  if (files.length === 0) throw new Error(`no html pages found under ${root}`);
  const pages: LocalPage[] = files.map((full) => {
    const html = readFileSync(full, 'utf8');
    const $ = cheerio.load(html);
    const relPath = relative(root, full);
    // body data-* attributes: JS-rendered sites key runtime behavior off them
    // (<body data-page="shop"> drives active-nav). Captured bare (no "data-"
    // prefix) so the theme's wp_body_open shim can replay them per pathname.
    const bodyData: Record<string, string> = {};
    const bodyAttrs = $('body').attr() ?? {};
    for (const [k, v] of Object.entries(bodyAttrs)) {
      if (k.startsWith('data-')) bodyData[k.slice('data-'.length)] = v;
    }
    return {
      relPath,
      slug: slugFromRelPath(relPath),
      html,
      title: $('title').first().text().trim(),
      ...(Object.keys(bodyData).length > 0 ? { bodyData } : {}),
    };
  });
  pages.sort((a, b) => a.slug.localeCompare(b.slug));
  // Distinct files can slug-collide (e.g. "blog/p.html" vs "blog-p.html") — downstream
  // writes <slug>-keyed artifacts, so a collision would silently overwrite. Fail loudly.
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.slug)) throw new Error(`slug collision: "${p.slug}" from "${p.relPath}"`);
    seen.add(p.slug);
  }
  return { root, pages };
}
