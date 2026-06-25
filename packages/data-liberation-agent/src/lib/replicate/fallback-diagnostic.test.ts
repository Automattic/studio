import { describe, it, expect } from 'vitest';
import { buildFallbackDiagnostic, buildTriageRemovalDiagnostic } from './fallback-diagnostic.js';
import type { SectionSpec } from './section-extract.js';

const section = (over: Partial<SectionSpec> = {}): SectionSpec =>
  ({ sectionIndex: 3, interactionModel: 'hero', selector: 'section#hero', top: 0, height: 0,
     headings: [], bodyText: [], buttonLabels: [], images: [], icons: [],
     backgroundBrightness: 255, backgroundColor: 'rgb(255,255,255)', gradient: null,
     gradientSource: null, motionProfile: {} as never, dividerAbove: null, dividerBelow: null,
     layout: {} as never, ...over }) as SectionSpec;

describe('buildFallbackDiagnostic', () => {
  it('flags dropped_images with precedence over text', () => {
    const d = buildFallbackDiagnostic({
      page: 'https://example.test/about', slug: 'about', section: section(),
      coverage: { textCoverage: 0.2, missingImages: ['https://cdn/x.jpg'], lost: true },
      islandKind: 'verbatim', islandMarkup: '<!-- wp:html --><figure>x</figure><!-- /wp:html -->',
    });
    expect(d.reasonCode).toBe('dropped_images');
    expect(d.suggestedRepairClass).toBe('recover_dropped_media');
    expect(d.id).toBe('about-s3-dropped_images');
    expect(d.selector).toBe('section#hero');
    expect(d.droppedImages).toEqual(['https://cdn/x.jpg']);
    expect(d.severity).toBe('warning');
  });
  it('flags text_coverage_below_floor when no images dropped', () => {
    const d = buildFallbackDiagnostic({
      page: 'https://example.test/', slug: 'home', section: section({ sectionIndex: 1 }),
      coverage: { textCoverage: 0.33, missingImages: [], lost: true },
      islandKind: 'styled', islandMarkup: '<!-- wp:html -->...<!-- /wp:html -->',
    });
    expect(d.reasonCode).toBe('text_coverage_below_floor');
    expect(d.suggestedRepairClass).toBe('restructure_section_blocks');
    expect(d.islandKind).toBe('styled');
    expect(d.textCoverage).toBe(0.33);
  });
});

describe('buildTriageRemovalDiagnostic', () => {
  it('records a triage removal with description in the free-text channel', () => {
    const d = buildTriageRemovalDiagnostic({
      page: 'https://example.test/about', slug: 'about', sectionIndex: 2, interactionModel: 'static',
      removal: {
        url: 'https://example.test/divider.svg',
        sectionSelector: 'main > section:nth-of-type(2)',
        description: 'thin full-width horizontal rule between sections',
      },
      ordinal: 0,
    });
    expect(d.id).toBe('about-s2-decorative_asset_triaged-0');
    expect(d.reasonCode).toBe('decorative_asset_triaged');
    expect(d.islandKind).toBe('none');
    expect(d.suggestedRepairClass).toBe('replace_with_structural_block');
    expect(d.selector).toBe('main > section:nth-of-type(2)');
    expect(d.droppedImages).toEqual(['https://example.test/divider.svg']);
    expect(d.sourceHtmlPreview).toBe('thin full-width horizontal rule between sections');
    expect(d.emittedBlockPreview).toBe('');
    expect(d.severity).toBe('warning');
    expect(d.textCoverage).toBe(1);
  });
});
