import { describe, it, expect, vi } from 'vitest';
import { analyzePage, type PageAnalysis } from './site-analysis.js';

function makeMockPage(returnValue: unknown) {
  return { evaluate: vi.fn().mockResolvedValue(returnValue) };
}

describe('analyzePage', () => {
  it('returns palette, typography, metadata, and breakpoints', async () => {
    const mock: PageAnalysis = {
      palette: [
        { hex: '#ffffff', count: 100 },
        { hex: '#000000', count: 50 },
      ],
      typography: {
        h1: { fontFamily: 'Helvetica', fontSize: '32px', fontWeight: '700', lineHeight: '40px' },
        body: { fontFamily: 'Helvetica', fontSize: '16px', fontWeight: '400', lineHeight: '24px' },
      },
      computedStyles: {
        button: {
          color: '#ffffff',
          backgroundColor: '#0055aa',
          borderColor: '#0055aa',
          borderRadius: '4px',
          backgroundImage: 'none',
        },
      },
      metadata: {
        title: 'About',
        metaDescription: 'Learn more',
        openGraph: { 'og:title': 'About', 'og:image': 'https://example.com/og.png' },
        jsonLdTypes: ['WebPage'],
        htmlBytes: 12_345,
      },
      breakpoints: {
        minWidth: [480, 768, 1024],
        maxWidth: [767],
      },
    };
    const page = makeMockPage(mock);
    const result = await analyzePage(page as never);
    expect(result.palette).toHaveLength(2);
    expect(result.typography.h1?.fontFamily).toBe('Helvetica');
    expect(result.computedStyles?.button?.backgroundColor).toBe('#0055aa');
    expect(result.metadata.title).toBe('About');
    expect(result.breakpoints.minWidth).toEqual([480, 768, 1024]);
    expect(result.breakpoints.maxWidth).toEqual([767]);
  });

  it('validates return shape and rejects garbage — missing palette', async () => {
    const page = makeMockPage({ not: 'valid' });
    await expect(analyzePage(page as never)).rejects.toThrow(/palette|shape/i);
  });

  it('rejects when typography missing', async () => {
    const page = makeMockPage({ palette: [], metadata: {}, breakpoints: { minWidth: [], maxWidth: [] } });
    await expect(analyzePage(page as never)).rejects.toThrow(/typography|shape/i);
  });

  it('rejects when metadata missing', async () => {
    const page = makeMockPage({ palette: [], typography: {}, breakpoints: { minWidth: [], maxWidth: [] } });
    await expect(analyzePage(page as never)).rejects.toThrow(/metadata|shape/i);
  });

  it('rejects when breakpoints missing', async () => {
    const page = makeMockPage({ palette: [], typography: {}, metadata: {} });
    await expect(analyzePage(page as never)).rejects.toThrow(/breakpoints|shape/i);
  });

  it('rejects when breakpoints is wrong shape', async () => {
    const page = makeMockPage({
      palette: [],
      typography: {},
      metadata: {},
      breakpoints: { minWidth: 'oops', maxWidth: [] },
    });
    await expect(analyzePage(page as never)).rejects.toThrow(/minWidth|arrays/i);
  });

  it('passes through captured :root CSS custom properties', async () => {
    const mock = {
      palette: [],
      typography: {},
      metadata: {},
      breakpoints: { minWidth: [], maxWidth: [] },
      cssVariables: [
        { name: '--brand-primary', value: '#1d6f42', isColor: true },
        { name: '--radius-base', value: '8px', isColor: false },
      ],
    };
    const result = await analyzePage(makeMockPage(mock) as never);
    expect(result.cssVariables).toHaveLength(2);
    expect(result.cssVariables?.[0]).toEqual({ name: '--brand-primary', value: '#1d6f42', isColor: true });
  });

  it('rejects when cssVariables is present but not an array', async () => {
    const page = makeMockPage({
      palette: [],
      typography: {},
      metadata: {},
      breakpoints: { minWidth: [], maxWidth: [] },
      cssVariables: 'nope',
    });
    await expect(analyzePage(page as never)).rejects.toThrow(/cssVariables/i);
  });
});
