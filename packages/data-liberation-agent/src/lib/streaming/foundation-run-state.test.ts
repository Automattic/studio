import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyState, loadReplicateState, saveReplicateState } from './replicate-state.js';
import { computeInputsDigest } from './foundation-drift.js';
import {
  foundationRevDecision,
  recordFoundationInputsDigest,
  selectFoundationSample,
} from './foundation-run-state.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmp(): string {
  return mkdtempSync(join(FIXTURE_TMP, 'frs-'));
}

function seedFoundationInputs(dir: string): { digest: string } {
  const palette = {
    version: 1,
    sampledUrls: 3,
    colors: [{ hex: '#000000', count: 10, urls: 3 }],
  };
  const typography = {
    version: 1,
    sampledUrls: 3,
    bySelector: { body: [{ fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px', urls: 3 }] },
  };
  const breakpoints = { version: 1, sampledUrls: 3, minWidth: [768], maxWidth: [] };
  writeFileSync(join(dir, 'palette.json'), JSON.stringify(palette));
  writeFileSync(join(dir, 'typography.json'), JSON.stringify(typography));
  writeFileSync(join(dir, 'breakpoints.json'), JSON.stringify(breakpoints));
  return { digest: computeInputsDigest(palette, typography, breakpoints) };
}

describe('foundation run state', () => {
  it('skips a foundation-rev when the current aggregate digest is already recorded', () => {
    const dir = tmp();
    const { digest } = seedFoundationInputs(dir);
    saveReplicateState(dir, { ...emptyState(), lastFoundationInputsDigest: digest });

    expect(foundationRevDecision(dir)).toEqual({
      shouldRun: false,
      digest,
      reason: 'foundation inputs unchanged',
    });
  });

  it('runs a foundation-rev when the recorded digest is stale', () => {
    const dir = tmp();
    const { digest } = seedFoundationInputs(dir);
    saveReplicateState(dir, {
      ...emptyState(),
      lastFoundationInputsDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });

    expect(foundationRevDecision(dir)).toEqual({
      shouldRun: true,
      digest,
      reason: 'foundation inputs changed',
    });
  });

  it('records the current foundation aggregate digest after a successful run', () => {
    const dir = tmp();
    const { digest } = seedFoundationInputs(dir);

    const recorded = recordFoundationInputsDigest(dir);

    expect(recorded).toBe(digest);
    expect(loadReplicateState(dir).lastFoundationInputsDigest).toBe(digest);
  });

  it('uses one representative sample for the foundation fast path and prefers homepage', () => {
    const sample = selectFoundationSample({
      page: [
        { url: 'a', html: 'html/a.html', screenshot: 'screenshots/desktop/a.png' },
        { url: 'b', html: 'html/b.html', screenshot: 'screenshots/desktop/b.png' },
        { url: 'c', html: 'html/c.html', screenshot: 'screenshots/desktop/c.png' },
        { url: 'd', html: 'html/d.html', screenshot: 'screenshots/desktop/d.png' },
      ],
      homepage: [
        { url: 'home', html: 'html/home.html', screenshot: 'screenshots/desktop/home.png' },
      ],
      product: [
        { url: 'p1', html: 'html/p1.html', screenshot: 'screenshots/desktop/p1.png' },
        { url: 'p2', html: 'html/p2.html', screenshot: 'screenshots/desktop/p2.png' },
      ],
    });

    expect(sample).toEqual({
      homepage: [{ url: 'home', html: 'html/home.html', screenshot: 'screenshots/desktop/home.png' }],
    });
  });
});
