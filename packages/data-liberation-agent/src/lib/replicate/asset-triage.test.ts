// src/lib/replicate/asset-triage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadAssetTriage, applyAssetTriage, type AssetTriageFile } from './asset-triage.js';
import type { SectionSpec } from './section-extract.js';

const base = join(process.cwd(), '.tmp-test', 'asset-triage');

const triage: AssetTriageFile = {
  schema: 1,
  site: 'https://example.test',
  entries: [
    { url: 'https://example.test/divider.svg', sectionSelector: 'main > section:nth-of-type(1)', verdict: 'decoration', description: 'thin full-width horizontal rule between sections' },
    { url: 'https://example.test/logo.svg', sectionSelector: 'main > section:nth-of-type(2)', verdict: 'keep', description: '' },
  ],
};

function spec(selector: string, urls: string[]): SectionSpec {
  return {
    sectionIndex: 0, interactionModel: 'static', top: 0, height: 500,
    headings: [], bodyText: [], buttonLabels: [],
    images: urls.map(url => ({ url, sourceUrl: url, alt: '', kind: 'img' as const, width: 100, height: 100 })),
    selector,
  } as unknown as SectionSpec;
}

describe('loadAssetTriage', () => {
  // Each test starts from a clean, EXISTING base dir with no triage file —
  // self-sufficient regardless of run order. loadAssetTriage only checks the
  // FILE, so dir-exists-file-absent still exercises the absent path.
  beforeEach(() => {
    rmSync(base, { recursive: true, force: true });
    mkdirSync(base, { recursive: true });
  });
  it('returns null when the file is absent', () => {
    expect(loadAssetTriage(base)).toBeNull();
  });
  it('returns null (fail-open) on malformed JSON', () => {
    writeFileSync(join(base, 'asset-triage.json'), '{nope');
    expect(loadAssetTriage(base)).toBeNull();
  });
  it('loads a valid file', () => {
    writeFileSync(join(base, 'asset-triage.json'), JSON.stringify(triage));
    expect(loadAssetTriage(base)?.entries).toHaveLength(2);
  });
});

describe('applyAssetTriage', () => {
  it('removes decoration images from the matching section only, returns removal records', () => {
    const specs = [
      spec('main > section:nth-of-type(1)', ['https://example.test/divider.svg', 'https://example.test/photo.jpg']),
      spec('main > section:nth-of-type(2)', ['https://example.test/divider.svg']),
    ];
    const r = applyAssetTriage(specs, triage);
    expect(r.specs[0].images.map(i => i.url)).toEqual(['https://example.test/photo.jpg']);
    expect(r.specs[1].images).toHaveLength(1);
    expect(r.removed).toEqual([{
      url: 'https://example.test/divider.svg',
      sectionSelector: 'main > section:nth-of-type(1)',
      description: 'thin full-width horizontal rule between sections',
    }]);
  });

  it('keep verdicts change nothing', () => {
    const specs = [spec('main > section:nth-of-type(2)', ['https://example.test/logo.svg'])];
    const r = applyAssetTriage(specs, triage);
    expect(r.specs[0].images).toHaveLength(1);
    expect(r.removed).toHaveLength(0);
  });
});
