#!/usr/bin/env tsx
// scripts/run-spike.ts
//
// Freeze-fidelity ceiling spike
// ==============================
// Measures how faithfully the frozen HTML snapshot (no WordPress layer) renders
// relative to the live origin. This is the CEILING: if the score is low here,
// the freeze itself is broken; no WordPress integration can fix that.
//
// Usage:
//   npx tsx scripts/run-spike.ts <originUrl> [outDir]
//
// outDir defaults to ./output/spike
//
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { resolveOutputBase } from '../src/lib/paths.js';
import { freezePage } from '../src/lib/screenshot/freeze.js';
import { scoreViewportPair, type ViewportId } from '../src/lib/screenshot/compare.js';

const [, , originUrl, outDirArg] = process.argv;

if (!originUrl) {
  console.error('Usage: npx tsx scripts/run-spike.ts <originUrl> [outDir]');
  console.error('');
  console.error('  Measures the FREEZE-FIDELITY CEILING: how closely the frozen HTML');
  console.error('  snapshot renders vs the live origin (no WordPress layer involved).');
  process.exit(1);
}

const outDir = outDirArg ?? join(resolveOutputBase(), 'spike');
mkdirSync(outDir, { recursive: true });

// Load single-file bundle (devDependency; no type declarations).
// @ts-expect-error — single-file-cli has no TypeScript declarations
const sfModule = await import('single-file-cli/lib/single-file-bundle.js').catch((e: unknown) => {
  console.warn(`[spike] Could not load single-file-cli bundle: ${(e as Error).message}; freezePage will use fallback.`);
  return null;
});
const script: string | undefined = sfModule?.script;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── 1. DESKTOP origin screenshot ─────────────────────────────────────────
  console.log('[spike] Loading origin (desktop)…');
  await page.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: join(outDir, 'origin.desktop.png'), fullPage: true });
  console.log('[spike] origin.desktop.png saved');

  // ── 2. FREEZE ─────────────────────────────────────────────────────────────
  console.log('[spike] Freezing page…');
  const frozen = await freezePage(page, script);
  writeFileSync(join(outDir, 'frozen.html'), frozen.html);
  const frozenKb = (frozen.bytes / 1024).toFixed(1);
  console.log(`[spike] frozen.html saved (${frozenKb} KB, via ${frozen.via})`);

  // ── 3. MOBILE origin screenshot ───────────────────────────────────────────
  console.log('[spike] Loading origin (mobile)…');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: join(outDir, 'origin.mobile.png'), fullPage: true });
  console.log('[spike] origin.mobile.png saved');

  // ── 4. REPLICA: render the frozen HTML ───────────────────────────────────
  const fileUrl = 'file://' + resolve(join(outDir, 'frozen.html'));

  console.log('[spike] Rendering frozen replica (desktop)…');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fileUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(outDir, 'replica.desktop.png'), fullPage: true });
  console.log('[spike] replica.desktop.png saved');

  console.log('[spike] Rendering frozen replica (mobile)…');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fileUrl, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: join(outDir, 'replica.mobile.png'), fullPage: true });
  console.log('[spike] replica.mobile.png saved');

  // ── 5. SCORE ─────────────────────────────────────────────────────────────
  console.log('[spike] Scoring…');
  const d = scoreViewportPair(
    join(outDir, 'origin.desktop.png'),
    join(outDir, 'replica.desktop.png'),
    'desktop' as ViewportId,
    join(outDir, 'diff.desktop.png'),
  );
  const m = scoreViewportPair(
    join(outDir, 'origin.mobile.png'),
    join(outDir, 'replica.mobile.png'),
    'mobile' as ViewportId,
    join(outDir, 'diff.mobile.png'),
  );

  // ── 6. NOTES.md ──────────────────────────────────────────────────────────
  const dScoreLine = d.status === 'ok'
    ? `${(d.score! * 100).toFixed(1)}% (${d.diffPixels} diff px / ${d.totalPixels} total)`
    : `N/A (status: ${d.status})`;
  const mScoreLine = m.status === 'ok'
    ? `${(m.score! * 100).toFixed(1)}% (${m.diffPixels} diff px / ${m.totalPixels} total)`
    : `N/A (status: ${m.status})`;

  const dVerdictScore = d.status === 'ok' ? d.score! : 0;
  const isHighCeiling = dVerdictScore >= 0.85 && frozen.via === 'single-file-cli';
  const verdict = isHighCeiling
    ? `>= 0.85 desktop AND via single-file-cli — the freeze is faithful. The remaining question for Approach B is whether core/html-in-WP preserves it (WP-layer follow-up).`
    : `Low ceiling (${(dVerdictScore * 100).toFixed(1)}% desktop) OR via fallback — the freeze itself is the problem. Fix the freeze before judging the WordPress layer (Approach B).`;

  const notes = `# Freeze-Fidelity Ceiling Spike

> **This measures the CEILING**: origin page vs directly-rendered frozen HTML — NO WordPress layer involved.
> A high score here means the freeze is faithful; a low score means the freeze is broken regardless of WP.

## Run info

- **Origin URL**: ${originUrl}
- **Output dir**: ${resolve(outDir)}
- **Freeze via**: ${frozen.via} (${frozenKb} KB)

## Scores

| Viewport | Score | Details |
|----------|-------|---------|
| Desktop  | ${dScoreLine} | diff: ${d.diffPath ?? 'n/a'} |
| Mobile   | ${mScoreLine} | diff: ${m.diffPath ?? 'n/a'} |

## Diff images

- Desktop diff: \`${join(outDir, 'diff.desktop.png')}\`
- Mobile diff: \`${join(outDir, 'diff.mobile.png')}\`

## Qualitative checklist

Review the screenshots in \`${resolve(outDir)}\` and check:

- [ ] Fonts loaded? (compare heading/body typefaces between origin and replica)
- [ ] Backgrounds / hero image present in frozen replica?
- [ ] Layout intact at desktop width (1440 px)?
- [ ] Mobile reflow looks correct (390 px)?
- [ ] No JS-dependent UI left broken (nav dropdowns, carousels, etc. — expected to be static)?

## Verdict

${verdict}
`;

  writeFileSync(join(outDir, 'NOTES.md'), notes);
  console.log('\n' + notes);
  console.log(`[spike] Done. Artifacts in: ${resolve(outDir)}`);

} finally {
  await browser.close();
}
