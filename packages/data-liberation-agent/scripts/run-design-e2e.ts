#!/usr/bin/env tsx
// scripts/run-design-e2e.ts
//
// End-to-end HTML-first parity gate
// ==================================
// Measures how faithfully the html-first replica renders relative to the live
// origin — the definitive integration check for Approach B (html-first design
// replication).
//
// Run this script BOTH without and with --include-scripts to compare:
//   - Static fidelity: fonts, backgrounds, layout, mobile reflow
//   - JS fidelity: carousels, dropdowns, JS-driven UI (only when --include-scripts)
//
// Because the full extract + live-preview install is environment-dependent
// (Studio), this is a GUIDED runner: it prints exact commands for
// steps that require a live environment and exits with guidance when those
// artifacts aren't yet present.
//
// Usage:
//   npx tsx scripts/run-design-e2e.ts <originUrl> [outDir] [--include-scripts]
//
// outDir defaults to ./output/design-e2e
//
// Workflow:
//   Step 1: Run the guided extract command (produces origin screenshots +
//           html-first replica); note the replica's preview base URL.
//   Step 2: Run the guided screenshot command against the running replica.
//   Step 3: Re-run this script — both manifests are present and comparison runs.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareScreenshotDirs, type ComparisonResult } from '../src/lib/screenshot/compare.js';
import { resolveOutputBase } from '../src/lib/paths.js';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.error('Usage: npx tsx scripts/run-design-e2e.ts <originUrl> [outDir] [--include-scripts]');
  console.error('');
  console.error('  End-to-end html-first parity gate.');
  console.error('  Run without and with --include-scripts to compare static vs JS fidelity.');
  console.error('');
  console.error('  outDir defaults to ./output/design-e2e');
  process.exit(1);
}

const includeScripts = args.includes('--include-scripts');
const positional = args.filter((a) => !a.startsWith('--'));

const originUrl = positional[0];
if (!originUrl) {
  console.error('Usage: npx tsx scripts/run-design-e2e.ts <originUrl> [outDir] [--include-scripts]');
  console.error('');
  console.error('  <originUrl> is required.');
  process.exit(1);
}

const outDirArg = positional[1] ?? join(resolveOutputBase(), 'design-e2e');
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });

const includeScriptsFlag = includeScripts ? ' --include-scripts' : '';
const mode = includeScripts ? 'with --include-scripts (static + JS fidelity)' : 'without --include-scripts (static fidelity only)';

console.log(`[design-e2e] Origin URL : ${originUrl}`);
console.log(`[design-e2e] Output dir : ${outDir}`);
console.log(`[design-e2e] Mode       : ${mode}`);
console.log('');

// ── Step 1: Origin screenshots + html-first extract ──────────────────────────

const originScreenshotsDir = join(outDir, 'origin', 'screenshots');
const originManifest = join(originScreenshotsDir, 'manifest.json');

if (!existsSync(originManifest)) {
  console.log('[design-e2e] Origin screenshots not found. Run the following command to');
  console.log('[design-e2e] produce origin screenshots AND build the html-first replica:');
  console.log('');
  console.log(`    data-liberation ${originUrl} --html-first${includeScriptsFlag} --output ${join(outDir, 'origin')}`);
  console.log('');
  console.log('[design-e2e] That command will:');
  console.log('  1. Screenshot every page of the origin site (into origin/screenshots/)');
  console.log('  2. Extract content and build the html-first replica theme (site.css, site.js,');
  console.log('     blank companion theme, per-page design/<slug>.fragment.html sidecars)');
  console.log('  3. Install the replica into Studio (if connected)');
  console.log('');
  console.log('[design-e2e] After it completes, note the replica preview base URL, then re-run');
  console.log('[design-e2e] this script to proceed to Step 2.');
  process.exit(0);
}

// ── Step 2: Replica screenshots ───────────────────────────────────────────────

const replicaScreenshotsDir = join(outDir, 'replica', 'screenshots');
const replicaManifest = join(replicaScreenshotsDir, 'manifest.json');

if (!existsSync(replicaManifest)) {
  console.log('[design-e2e] Origin screenshots found. Replica screenshots not found.');
  console.log('[design-e2e] Start your html-first replica preview (Studio) and');
  console.log('[design-e2e] run the following command to screenshot it:');
  console.log('');
  console.log('[design-e2e] Replace <replicaBaseUrl> with your running replica\'s base URL');
  console.log('[design-e2e] (e.g. http://localhost:8888 or your Studio site URL):');
  console.log('');
  console.log(`    data-liberation screenshot <replicaBaseUrl> --output ${join(outDir, 'replica')}`);
  console.log('');
  console.log('[design-e2e] The screenshot command will capture every page at the same');
  console.log('[design-e2e] pathnames as the origin, matching by URL pathname for comparison.');
  console.log('');
  console.log('[design-e2e] After it completes, re-run this script to run the comparison.');
  process.exit(0);
}

// ── Step 3: Compare ───────────────────────────────────────────────────────────

console.log('[design-e2e] Both manifests found. Running compareScreenshotDirs…');
console.log('');

const diffDir = join(outDir, 'diff');
mkdirSync(diffDir, { recursive: true });

const comparison = await compareScreenshotDirs({
  originDir: originScreenshotsDir,
  replicaDir: replicaScreenshotsDir,
  diffOutputDir: diffDir,
});

// ── Step 4: Score summary ─────────────────────────────────────────────────────

const DESKTOP_PASS_THRESHOLD = 0.9;

function scoreLabel(r: ComparisonResult, vp: 'desktop' | 'mobile'): string {
  const s = r[vp];
  if (s.status !== 'ok' || s.score === null) return `N/A (${s.status})`;
  return `${(s.score * 100).toFixed(1)}% (${s.diffPixels} diff px / ${s.totalPixels} total)`;
}

const tableRows = comparison.results.map((r) =>
  `| \`${r.pathname}\` | ${scoreLabel(r, 'desktop')} | ${scoreLabel(r, 'mobile')} |`
);

// Calculate aggregate pass/fail
const contentPages = comparison.results.filter(
  (r) => r.desktop.status === 'ok' && r.desktop.score !== null,
);
const passing = contentPages.filter((r) => (r.desktop.score ?? 0) >= DESKTOP_PASS_THRESHOLD);
const failing = contentPages.filter((r) => (r.desktop.score ?? 0) < DESKTOP_PASS_THRESHOLD);

const verdictEmoji = failing.length === 0 ? '' : '';
const verdictLine =
  failing.length === 0 && contentPages.length > 0
    ? `All ${contentPages.length} content page(s) scored >= ${DESKTOP_PASS_THRESHOLD * 100}% desktop — html-first is FAITHFUL.`
    : contentPages.length === 0
      ? 'No matched content pages found — check that replica pathnames align with origin pathnames.'
      : `${failing.length}/${contentPages.length} page(s) below ${DESKTOP_PASS_THRESHOLD * 100}% desktop — inspect diff images and the checklist below.`;

const diffListItems = comparison.results
  .flatMap((r) => {
    const lines: string[] = [];
    if (r.desktop.diffPath) lines.push(`- Desktop diff \`${r.pathname}\`: \`${r.desktop.diffPath}\``);
    if (r.mobile.diffPath) lines.push(`- Mobile diff \`${r.pathname}\`: \`${r.mobile.diffPath}\``);
    return lines;
  })
  .join('\n');

const jsChecklist = includeScripts
  ? `- [ ] JS-driven UI intact? (nav dropdowns, carousels, modals, accordions)
- [ ] No console errors from replicated first-party scripts?
- [ ] Tracker/analytics scripts correctly excluded (check Network tab)?`
  : `- [ ] (JS fidelity not tested — re-run with --include-scripts to check)`;

const notes = `# HTML-First Design Parity Gate

> **Mode**: ${mode}
> Run this gate **both without and with \`--include-scripts\`** to compare static vs JS fidelity.

## Run info

- **Origin URL**: ${originUrl}
- **Output dir**: ${outDir}
- **Origin screenshots**: \`${originScreenshotsDir}\`
- **Replica screenshots**: \`${replicaScreenshotsDir}\`
- **Diff images**: \`${diffDir}\`
- **Compared at**: ${comparison.comparedAt}

## Per-pathname parity scores

| Pathname | Desktop score | Mobile score |
|----------|---------------|--------------|
${tableRows.join('\n')}

## Diff images

${diffListItems || '_(no diff images generated — check that both screenshot dirs have matching slugs)_'}

## Qualitative checklist

Review the screenshots in \`${outDir}\` and check:

- [ ] Fonts loaded? (compare heading/body typefaces between origin and replica)
- [ ] Backgrounds / hero images present in replica?
- [ ] Layout intact at desktop width (1440 px)?
- [ ] Mobile reflow looks correct (390 px)?
- [ ] Navigation and header structure preserved?
- [ ] Footer content and layout preserved?
${jsChecklist}

## Verdict rubric

| Condition | Conclusion |
|-----------|------------|
| Desktop >= ${DESKTOP_PASS_THRESHOLD * 100}% on all content pages | html-first is FAITHFUL — ship it |
| Desktop < ${DESKTOP_PASS_THRESHOLD * 100}% on content pages | Inspect diff images; likely a CSS scoping or media-rewrite issue |
| Missing replica pages | Replica sitemap/pathnames may not match origin — check the install and preview URL |
| Score N/A (decode-error / dim-mismatch) | Screenshot capture or viewport mismatch — re-capture |

## This run's verdict

${verdictLine}

${passing.length > 0 ? `**Passing pages (>= ${DESKTOP_PASS_THRESHOLD * 100}%):** ${passing.map((r) => `\`${r.pathname}\``).join(', ')}` : ''}
${failing.length > 0 ? `\n**Pages to investigate:** ${failing.map((r) => `\`${r.pathname}\` (${((r.desktop.score ?? 0) * 100).toFixed(1)}%)`).join(', ')}` : ''}
`;

const notesPath = join(outDir, 'DESIGN-NOTES.md');
writeFileSync(notesPath, notes);
console.log(notes);
console.log(`[design-e2e] DESIGN-NOTES.md written to: ${notesPath}`);
console.log(`[design-e2e] comparison.json written to: ${join(replicaScreenshotsDir, 'comparison.json')}`);
console.log(`[design-e2e] Done.`);
