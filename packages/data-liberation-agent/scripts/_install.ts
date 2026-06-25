// Throwaway: assemble the on-disk theme tree (text files) into themeFiles[] and
// launch the replica preview (creates/reuses a site, imports WXR + media,
// activates the theme). Binary assets (woff2 fonts, logo.png) are bridged
// separately after install since themeFiles content is string-only. The theme
// slug is derived from the output dir, so this works for any extracted site.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { startPreview } from '../src/lib/preview/studio.js';
import { requireOutputDir, installThemeSlug } from './_site-meta.js';

const outputDir = requireOutputDir();
const themeDir = join(outputDir, 'theme');
const themeSlug = installThemeSlug(outputDir);
const TEXT = /\.(css|json|php|html|svg)$/i;
const files: { relativePath: string; content: string }[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (TEXT.test(e.name)) files.push({ relativePath: relative(themeDir, p), content: readFileSync(p, 'utf8') });
  }
})(themeDir);
console.error(`themeFiles (${files.length}): ${files.map((f) => f.relativePath).join(', ')}`);

const res = await startPreview({
  outputDir,
  themeFiles: files,
  themeSlug,
});
console.log(JSON.stringify(res, null, 2));
