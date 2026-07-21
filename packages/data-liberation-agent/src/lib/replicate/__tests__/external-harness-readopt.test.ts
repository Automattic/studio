import { describe, expect, it } from 'vitest';
import { buildPageReconstruction } from '../reconstruct-pages.js';
import type { SectionSpec } from '../section-extract.js';

const WP = '/wp-content/uploads/2026/06/';

function section(partial: Partial<SectionSpec>): SectionSpec {
  return {
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
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: null,
    dividerBelow: null,
    layout: { containerWidth: 1200, padding: '0', childLayout: 'stack', columnCount: 1, gap: '0' },
    ...partial,
  } as SectionSpec;
}

function img(url: string, partial: Partial<NonNullable<SectionSpec['images']>[number]> = {}) {
  return {
    url,
    sourceUrl: url,
    alt: '',
    kind: 'img' as const,
    width: 800,
    height: 600,
    ...partial,
  };
}

type BuildOptions = Parameters<typeof buildPageReconstruction>[1];

interface CorpusCase {
  name: string;
  specs: SectionSpec[];
  opts: BuildOptions;
}

function patternPhp(result: ReturnType<typeof buildPageReconstruction>): string {
  return result.files.find((file) => file.path.startsWith('patterns/page-'))?.content ?? '';
}

function snapshotSurface(result: ReturnType<typeof buildPageReconstruction>) {
  return {
    body: result.postContent,
    php: patternPhp(result),
    heroIsCover: /^\s*<!-- wp:cover\b/.test(result.postContent),
    provenanceFlags: result.provenanceFlags,
    fallbackDiagnostics: result.fallbackDiagnostics,
  };
}

const mediaUrlMap = new Map([['https://cdn.test/team.jpg', `${WP}team.jpg`]]);

const corpus: CorpusCase[] = [
  {
    name: 'native text',
    specs: [
      section({
        headings: ['About the Studio'],
        bodyText: ['We design quiet products for noisy rooms.'],
        buttonLabels: ['Shop now'],
      }),
    ],
    opts: { themeSlug: 'demo-replica', title: 'Native Text', slug: 'native-text' },
  },
  {
    name: 'cover hero',
    specs: [
      section({
        interactionModel: 'animated-cover',
        headings: ['Sleep, simplified'],
        bodyText: ['A calmer night starts here.'],
        images: [img(`${WP}hero.jpg`, { width: 1440, height: 820 })],
        fullBleed: true,
      }),
    ],
    opts: { themeSlug: 'demo-replica', title: 'Cover Hero', slug: 'cover-hero', isHome: true },
  },
  {
    name: 'converted section',
    specs: [
      section({
        headings: ['Converted Heading'],
        bodyText: ['Converted body copy.'],
        sectionHtml: '<section><h2>Converted Heading</h2><p>Converted body copy.</p></section>',
      }),
    ],
    opts: {
      themeSlug: 'demo-replica',
      title: 'Converted Section',
      slug: 'converted-section',
      convertedSections: new Map([
        [
          0,
          {
            markup:
              '<!-- wp:heading --><h2>Converted Heading</h2><!-- /wp:heading -->\n' +
              '<!-- wp:paragraph --><p>Converted body copy.</p><!-- /wp:paragraph -->',
            wpHtmlResidue: 0,
          },
        ],
      ]),
    },
  },
  {
    name: 'lossy fallback island',
    specs: [
      section({
        headings: ['Our Story'],
        images: [img(`${WP}team.jpg`, { sourceUrl: 'https://cdn.test/team.jpg', width: 60, height: 60 })],
        sectionHtml: '<section><h2>Our Story</h2><img src="https://cdn.test/team.jpg" alt=""/></section>',
      }),
    ],
    opts: {
      themeSlug: 'demo-replica',
      title: 'Lossy Fallback',
      slug: 'lossy-fallback',
      mediaUrlMap,
    },
  },
  {
    name: 'adapter recipe on fallback',
    specs: [
      section({
        headings: ['Recipe Story'],
        images: [img(`${WP}team.jpg`, { sourceUrl: 'https://cdn.test/team.jpg', width: 60, height: 60 })],
        sectionHtml: '<img src="https://cdn.test/team.jpg" alt="recipe"/>',
      }),
    ],
    opts: {
      themeSlug: 'demo-replica',
      title: 'Adapter Recipe',
      slug: 'adapter-recipe',
      sourceUrl: 'https://example.test/recipe',
      mediaUrlMap,
      adapterBlocks: { recipes: [{ match: 'img', block: 'core/image', inner: 'drop' }] },
    },
  },
  {
    name: 'form section',
    specs: [
      section({
        headings: ['Get in Touch'],
        bodyText: ['Drop us a line and our fictional team will reply.'],
        forms: [
          {
            fields: [
              { kind: 'name' as const, label: 'Full name', required: true, widthPct: 50 as const },
              { kind: 'email' as const, label: 'Email address', required: true, widthPct: 50 as const },
              { kind: 'select' as const, label: 'Topic', required: false, options: ['Billing', 'Support'] },
              { kind: 'textarea' as const, label: 'Message', required: false },
              { kind: 'hidden' as const, label: 'Campaign id', required: false },
            ],
            submitLabel: 'Send Message',
          },
        ],
      }),
    ],
    opts: { themeSlug: 'demo-replica', title: 'Form Section', slug: 'form-section' },
  },
];

describe('external reconstruct harness re-adoption', () => {
  for (const testCase of corpus) {
    it(`preserves the frozen output surface for ${testCase.name}`, () => {
      const result = buildPageReconstruction(testCase.specs, testCase.opts);
      expect(snapshotSurface(result)).toMatchSnapshot();
    });
  }

  it('derives the hero-cover signal from adapter-replaced fallback markup', () => {
    const result = buildPageReconstruction(
      [
        section({
          headings: ['Recipe Hero'],
          images: [img(`${WP}team.jpg`, { sourceUrl: 'https://cdn.test/team.jpg', width: 60, height: 60 })],
          sectionHtml: '<div data-hero-recipe><h1>Recipe Hero</h1></div>',
        }),
      ],
      {
        themeSlug: 'demo-replica',
        title: 'Adapter Cover',
        slug: 'adapter-cover',
        isHome: true,
        adapterBlocks: {
          htmlToBlocks: () =>
            '<!-- wp:cover {"url":"/wp-content/uploads/2026/06/hero.jpg"} -->\n' +
            '<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>\n' +
            '<!-- /wp:cover -->',
        },
      },
    );

    expect(result.postContent.trimStart()).toMatch(/^<!-- wp:cover\b/);
    expect(result.variant.overlayHeader).toBe(true);
  });
});
