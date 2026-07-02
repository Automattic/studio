// src/ui/spike-runner.ts
//
// runFreezeSpike
// ==============
// Measures the PIXEL-PARITY CEILING for one page (eng-review 1B):
//   1. (prereq) origin screenshots exist at <out>/origin-shots/screenshots
//   2. open the origin page in Playwright, freezePage() → sanitized HTML
//   3. wrap as ONE core/html block, write frozen.html + frozen.block.html
//   4. (manual) import the block into Studio + screenshot the replica
//   5. compareScreenshotDirs(origin, replica) → comparison.json
//   6. write NOTES.md: scores + freeze byte size + via + qualitative prompts
//
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { freezePage } from '../lib/screenshot/freeze.js';
import { compareScreenshotDirs } from '../lib/screenshot/compare.js';
import { DEFAULT_VIEWPORTS } from '../lib/screenshot/types.js';

export interface SpikeOpts {
  originUrl: string;
  replicaBaseUrl: string;
  outputDir: string;
}

async function loadSingleFileBundle(): Promise<string | undefined> {
  try {
    // @ts-expect-error - single-file-cli bundle has no types
    const mod = (await import('single-file-cli/lib/single-file-bundle.js')) as { script?: string };
    return mod.script;
  } catch (e) {
    console.error(`[spike] could not load single-file-cli bundle (will use fallback freeze): ${(e as Error).message}`);
    return undefined;
  }
}

export async function runFreezeSpike(opts: SpikeOpts): Promise<void> {
  mkdirSync(opts.outputDir, { recursive: true });
  const pathname = new URL(opts.originUrl).pathname;
  const originShots = join(opts.outputDir, 'origin-shots', 'screenshots');
  const replicaShots = join(opts.outputDir, 'replica-shots', 'screenshots');

  if (!existsSync(join(originShots, 'manifest.json'))) {
    throw new Error(`Run first:\n  data-liberation screenshot ${opts.originUrl} --output ${join(opts.outputDir, 'origin-shots')}`);
  }

  // Freeze the origin page (idempotent — safe to re-run).
  const sfBundle = await loadSingleFileBundle();
  const desktop = DEFAULT_VIEWPORTS.find((v) => v.id === 'desktop') ?? { width: 1440, height: 900 };
  const browser = await chromium.launch();
  let via = '', kb = 0;
  try {
    const page = await browser.newPage({ viewport: { width: desktop.width, height: desktop.height } });
    await page.goto(opts.originUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // settle (mirrors screenshotter)
    const frozen = await freezePage(page, sfBundle);
    via = frozen.via; kb = frozen.bytes / 1024;
    writeFileSync(join(opts.outputDir, 'frozen.html'), frozen.html);
    writeFileSync(join(opts.outputDir, 'frozen.block.html'), `<!-- wp:html -->\n${frozen.html}\n<!-- /wp:html -->`);
  } finally {
    await browser.close();
  }
  const slug = pathname.replace(/^\//, '').replace(/\//g, '-') || 'home';
  console.log(`[spike] froze ${opts.originUrl} via ${via} (${kb.toFixed(0)} KB) → ${join(opts.outputDir, 'frozen.block.html')}`);

  if (!existsSync(join(replicaShots, 'manifest.json'))) {
    console.log(`\n[spike] Next steps (manual):`);
    console.log(`  1. Import the block as a page into Studio at ${opts.replicaBaseUrl}, e.g. via wp-cli:`);
    console.log(`       wp post create --post_type=page --post_status=publish --post_name="${slug}" --post_content="$(cat ${join(opts.outputDir, 'frozen.block.html')})"`);
    console.log(`  2. Screenshot the replica:`);
    console.log(`       data-liberation screenshot ${opts.replicaBaseUrl}${pathname} --output ${join(opts.outputDir, 'replica-shots')}`);
    console.log(`  3. Re-run this freeze-spike command to score + write NOTES.md.`);
    return;
  }

  // Score + write NOTES.md
  const cmp = await compareScreenshotDirs({ originDir: originShots, replicaDir: replicaShots });
  const row = cmp.results.find((r) => r.pathname === pathname) ?? cmp.results[0];
  const fmt = (v: { score: number | null; status: string }) => (v.score != null ? v.score.toFixed(3) : v.status);
  const notes = [
    `# Freeze-Spike Notes — ${opts.originUrl}`,
    ``,
    `- Freeze via: **${via}**  (single-file-cli vs fallback)`,
    `- Frozen HTML size: **${kb.toFixed(0)} KB**`,
    `- Desktop parity: **${row ? fmt(row.desktop) : 'n/a'}**`,
    `- Mobile parity:  **${row ? fmt(row.mobile) : 'n/a'}**`,
    `- Diff images: ${row?.desktop.diffPath ?? '(none)'} / ${row?.mobile.diffPath ?? '(none)'}`,
    ``,
    `## Qualitative (fill in by eyeballing the diff PNGs)`,
    `- Did fonts load in the replica? (Y/N — if N, ceiling is artificially low)`,
    `- Did background images / hero render? (Y/N)`,
    `- Mobile: did media queries reflow correctly from the same freeze? (Y/N)`,
    `- What broke most visibly? (free text)`,
    ``,
    `## Verdict for Approach B (T9)`,
    `- Ceiling desktop >= 0.85 AND fonts/bg present -> B is worth building.`,
    `- Ceiling low BUT via 'fallback' or fonts missing -> fix the freeze and re-run before judging B.`,
  ].join('\n');
  writeFileSync(join(opts.outputDir, 'NOTES.md'), notes);
  console.log(notes);
}
