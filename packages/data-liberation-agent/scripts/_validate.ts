// Throwaway: run the validate-artifacts trust-boundary gate over every
// reconstructed pattern in <outputDir>/theme/patterns. The provenance corpus for
// each pattern is the captured source text of its own page (html/<slug>.html),
// sourced from the run instead of hand-written, so this works for any extracted
// site. The security (injection/XSS) + drift checks are exact; PROVENANCE here is
// APPROXIMATE — rendered HTML (tags→space) doesn't reproduce how the live capture
// spec concatenated adjacent text nodes, so a reconstructed heading that merges
// two source elements without a separator can be flagged even though its text
// traces to source. The authoritative provenance gate is the one reconstruct-pages
// runs against the live extractFullFromUrl spec; treat heading/body flags here as
// leads to eyeball, not hard failures.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateArtifacts, type ArtifactPattern } from '../src/lib/replicate/validate-artifacts.js';
import { requireOutputDir } from './_site-meta.js';

const outputDir = requireOutputDir();
const patternsDir = join(outputDir, 'theme', 'patterns');
const htmlDir = join(outputDir, 'html');

/** Visible text of a captured page: drop script/style/noscript, then all tags. */
function pageText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** alt/title attribute text — kept verbatim so reconstructed image alts trace to source. */
function attrText(html: string): string[] {
  return [...html.matchAll(/\b(?:alt|title|aria-label)=["']([^"']*)["']/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);
}

/** `page-about-us.php` / `home.php` → source slug `about-us` / `home`. */
const slugForPattern = (file: string): string =>
  file.replace(/\.php$/i, '').replace(/^page-/, '');

const patterns: ArtifactPattern[] = [];
const skipped: string[] = [];
for (const file of readdirSync(patternsDir).filter((f) => f.endsWith('.php'))) {
  const slug = slugForPattern(file);
  const htmlPath = join(htmlDir, `${slug}.html`);
  if (!existsSync(htmlPath)) {
    skipped.push(`${file} (no source html/${slug}.html)`);
    continue;
  }
  const html = readFileSync(htmlPath, 'utf8');
  const corpus = pageText(html);
  patterns.push({
    slug: `${file}`,
    php: readFileSync(join(patternsDir, file), 'utf8'),
    // interactionModel only needs to be a sanctioned value here; provenance +
    // security are what we're exercising. expectedText carries the page's visible
    // text + image alts; bodyText arms the body-copy provenance gate.
    spec: { interactionModel: 'static', expectedAssets: [], expectedText: [corpus, ...attrText(html)], bodyText: [corpus] },
  });
}

if (patterns.length === 0) {
  console.error(`no pattern↔source-html pairs found under ${patternsDir} / ${htmlDir}`);
  process.exit(1);
}

const report = validateArtifacts({ patterns });
console.log(`validated ${patterns.length} pattern(s); skipped ${skipped.length}`);
for (const s of skipped) console.log(`  skipped: ${s}`);
console.log('ok:', report.ok);
console.log('errors:', JSON.stringify(report.errors, null, 2));
console.log('warning count:', report.warnings.length);
// show non-noise warnings (skip per-word "possible non-source content")
const realWarn = report.warnings.filter((w) => !/possible non-source content/.test(w.message));
console.log('non-word-noise warnings:', JSON.stringify(realWarn, null, 2));
