import { describe, expect, it } from 'vitest';
import {
  normalizeCopy,
  sanitizePatternHeaderField,
  sanitizeSvgAsset,
  stripChrome,
  type FontFamilyToken,
} from '@automattic/blocks-engine/theme';
import type { SectionSpec } from '../section-extract.js';

const section = (over: Partial<SectionSpec> = {}): SectionSpec =>
  ({
    sectionIndex: 0,
    interactionModel: 'static',
    top: 0,
    height: 400,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255, 255, 255)',
    gradient: null,
    gradientSource: null,
    motionProfile: {} as never,
    dividerAbove: null,
    dividerBelow: null,
    layout: {} as never,
    ...over,
  }) as SectionSpec;

describe('engine page-reconstruct helper adoption', () => {
  it('keeps the DLA normalizeCopy goldens', () => {
    expect(normalizeCopy('  foo\u00ad\u200b   bar\n baz ')).toBe('foo bar baz');
    expect(normalizeCopy('\uFEFFAlpha\u200D   Beta')).toBe('Alpha Beta');
  });

  it('keeps the DLA pattern-header sanitization goldens', () => {
    expect(sanitizePatternHeaderField('*/ evil(); /*')).toBe('evil();');
    expect(sanitizePatternHeaderField('a <?php b ?> c')).toBe('a php b  c');
    expect(sanitizePatternHeaderField('line1\nline2')).toBe('line1 line2');
    expect(sanitizePatternHeaderField('demo-replica/page-x')).toBe('demo-replica/page-x');
  });

  it('keeps the DLA chrome-strip behavior over SectionSpec', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, interactionModel: 'nav', height: 96, bodyText: ['Home', 'About', 'Contact'] }),
      section({ sectionIndex: 1, headings: ['Hero'], height: 600 }),
      section({
        sectionIndex: 2,
        interactionModel: 'columns',
        bodyText: ['PRODUCTS', 'GALLERY', 'CALL US', 'copyright 2026 Website by Acme Studio'],
      }),
    ]);

    expect(out.map((s) => s.sectionIndex)).toEqual([1]);
  });

  it('keeps mid-page content while stripping only edge chrome', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, headings: ['Top'] }),
      section({ sectionIndex: 1, backgroundColor: 'rgb(47, 56, 78)', headings: ['100 Night Happiness Guarantee'] }),
      section({ sectionIndex: 2, interactionModel: 'footer', headings: ['Shop', 'Support', 'Company'] }),
    ]);

    expect(out.map((s) => s.sectionIndex)).toEqual([0, 1]);
  });

  it('keeps the DLA SVG sanitizer goldens', () => {
    expect(sanitizeSvgAsset('<svg><script>alert(1)</script><path d="M3 9h4"/></svg>')).toBe(
      '<svg><path d="M3 9h4"/></svg>',
    );
    expect(sanitizeSvgAsset('<svg><foreignObject>x</foreignObject><path d="M3"/></svg>')).toBe(
      '<svg><path d="M3"/></svg>',
    );
    expect(sanitizeSvgAsset('<svg><set attributeName="onload" to="alert(1)"/></svg>')).toBe('<svg></svg>');
    expect(sanitizeSvgAsset('<svg><image href="https://evil.example/x"/><use href="#local"/></svg>')).toBe(
      '<svg><image/><use href="#local"/></svg>',
    );
    expect(sanitizeSvgAsset('<svg><a xlink:href="javascript:alert(1)">x</a></svg>')).toBe(
      '<svg><a xlink:href="alert(1)">x</a></svg>',
    );
  });

  it('exports the DLA-compatible FontFamilyToken shape', () => {
    const token: FontFamilyToken = { slug: 'source-serif', family: 'Source Serif 4, serif' };
    expect(token).toEqual({ slug: 'source-serif', family: 'Source Serif 4, serif' });
  });
});
