import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
export const DOCS_DIR = path.join(ROOT, 'docs');
export const REPORTS_DIR = path.join(ROOT, 'reports');

export const BASE_URL = 'https://developer.wordpress.com';
export const DOCS_URL = `${BASE_URL}/docs/`;

export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Selectors the site itself strips out of .a8c-docs-entry__content before
// running it through Turndown (ported from the site's copy-page click handler).
export const EXCLUDED_SELECTORS = [
  '.toc-jump',
  '.a8c-docs-syntax__copy-button',
  '.a8c-docs-syntax__copy-textarea',
  '.page-links',
];

export function slugify(label) {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getSectionArg() {
  const idx = process.argv.indexOf('--section');
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error('Usage: node scripts/<script>.mjs --section <slug>');
    console.error('Run `npm run build-manifest` first to see available section slugs.');
    process.exit(1);
  }
  return process.argv[idx + 1];
}

export async function loadManifest() {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

export function filterSection(manifest, slug) {
  const entries = manifest.filter((e) => e.section === slug);
  if (entries.length === 0) {
    const known = [...new Set(manifest.map((e) => e.section))].sort();
    console.error(`No manifest entries for section "${slug}".`);
    console.error(`Known sections: ${known.join(', ')}`);
    process.exit(1);
  }
  return entries;
}
