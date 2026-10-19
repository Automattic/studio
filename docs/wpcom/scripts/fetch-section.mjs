import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  REPORTS_DIR,
  ROOT,
  getSectionArg,
  loadManifest,
  filterSection,
} from './lib/common.mjs';

const COPY_BUTTON_SELECTOR = '.a8c-docs-copy-page-button';

function sanityCheck(text) {
  if (!text || text.trim().length === 0) {
    return 'empty clipboard content';
  }
  if (!text.startsWith('# ')) {
    return 'content does not start with a top-level heading';
  }
  if (/<\/?(div|span|button|svg|textarea)[\s>]/i.test(text)) {
    return 'leftover HTML tags detected in content';
  }
  return null;
}

async function main() {
  const slug = getSectionArg();
  const manifest = await loadManifest();
  const entries = filterSection(manifest, slug);

  console.log(`Fetching ${entries.length} page(s) for section "${slug}" via browser automation...\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://developer.wordpress.com',
  });
  const page = await context.newPage();

  const results = [];

  for (const entry of entries) {
    const result = { url: entry.url, filePath: entry.filePath, title: entry.title };
    try {
      const res = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!res || !res.ok()) {
        result.status = 'error';
        result.reason = `HTTP ${res ? res.status() : 'no response'}`;
        results.push(result);
        console.log(`  ✗ ${entry.url} — ${result.reason}`);
        continue;
      }

      const button = page.locator(COPY_BUTTON_SELECTOR).first();
      const buttonCount = await button.count();
      if (buttonCount === 0) {
        result.status = 'error';
        result.reason = 'Copy page button not found';
        results.push(result);
        console.log(`  ✗ ${entry.url} — ${result.reason}`);
        continue;
      }

      await button.click();
      // clipboard write happens inside the click handler; give it a tick
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => navigator.clipboard.readText());

      const problem = sanityCheck(text);
      if (problem) {
        result.status = 'error';
        result.reason = problem;
        results.push(result);
        console.log(`  ✗ ${entry.url} — ${problem}`);
        continue;
      }

      const destPath = path.join(ROOT, entry.filePath);
      await mkdir(path.dirname(destPath), { recursive: true });
      await writeFile(destPath, text, 'utf8');

      result.status = 'ok';
      results.push(result);
      console.log(`  ✓ ${entry.url}`);
    } catch (err) {
      result.status = 'error';
      result.reason = err.message;
      results.push(result);
      console.log(`  ✗ ${entry.url} — ${err.message}`);
    }
  }

  await browser.close();

  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `${slug}-fetch-report.json`);
  await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n', 'utf8');

  const ok = results.filter((r) => r.status === 'ok').length;
  const errors = results.filter((r) => r.status === 'error');
  console.log(`\n${ok}/${results.length} downloaded, ${errors.length} error(s).`);
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors) {
      console.log(`  - ${e.url}: ${e.reason}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
