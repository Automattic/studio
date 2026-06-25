import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SiteAnalysisAggregator } from './aggregator.js';
import type { PageAnalysis } from './site-analysis.js';

function makeAnalysis(overrides: Partial<PageAnalysis> = {}): PageAnalysis {
  return {
    palette: [{ hex: '#ffffff', count: 10 }],
    typography: {
      body: { fontFamily: 'Inter, sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '24px' },
    },
    metadata: { title: '', metaDescription: '', openGraph: {}, jsonLdTypes: [], htmlBytes: 0 },
    breakpoints: { minWidth: [768], maxWidth: [] },
    ...overrides,
  };
}

describe('SiteAnalysisAggregator', () => {
  it('buckets palette entries by hex across URLs', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('https://a.com/1', makeAnalysis({ palette: [{ hex: '#ff0000', count: 5 }] }));
    agg.add('https://a.com/2', makeAnalysis({ palette: [{ hex: '#ff0000', count: 3 }] }));
    agg.add('https://a.com/3', makeAnalysis({ palette: [{ hex: '#00ff00', count: 2 }] }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      expect(palette.version).toBe(1);
      expect(palette.sampledUrls).toBe(3);
      const red = palette.colors.find((c: { hex: string }) => c.hex === '#ff0000');
      expect(red.count).toBe(8);
      expect(red.urls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ranks palette by urls desc, count desc', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('a', makeAnalysis({ palette: [{ hex: '#aaa', count: 100 }] }));
    agg.add('b', makeAnalysis({ palette: [{ hex: '#bbb', count: 5 }] }));
    agg.add('c', makeAnalysis({ palette: [{ hex: '#bbb', count: 5 }] }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      expect(palette.colors[0].hex).toBe('#bbb');
      expect(palette.colors[1].hex).toBe('#aaa');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('limits palette to top 24', () => {
    const agg = new SiteAnalysisAggregator();
    for (let i = 0; i < 30; i++) {
      agg.add(`u${i}`, makeAnalysis({ palette: [{ hex: `#${i.toString(16).padStart(6, '0')}`, count: i }] }));
    }

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      expect(palette.colors.length).toBe(24);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deduplicates typography tuples within selector', () => {
    const agg = new SiteAnalysisAggregator();
    const same = { body: { fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px' } };
    agg.add('u1', makeAnalysis({ typography: same }));
    agg.add('u2', makeAnalysis({ typography: same }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const typo = JSON.parse(readFileSync(join(dir, 'typography.json'), 'utf8'));
      expect(typo.bySelector.body).toHaveLength(1);
      expect(typo.bySelector.body[0].urls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ranks typography by urls desc', () => {
    const agg = new SiteAnalysisAggregator();
    const variantA = { body: { fontFamily: 'Inter', fontSize: '16px', fontWeight: '400', lineHeight: '24px' } };
    const variantB = { body: { fontFamily: 'Helvetica', fontSize: '16px', fontWeight: '400', lineHeight: '24px' } };
    agg.add('u1', makeAnalysis({ typography: variantA }));
    agg.add('u2', makeAnalysis({ typography: variantA }));
    agg.add('u3', makeAnalysis({ typography: variantA }));
    agg.add('u4', makeAnalysis({ typography: variantB }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const typo = JSON.parse(readFileSync(join(dir, 'typography.json'), 'utf8'));
      expect(typo.bySelector.body[0].fontFamily).toBe('Inter');
      expect(typo.bySelector.body[0].urls).toBe(3);
      expect(typo.bySelector.body[1].fontFamily).toBe('Helvetica');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unions breakpoint minWidth and maxWidth sets', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('u1', makeAnalysis({ breakpoints: { minWidth: [480, 768], maxWidth: [767] } }));
    agg.add('u2', makeAnalysis({ breakpoints: { minWidth: [768, 1024], maxWidth: [1023] } }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const bp = JSON.parse(readFileSync(join(dir, 'breakpoints.json'), 'utf8'));
      expect(bp.minWidth).toEqual([480, 768, 1024]);
      expect(bp.maxWidth).toEqual([767, 1023]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deduplicates computed styles by selector and records URL counts', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('u1', makeAnalysis({
      computedStyles: {
        button: {
          color: '#ffffff',
          backgroundColor: '#0055aa',
          borderColor: '#0055aa',
          borderRadius: '4px',
          backgroundImage: 'none',
        },
      },
    }));
    agg.add('u2', makeAnalysis({
      computedStyles: {
        button: {
          color: '#ffffff',
          backgroundColor: '#0055aa',
          borderColor: '#0055aa',
          borderRadius: '4px',
          backgroundImage: 'none',
        },
      },
    }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const computed = JSON.parse(readFileSync(join(dir, 'computed-styles.json'), 'utf8'));
      expect(computed.version).toBe(1);
      expect(computed.sampledUrls).toBe(2);
      expect(computed.bySelector.button).toHaveLength(1);
      expect(computed.bySelector.button[0].backgroundColor).toBe('#0055aa');
      expect(computed.bySelector.button[0].urls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sorts breakpoints ascending', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('u1', makeAnalysis({ breakpoints: { minWidth: [1024, 480, 768], maxWidth: [] } }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const bp = JSON.parse(readFileSync(join(dir, 'breakpoints.json'), 'utf8'));
      expect(bp.minWidth).toEqual([480, 768, 1024]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serializes atomically via tmp + rename', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('u1', makeAnalysis());

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      expect(existsSync(join(dir, 'palette.json'))).toBe(true);
      expect(existsSync(join(dir, 'palette.json.tmp'))).toBe(false);
      expect(existsSync(join(dir, 'typography.json.tmp'))).toBe(false);
      expect(existsSync(join(dir, 'breakpoints.json.tmp'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges with prior run files on init', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      mkdirSync(dir, { recursive: true });

      // Simulate a prior run: a URL with red palette entry.
      const agg1 = new SiteAnalysisAggregator();
      agg1.add('u1', makeAnalysis({ palette: [{ hex: '#ff0000', count: 10 }] }));
      agg1.serialize(dir);

      // Second run: loads prior, adds new URL with a different color.
      const agg2 = new SiteAnalysisAggregator();
      agg2.init(dir);
      agg2.add('u2', makeAnalysis({ palette: [{ hex: '#00ff00', count: 5 }] }));
      agg2.serialize(dir);

      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      // Union of prior + new URLs
      expect(palette.sampledUrls).toBe(2);
      const hexes = palette.colors.map((c: { hex: string }) => c.hex);
      expect(hexes).toContain('#ff0000');
      expect(hexes).toContain('#00ff00');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes sampledUrls: 0 when no analyses added', () => {
    const agg = new SiteAnalysisAggregator();
    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      const typo = JSON.parse(readFileSync(join(dir, 'typography.json'), 'utf8'));
      const bp = JSON.parse(readFileSync(join(dir, 'breakpoints.json'), 'utf8'));
      expect(palette.sampledUrls).toBe(0);
      expect(typo.sampledUrls).toBe(0);
      expect(bp.sampledUrls).toBe(0);
      expect(palette.colors).toEqual([]);
      expect(typo.bySelector).toEqual({});
      expect(bp.minWidth).toEqual([]);
      expect(bp.maxWidth).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores corrupt prior-run files and starts fresh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      writeFileSync(join(dir, 'palette.json'), '{not valid json');
      writeFileSync(join(dir, 'typography.json'), 'garbage');
      writeFileSync(join(dir, 'breakpoints.json'), 'also not json');

      const agg = new SiteAnalysisAggregator();
      agg.init(dir); // should not throw
      agg.add('u1', makeAnalysis());
      agg.serialize(dir);

      const palette = JSON.parse(readFileSync(join(dir, 'palette.json'), 'utf8'));
      expect(palette.sampledUrls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aggregates :root CSS variables across URLs, deduped by name and ranked by urls desc', () => {
    const agg = new SiteAnalysisAggregator();
    agg.add('https://a.test/1', makeAnalysis({ cssVariables: [
      { name: '--brand-primary', value: '#1d6f42', isColor: true },
      { name: '--radius-base', value: '8px', isColor: false },
    ] }));
    agg.add('https://a.test/2', makeAnalysis({ cssVariables: [
      { name: '--brand-primary', value: '#1d6f42', isColor: true },
    ] }));

    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      agg.serialize(dir);
      const cssVars = JSON.parse(readFileSync(join(dir, 'css-variables.json'), 'utf8'));
      expect(cssVars.version).toBe(1);
      expect(cssVars.sampledUrls).toBe(2);
      // --brand-primary appears on 2 urls, --radius-base on 1 → primary ranks first.
      expect(cssVars.variables[0]).toMatchObject({ name: '--brand-primary', value: '#1d6f42', isColor: true, urls: 2 });
      const radius = cssVars.variables.find((v: { name: string }) => v.name === '--radius-base');
      expect(radius).toMatchObject({ value: '8px', isColor: false, urls: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resume-merges css-variables.json from a prior run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agg-'));
    try {
      const first = new SiteAnalysisAggregator();
      first.add('https://a.test/1', makeAnalysis({ cssVariables: [
        { name: '--brand-primary', value: '#1d6f42', isColor: true },
      ] }));
      first.serialize(dir);

      const second = new SiteAnalysisAggregator();
      second.init(dir);
      second.add('https://a.test/2', makeAnalysis({ cssVariables: [
        { name: '--brand-primary', value: '#1d6f42', isColor: true },
      ] }));
      second.serialize(dir);

      const cssVars = JSON.parse(readFileSync(join(dir, 'css-variables.json'), 'utf8'));
      const primary = cssVars.variables.find((v: { name: string }) => v.name === '--brand-primary');
      expect(primary.urls).toBe(2);
      expect(cssVars.sampledUrls).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
