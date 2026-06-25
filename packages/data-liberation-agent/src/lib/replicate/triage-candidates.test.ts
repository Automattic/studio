// src/lib/replicate/triage-candidates.test.ts
import { describe, it, expect } from 'vitest';
import { selectTriageCandidates, selectorKey } from './triage-candidates.js';
import type { SectionSpec, SectionSpecImage } from './section-extract.js';

function img(over: Partial<SectionSpecImage>): SectionSpecImage {
  return { url: 'https://example.test/a.jpg', sourceUrl: 'https://example.test/a.jpg', alt: '', kind: 'img', width: 800, height: 600, ...over };
}

function spec(images: SectionSpecImage[], over: Partial<SectionSpec> = {}): SectionSpec {
  return {
    sectionIndex: 0, interactionModel: 'static', top: 0, height: 500,
    headings: ['Sample heading'], bodyText: ['Sample paragraph.'], buttonLabels: [],
    images, selector: 'main > section:nth-of-type(1)',
    ...over,
  } as unknown as SectionSpec;
}

describe('selectTriageCandidates', () => {
  it('selects SVGs', () => {
    const out = selectTriageCandidates([spec([img({ url: 'https://example.test/divider.svg' })])]);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('svg');
    expect(out[0].sectionSelector).toBe('main > section:nth-of-type(1)');
  });

  it('selects extreme aspect ratios (>8:1 or <1:8)', () => {
    const out = selectTriageCandidates([spec([img({ width: 1600, height: 100 })])]);
    expect(out.map(c => c.reason)).toContain('extreme-aspect');
  });

  it('selects tiny images (<48px either dimension, >0)', () => {
    const out = selectTriageCandidates([spec([img({ width: 32, height: 32 })])]);
    expect(out.map(c => c.reason)).toContain('tiny');
  });

  it('selects background images only when the section has no text', () => {
    const textless = spec([img({ kind: 'background' })], { headings: [], bodyText: [] });
    const withText = spec([img({ kind: 'background' })]);
    expect(selectTriageCandidates([textless]).map(c => c.reason)).toContain('background-only');
    expect(selectTriageCandidates([withText])).toHaveLength(0);
  });

  it('NEVER selects ordinary content photos', () => {
    const out = selectTriageCandidates([spec([img({})])]);
    expect(out).toHaveLength(0);
  });

  it('dedupes by url + selector', () => {
    const s = spec([img({ url: 'https://example.test/x.svg' }), img({ url: 'https://example.test/x.svg' })]);
    expect(selectTriageCandidates([s])).toHaveLength(1);
  });
});

describe('selectorKey', () => {
  it('uses the captured selector, falling back to the pinned section-index format', () => {
    expect(selectorKey({ selector: 'main > section:nth-of-type(1)', sectionIndex: 4 })).toBe('main > section:nth-of-type(1)');
    // Pinned: this exact fallback string is the cross-surface join key
    // (candidates → asset-triage.json → applyAssetTriage). Do not reformat.
    expect(selectorKey({ selector: undefined, sectionIndex: 4 })).toBe('section-index-4');
  });
});
