import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { reconstructPagePattern, type ReconstructOptions, type ReconstructResult } from '../page-reconstruct.js';
import {
  reconstructBaselineCases,
  type FrozenConvertedSection,
  type FrozenReconstructCase,
} from './fixtures/page-reconstruct-dla-baseline.corpus.js';

interface BaselineOutput {
  body: string;
  expectedText: string[];
  bodyText: string[];
  expectedAssets: string[];
  provenanceFlags: string[];
  fallbackDiagnostics: ReconstructResult['fallbackDiagnostics'];
  iconAssets: ReconstructResult['iconAssets'];
  heroIsCover: boolean;
}

interface BaselineRecord {
  id: string;
  input: {
    convertedSections: FrozenConvertedSection[];
  };
  output: BaselineOutput;
}

interface BaselineFile {
  version: 1;
  cases: BaselineRecord[];
}

const GOLDEN_PATH = fileURLToPath(new URL('./fixtures/page-reconstruct-dla-baseline.goldens.json', import.meta.url));
const UPDATE = process.env.UPDATE_DLA_RECONSTRUCT_GOLDENS === '1';

function hydrateOptions(testCase: FrozenReconstructCase): ReconstructOptions {
  const { convertedSections, ...rest } = testCase.options;
  return {
    ...rest,
    ...(convertedSections
      ? {
          convertedSections: new Map(
            convertedSections.map((entry) => [
              entry.sectionIndex,
              { markup: entry.markup, wpHtmlResidue: entry.wpHtmlResidue },
            ]),
          ),
        }
      : {}),
  };
}

function freezeResult(result: ReconstructResult): BaselineOutput {
  return {
    body: result.body,
    expectedText: result.expectedText,
    bodyText: result.bodyText,
    expectedAssets: result.expectedAssets,
    provenanceFlags: result.provenanceFlags,
    fallbackDiagnostics: result.fallbackDiagnostics,
    iconAssets: result.iconAssets,
    heroIsCover: result.heroIsCover,
  };
}

function runCorpus(): BaselineFile {
  return {
    version: 1,
    cases: reconstructBaselineCases.map((testCase) => ({
      id: testCase.id,
      input: {
        convertedSections: testCase.options.convertedSections ?? [],
      },
      output: freezeResult(reconstructPagePattern(testCase.sections, hydrateOptions(testCase))),
    })),
  };
}

function readGolden(): BaselineFile {
  if (!existsSync(GOLDEN_PATH)) {
    throw new Error(`Missing DLA reconstruct baseline golden: ${GOLDEN_PATH}`);
  }
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as BaselineFile;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function collectDiffs(actual: BaselineFile, expected: BaselineFile): string[] {
  const diffs: string[] = [];
  if (actual.version !== expected.version) diffs.push(`version: expected ${expected.version}, got ${actual.version}`);

  const expectedById = new Map(expected.cases.map((record) => [record.id, record]));
  for (const actualCase of actual.cases) {
    const expectedCase = expectedById.get(actualCase.id);
    if (!expectedCase) {
      diffs.push(`${actualCase.id}: missing from checked-in goldens`);
      continue;
    }
    if (stableJson(actualCase.input) !== stableJson(expectedCase.input)) {
      diffs.push(`${actualCase.id}: frozen input changed`);
    }
    if (stableJson(actualCase.output) !== stableJson(expectedCase.output)) {
      diffs.push(`${actualCase.id}: output changed`);
    }
  }

  const actualIds = new Set(actual.cases.map((record) => record.id));
  for (const expectedCase of expected.cases) {
    if (!actualIds.has(expectedCase.id)) diffs.push(`${expectedCase.id}: golden has no corpus case`);
  }
  return diffs;
}

describe('reconstructPagePattern DLA-today baseline freeze', () => {
  it('matches checked-in goldens and is byte-stable across two runs', () => {
    const first = runCorpus();
    const second = runCorpus();
    const stabilityDiffs = collectDiffs(first, second);
    expect(stabilityDiffs).toEqual([]);

    if (UPDATE) {
      mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
      writeFileSync(GOLDEN_PATH, `${stableJson(first)}\n`);
    }

    const diffs = UPDATE ? [] : collectDiffs(first, readGolden());
    console.info(`DLA reconstruct baseline: cases=${first.cases.length} diffs=${diffs.length}`);
    expect(diffs).toEqual([]);
  });
});
