#!/usr/bin/env tsx
//
// Heuristic-blocks hit-rate measurement
// ======================================
// Runs sanitizeSourceHtml + heuristicBlocks against every html/<slug>.html
// in the configured output directories and reports per-platform handled /
// not-handled counts with reasons.
//
// This is the gating measurement before expanding the heuristic library:
// the council's verdict was "if hit-rate justifies it, expand; if not,
// don't waste the half-day." The reasons column is the diagnostic — it
// surfaces WHY pages don't match (unexpected element, multiple sections,
// etc.) so we know which shapes to add next.
//
// Usage:
//   tsx scripts/measure-heuristic-hitrate.ts
//
// Output: a per-platform summary table + an aggregate. No side effects.
//

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeSourceHtml } from '../src/lib/streaming/html-sanitize.js';
import { heuristicBlocks } from '../src/lib/streaming/heuristic-blocks.js';
import { extractContentRegion, type ContentRegionSource } from '../src/lib/streaming/content-region.js';

interface PlatformFixture {
  name: string;
  dir: string;
  platform: string;
}

const FIXTURES: PlatformFixture[] = [
  { name: 'getsnooz.com', dir: 'output/getsnooz.com/html', platform: 'shopify' },
  { name: 'dopplepress.com (riso)', dir: 'output/www.dopplepress.com-riso/html', platform: 'wix' },
  { name: 'biostratamarketing.com', dir: 'output/www.biostratamarketing.com/html', platform: 'hubspot' },
];

interface PerFile {
  file: string;
  /** Bytes of sanitized HTML before content-region extraction. */
  rawBytes: number;
  /** Bytes after content-region extraction. */
  extractedBytes: number;
  /** Which content-region rule fired. */
  regionSource: ContentRegionSource;
  /** Heuristic result on the EXTRACTED region. */
  handled: boolean;
  reason?: string;
  /** Heuristic result on the RAW sanitized HTML (no extraction) — for before/after comparison. */
  handledRaw: boolean;
}

interface PlatformResult {
  name: string;
  platform: string;
  total: number;
  /** Hit rate WITHOUT content-region extraction (baseline). */
  handledRaw: number;
  /** Hit rate WITH content-region extraction. */
  handled: number;
  notHandled: number;
  files: PerFile[];
  reasonHistogram: Record<string, number>;
  regionSourceHistogram: Record<string, number>;
}

function measurePlatform(fix: PlatformFixture): PlatformResult | null {
  const absDir = join(process.cwd(), fix.dir);
  if (!existsSync(absDir)) {
    console.warn(`[skip] ${fix.name}: ${fix.dir} not found`);
    return null;
  }
  const files = readdirSync(absDir)
    .filter((f) => f.endsWith('.html'))
    .sort();
  if (files.length === 0) {
    console.warn(`[skip] ${fix.name}: no html files in ${fix.dir}`);
    return null;
  }

  const result: PlatformResult = {
    name: fix.name,
    platform: fix.platform,
    total: files.length,
    handledRaw: 0,
    handled: 0,
    notHandled: 0,
    files: [],
    reasonHistogram: {},
    regionSourceHistogram: {},
  };

  for (const f of files) {
    const raw = readFileSync(join(absDir, f), 'utf8');
    const sanitized = sanitizeSourceHtml(raw);

    // Baseline: heuristic against raw sanitized HTML (no extraction).
    const baselineResult = heuristicBlocks(sanitized);
    const handledRaw = baselineResult.handled;

    // With content-region extraction.
    const region = extractContentRegion(sanitized);
    const r = heuristicBlocks(region.html);
    const reason = r.reason ?? (r.handled ? 'handled' : 'unknown');

    result.files.push({
      file: f,
      rawBytes: sanitized.length,
      extractedBytes: region.outputBytes,
      regionSource: region.source,
      handled: r.handled,
      reason,
      handledRaw,
    });
    if (handledRaw) result.handledRaw += 1;
    if (r.handled) {
      result.handled += 1;
    } else {
      result.notHandled += 1;
      result.reasonHistogram[reason] = (result.reasonHistogram[reason] ?? 0) + 1;
    }
    result.regionSourceHistogram[region.source] = (result.regionSourceHistogram[region.source] ?? 0) + 1;
  }
  return result;
}

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function fmtTable(rows: Array<Record<string, string | number>>, cols: string[]): string {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells: Array<string | number>): string =>
    '| ' + cells.map((cell, i) => String(cell).padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  return [line(cols), sep, ...rows.map((r) => line(cols.map((c) => r[c] ?? '')))].join('\n');
}

function main(): void {
  console.log('Heuristic-blocks hit-rate measurement');
  console.log('======================================');
  console.log();

  const results: PlatformResult[] = [];
  for (const fix of FIXTURES) {
    const r = measurePlatform(fix);
    if (r) results.push(r);
  }

  if (results.length === 0) {
    console.error('No platforms had measurable html/ directories. Run liberate against at least one site first.');
    process.exitCode = 1;
    return;
  }

  // Per-platform summary — baseline vs. content-region extraction.
  console.log('Per-platform summary (baseline vs. extracted):');
  console.log();
  console.log(
    fmtTable(
      results.map((r) => ({
        platform: r.platform,
        site: r.name,
        total: r.total,
        'baseline hit': `${r.handledRaw} (${pct(r.handledRaw, r.total)})`,
        'extracted hit': `${r.handled} (${pct(r.handled, r.total)})`,
        delta: `+${r.handled - r.handledRaw}`,
      })),
      ['platform', 'site', 'total', 'baseline hit', 'extracted hit', 'delta'],
    ),
  );
  console.log();

  // Aggregate
  const totals = results.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      handledRaw: acc.handledRaw + r.handledRaw,
      handled: acc.handled + r.handled,
    }),
    { total: 0, handledRaw: 0, handled: 0 },
  );
  console.log(
    `Aggregate baseline: ${totals.handledRaw}/${totals.total} (${pct(totals.handledRaw, totals.total)})`,
  );
  console.log(
    `Aggregate w/ content-region extraction: ${totals.handled}/${totals.total} (${pct(totals.handled, totals.total)})`,
  );
  console.log(`Delta: +${totals.handled - totals.handledRaw} pages now matchable.`);
  console.log();

  // Content-region source histogram per platform.
  for (const r of results) {
    console.log(`Content-region source distribution — ${r.name}:`);
    const sorted = Object.entries(r.regionSourceHistogram).sort((a, b) => b[1] - a[1]);
    for (const [source, count] of sorted) {
      console.log(`  ${count.toString().padStart(3)}× ${source}`);
    }
    console.log();
  }

  // Reason histogram per platform — what's blocking the heuristic?
  for (const r of results) {
    if (r.notHandled === 0) continue;
    console.log(`Why pages didn't match — ${r.name}:`);
    const sorted = Object.entries(r.reasonHistogram).sort((a, b) => b[1] - a[1]);
    for (const [reason, count] of sorted) {
      console.log(`  ${count.toString().padStart(3)}× ${reason}`);
    }
    console.log();
  }

  // Per-page detail — sorted by extracted size (smallest = simplest =
  // most likely to be a quick heuristic shape addition).
  console.log('Per-page detail (top 30 not-handled after extraction, smallest first):');
  console.log();
  const detailRows = results
    .flatMap((r) =>
      r.files.map((f) => ({
        site: r.name,
        file: f.file,
        'raw kb': (f.rawBytes / 1024).toFixed(1),
        'ext kb': (f.extractedBytes / 1024).toFixed(1),
        region: f.regionSource,
        handled: f.handled ? 'YES' : 'no',
        reason: f.reason ?? '',
      })),
    )
    .filter((r) => r.handled === 'no')
    .sort((a, b) => Number(a['ext kb']) - Number(b['ext kb']))
    .slice(0, 30);
  if (detailRows.length === 0) {
    console.log('(all pages handled — heuristic library is fully covering!)');
  } else {
    console.log(fmtTable(detailRows, ['site', 'file', 'raw kb', 'ext kb', 'region', 'reason']));
  }
}

main();
