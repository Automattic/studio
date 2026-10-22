import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  EXCLUDED_SELECTORS,
  REPORTS_DIR,
  ROOT,
  getSectionArg,
  loadManifest,
  filterSection,
} from './lib/common.mjs';
import { htmlFragmentToMarkdown } from './lib/extract.mjs';

async function readLocalFile(filePath) {
  try {
    return await readFile(path.join(ROOT, filePath), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function main() {
  const slug = getSectionArg();
  const manifest = await loadManifest();
  const entries = filterSection(manifest, slug);

  console.log(
    `Independently re-deriving markdown for ${entries.length} page(s) in section "${slug}"...\n` +
      `(uses our own Turndown port against the same post-load DOM the site's Copy page button reads)\n`
  );

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];
  const diffsDir = path.join(REPORTS_DIR, slug, 'diffs');

  for (const entry of entries) {
    const result = { url: entry.url, filePath: entry.filePath, title: entry.title };
    const local = await readLocalFile(entry.filePath);
    if (local === null) {
      result.status = 'skipped';
      result.reason = 'no local file (run fetch-section.mjs first)';
      results.push(result);
      console.log(`  ⚠ ${entry.url} — ${result.reason}`);
      continue;
    }

    try {
      const res = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!res || !res.ok()) {
        result.status = 'error';
        result.reason = `HTTP ${res ? res.status() : 'no response'}`;
        results.push(result);
        console.log(`  ✗ ${entry.url} — ${result.reason}`);
        continue;
      }

      const extracted = await page.evaluate((excludedSelectors) => {
        const contentEl = document.querySelector('.a8c-docs-entry__content');
        if (!contentEl) return null;
        const clone = contentEl.cloneNode(true);
        excludedSelectors.forEach((selector) => {
          clone.querySelectorAll(selector).forEach((el) => el.remove());
        });
        const titleEl = document.querySelector('.a8c-docs-entry__title');
        return {
          html: clone.innerHTML,
          title: titleEl ? titleEl.textContent.trim() : '',
        };
      }, EXCLUDED_SELECTORS);

      if (!extracted) {
        result.status = 'error';
        result.reason = '.a8c-docs-entry__content not found';
        results.push(result);
        console.log(`  ✗ ${entry.url} — ${result.reason}`);
        continue;
      }

      const markdown = htmlFragmentToMarkdown(extracted.html, extracted.title);

      if (markdown === local) {
        result.status = 'verified';
        results.push(result);
        console.log(`  ✓ ${entry.url}`);
      } else {
        result.status = 'mismatch';
        results.push(result);
        console.log(`  ✗ ${entry.url} — content differs from downloaded file`);
        await mkdir(diffsDir, { recursive: true });
        const base = entry.filePath.replace(/\//g, '__');
        await writeFile(path.join(diffsDir, `${base}.browser.md`), local, 'utf8');
        await writeFile(path.join(diffsDir, `${base}.reimpl.md`), markdown, 'utf8');
        result.diffFiles = {
          browser: path.relative(ROOT, path.join(diffsDir, `${base}.browser.md`)),
          reimpl: path.relative(ROOT, path.join(diffsDir, `${base}.reimpl.md`)),
        };
      }
    } catch (err) {
      result.status = 'error';
      result.reason = err.message;
      results.push(result);
      console.log(`  ✗ ${entry.url} — ${err.message}`);
    }
  }

  await browser.close();

  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${slug}-verify-report.json`);
  await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n', 'utf8');

  const verified = results.filter((r) => r.status === 'verified').length;
  const mismatches = results.filter((r) => r.status === 'mismatch');
  const errors = results.filter((r) => r.status === 'error');
  const skipped = results.filter((r) => r.status === 'skipped');

  console.log(
    `\n${verified}/${results.length} verified, ${mismatches.length} mismatch(es), ${errors.length} error(s), ${skipped.length} skipped.`
  );
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  if (mismatches.length) {
    console.log('\nMismatches (see reports/<section>/diffs/):');
    for (const m of mismatches) {
      console.log(`  - ${m.url}`);
    }
  }
  if (verified !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
