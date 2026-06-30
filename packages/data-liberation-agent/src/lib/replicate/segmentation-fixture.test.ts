/**
 * Browser-fixture harness for the in-browser section segmentation + cell grouping.
 *
 * The segmentation/cell-grouping geometry runs inside extractFull's page.evaluate
 * (live getComputedStyle/getBoundingClientRect), so it has no pure unit coverage
 * and is risky to change blind. This harness replays the REAL segmentation against
 * SNAPSHOTTED page HTML (captured pages passed via LIBERATE_SEGMENTATION_FIXTURES) loaded offline via
 * setContent — Wix/Squarespace inline most layout CSS, so it lays out faithfully.
 * Scripts are stripped (the captured HTML is already the rendered DOM; we don't
 * want the builder runtime hitting the network).
 *
 * It's generic: point `specsForFixture` at any captured page. The assertions per
 * site live in their own describe block and are the TDD target for segmentation
 * fixes (assert the DESIRED section/cell shape, then fix the geometry).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { extractFull, type SectionSpec } from './section-extract.js';
import { measureSourceBands, measureSourceRepeats, scoreSegmentation } from './segmentation-parity.js';
import { countBodyTags, isStackingArtifact } from '../screenshot/document-integrity.js';

// Opt-in local harness: set LIBERATE_SEGMENTATION_FIXTURES to one or more captured
// homepage HTML paths (comma/colon-separated) to replay segmentation against them.
// Defaults to NONE so the suite never depends on the gitignored output/ dir or any
// local machine state — the describe blocks below skip when no fixtures are provided.
function discoverHomepageFixtures(): string[] {
  const env = process.env.LIBERATE_SEGMENTATION_FIXTURES;
  if (!env) return [];
  return env
    .split(/[,:]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && existsSync(p));
}

// A capture bug nests the whole document into itself N times for some sites (seen
// at 11× across Squarespace/Wix/GoDaddy), so the saved HTML carries N <body>s and
// every section is duplicated + truncated against the extractor's section cap.
// Such a fixture is NOT a faithful single-page render — its parity score measures
// the capture artifact, not the segmentation — so it is quarantined out of the
// corpus baseline (and logged) rather than dragging the numbers. The detection is
// generic (>1 <body>); the underlying capture bug is tracked separately.
const ALL_FIXTURES = discoverHomepageFixtures();
const QUARANTINED = ALL_FIXTURES.filter((f) => isStackingArtifact(readFileSync(f, 'utf8')));
const FIXTURES = ALL_FIXTURES.filter((f) => !QUARANTINED.includes(f));
const haveFixture = FIXTURES.length > 0;
const haveQuarantined = QUARANTINED.length > 0;

let browser: Browser;
beforeAll(async () => {
  if (haveFixture) browser = await chromium.launch();
});
afterAll(async () => {
  if (browser) await browser.close();
});

async function analyzeFixture(path: string): Promise<{ specs: SectionSpec[]; score: ReturnType<typeof scoreSegmentation> }> {
  const html = readFileSync(path, 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(300);
    const { specs } = await extractFull(page, {}, 20_000);
    const bands = await measureSourceBands(page);
    const repeats = await measureSourceRepeats(page);
    return { specs, score: scoreSegmentation(bands, specs, { repeats }) };
  } finally {
    await page.close();
  }
}

function summarize(specs: SectionSpec[]): string {
  return specs
    .map(
      (s, i) =>
        `${i} ${s.interactionModel} cells=${(s.cells ?? []).length} cols=${s.layout?.columnCount ?? '?'} h=[${s.headings.slice(0, 3).join(' | ')}]`,
    )
    .join('\n');
}

// Characterization: confirms the harness reproduces the live segmentation offline.
// This is the feasibility gate for TDD'ing segmentation fixes against fixtures.
describe.runIf(haveFixture)('segmentation fixture harness', () => {
  for (const fixture of FIXTURES) {
    it(`reproduces segmentation from ${fixture}`, async () => {
      const { specs, score } = await analyzeFixture(fixture);
      // eslint-disable-next-line no-console
      console.log(
        `\n--- ${fixture} (offline) ---\n` +
          summarize(specs) +
          `\nPARITY ${JSON.stringify(score)}\n`,
      );
      expect(specs.length).toBeGreaterThan(0);
      // No hard floor yet — this logs the baseline the dynamic ruleset must raise.
      // Once a fixture corpus exists, assert composite >= an agreed floor per fixture.
    }, 60_000);
  }
});

// Quarantined fixtures are documented (not silently dropped) so the corpus is
// honest about what it excludes and why, and so a re-snapshot after the capture
// fix is caught by the same gate.
describe.runIf(haveQuarantined)('quarantined capture artifacts (excluded from corpus)', () => {
  for (const fixture of QUARANTINED) {
    it(`${fixture} is a stacking artifact and excluded`, () => {
      const copies = countBodyTags(readFileSync(fixture, 'utf8'));
      // eslint-disable-next-line no-console
      console.log(
        `\nQUARANTINED ${fixture} — ${copies}× nested <body> (capture stacked the ` +
          `document into itself); excluded from the parity corpus until re-snapshotted.\n`,
      );
      expect(copies).toBeGreaterThan(1);
    });
  }
});
