import { describe, expect, it } from 'vitest';
import {
  buildFallbackDiagnostic,
  buildTriageRemovalDiagnostic,
  type AssetRemoval,
  type FallbackDiagnostic,
  type FallbackReasonCode,
  type FallbackRepairClass,
} from '@automattic/blocks-engine/theme';
import type { SectionSpec } from '../section-extract.js';

const section = (over: Partial<SectionSpec> = {}): SectionSpec =>
  ({
    sectionIndex: 3,
    interactionModel: 'hero',
    selector: 'section#hero',
    top: 0,
    height: 0,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255,255,255)',
    gradient: null,
    gradientSource: null,
    motionProfile: {} as never,
    dividerAbove: null,
    dividerBelow: null,
    layout: {} as never,
    ...over,
  }) as SectionSpec;

const typedReason: FallbackReasonCode = 'decorative_asset_triaged';
const typedRepair: FallbackRepairClass = 'replace_with_structural_block';

describe('engine fallback diagnostic adoption', () => {
  it('keeps dropped image precedence with the DLA golden record', () => {
    const diagnostic: FallbackDiagnostic = buildFallbackDiagnostic({
      page: 'https://example.test/about',
      slug: 'about',
      section: section({
        styledHtml: '<section><h1>Hero</h1><img src="hero.jpg"></section>',
        sectionHtml: '<section><h1>Fallback</h1></section>',
      }),
      coverage: { textCoverage: 0.2, missingImages: ['https://cdn/x.jpg'], lost: true },
      islandKind: 'verbatim',
      islandMarkup: '<!-- wp:html --><figure>x</figure><!-- /wp:html -->',
    });

    expect(diagnostic).toEqual({
      id: 'about-s3-dropped_images',
      page: 'https://example.test/about',
      sectionIndex: 3,
      interactionModel: 'hero',
      selector: 'section#hero',
      severity: 'warning',
      reasonCode: 'dropped_images',
      islandKind: 'verbatim',
      droppedImages: ['https://cdn/x.jpg'],
      textCoverage: 0.2,
      suggestedRepairClass: 'recover_dropped_media',
      sourceHtmlPreview: '<section><h1>Hero</h1><img src="hero.jpg"></section>',
      emittedBlockPreview: '<!-- wp:html --><figure>x</figure><!-- /wp:html -->',
    });
  });

  it('keeps text coverage fallback records and rounds coverage', () => {
    const diagnostic = buildFallbackDiagnostic({
      page: 'https://example.test/',
      slug: 'home',
      section: section({ sectionIndex: 1, styledHtml: '', sectionHtml: '<section>Home body</section>' }),
      coverage: { textCoverage: 0.333, missingImages: [], lost: true },
      islandKind: 'styled',
      islandMarkup: '<!-- wp:html -->...<!-- /wp:html -->',
    });

    expect(diagnostic).toEqual({
      id: 'home-s1-text_coverage_below_floor',
      page: 'https://example.test/',
      sectionIndex: 1,
      interactionModel: 'hero',
      selector: 'section#hero',
      severity: 'warning',
      reasonCode: 'text_coverage_below_floor',
      islandKind: 'styled',
      droppedImages: [],
      textCoverage: 0.33,
      suggestedRepairClass: 'restructure_section_blocks',
      sourceHtmlPreview: '',
      emittedBlockPreview: '<!-- wp:html -->...<!-- /wp:html -->',
    });
  });

  it('keeps responsive island preview truncation and selector fallback behavior', () => {
    const diagnostic = buildFallbackDiagnostic({
      page: 'https://example.test/services',
      slug: 'services',
      section: section({
        sectionIndex: 5,
        interactionModel: 'cta',
        selector: undefined,
        styledHtml: `<section>${'x'.repeat(250)}</section>`,
      }),
      coverage: { textCoverage: 0.005, missingImages: [], lost: true },
      islandKind: 'responsive',
      islandMarkup: `<div>${'y'.repeat(250)}</div>`,
    });

    expect(diagnostic.id).toBe('services-s5-text_coverage_below_floor');
    expect(diagnostic.selector).toBe('');
    expect(diagnostic.islandKind).toBe('responsive');
    expect(diagnostic.textCoverage).toBe(0.01);
    expect(diagnostic.sourceHtmlPreview).toHaveLength(200);
    expect(diagnostic.emittedBlockPreview).toHaveLength(200);
  });

  it('keeps decorative asset triage records through the engine barrel', () => {
    const removal: AssetRemoval = {
      url: 'https://example.test/divider.svg',
      sectionSelector: 'main > section:nth-of-type(2)',
      description: 'thin full-width horizontal rule between sections',
    };

    const diagnostic = buildTriageRemovalDiagnostic({
      page: 'https://example.test/about',
      slug: 'about',
      sectionIndex: 2,
      interactionModel: 'static',
      removal,
      ordinal: 0,
    });

    expect(diagnostic).toEqual({
      id: 'about-s2-decorative_asset_triaged-0',
      page: 'https://example.test/about',
      sectionIndex: 2,
      interactionModel: 'static',
      selector: 'main > section:nth-of-type(2)',
      severity: 'warning',
      reasonCode: typedReason,
      islandKind: 'none',
      droppedImages: ['https://example.test/divider.svg'],
      textCoverage: 1,
      suggestedRepairClass: typedRepair,
      sourceHtmlPreview: 'thin full-width horizontal rule between sections',
      emittedBlockPreview: '',
    });
  });
});
