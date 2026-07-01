import { describe, it, expect } from 'vitest';
import { buildProductMarketing, selectMarketingSections, dropDeadImages, type SectionSpecFile } from './product-marketing-island.js';
import type { SectionSpec, InteractionModel } from './section-extract.js';

// Minimal fictional SectionSpec factory — only the fields these functions read matter;
// the rest get harmless defaults. No source-site data ([[feedback_no_source_data_in_tests]]).
function sec(over: Partial<SectionSpec> & { sectionIndex: number }): SectionSpec {
  return {
    interactionModel: 'static' as InteractionModel,
    top: over.sectionIndex * 1000,
    height: 400,
    headings: [],
    bodyText: [],
    buttonLabels: [],
    images: [],
    icons: [],
    backgroundBrightness: 255,
    backgroundColor: 'rgb(255,255,255)',
    gradient: null,
    gradientSource: null,
    motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
    dividerAbove: null,
    dividerBelow: null,
    layout: { containerWidth: 1200, padding: '0px', childLayout: 'flex-column', columnCount: 1, gap: '0px' } as SectionSpec['layout'],
    ...over,
  } as SectionSpec;
}

const file = (sections: SectionSpec[]): SectionSpecFile => ({ schema: 6, sourceUrl: 'https://shop.example/products/widget', sections });

describe('selectMarketingSections (drop logic)', () => {
  it('drops the topmost (hero/gallery) section and keeps marketing sections', () => {
    const { kept, dropped } = selectMarketingSections(
      file([
        sec({ sectionIndex: 0, images: [{ url: 'g.jpg' } as SectionSpec['images'][number]] }),
        sec({ sectionIndex: 1, headings: ['Why our widget'] }),
        sec({ sectionIndex: 2, headings: ['How it works'] }),
      ]),
    );
    expect(kept.map((s) => s.sectionIndex)).toEqual([1, 2]);
    expect(dropped.find((d) => d.sectionIndex === 0)?.reason).toBe('buybox');
  });

  it('drops footer and nav chrome sections', () => {
    const { kept, dropped } = selectMarketingSections(
      file([
        sec({ sectionIndex: 0, interactionModel: 'nav' }),
        sec({ sectionIndex: 1, headings: ['Gallery hero'] }),
        sec({ sectionIndex: 2, headings: ['Features'] }),
        sec({ sectionIndex: 3, interactionModel: 'footer', headings: ['Shop', 'Support'] }),
      ]),
    );
    expect(kept.map((s) => s.sectionIndex)).toEqual([2]);
    expect(dropped.map((d) => d.reason).sort()).toEqual(['buybox', 'footer', 'nav']);
  });

  it('KEEPS the "you may also like" band (Woo related-products block does not render)', () => {
    const { kept } = selectMarketingSections(
      file([
        sec({ sectionIndex: 0, headings: ['Gallery hero'] }),
        sec({ sectionIndex: 1, headings: ['Real comfort'] }),
        sec({ sectionIndex: 2, headings: ['You may also like'] }),
      ]),
    );
    expect(kept.map((s) => s.sectionIndex)).toEqual([1, 2]);
  });

  it('does NOT mistake a related grid (with quick-add buttons) for the hero', () => {
    // Regression: the related grid's cards contain "add to cart", but the captured hero
    // (gallery) does not — so the hero must be the TOPMOST section, never the related band.
    const { kept, dropped } = selectMarketingSections(
      file([
        sec({ sectionIndex: 0, headings: [] }), // gallery hero, no cart text
        sec({ sectionIndex: 1, headings: ['Comfort'] }),
        sec({ sectionIndex: 2, headings: ['You may also like'], sectionHtml: '<div class="product-form"><button>Add to cart</button></div>' }),
      ]),
    );
    expect(kept.map((s) => s.sectionIndex)).toEqual([1, 2]);
    expect(dropped.find((d) => d.sectionIndex === 0)?.reason).toBe('buybox');
  });
});

describe('buildProductMarketing (reconstruction)', () => {
  it('emits CORE blocks (not just core/html) for clean marketing sections', () => {
    const r = buildProductMarketing(
      file([
        sec({ sectionIndex: 0, headings: [] }), // hero dropped
        sec({ sectionIndex: 1, interactionModel: 'media-text', headings: ['Why our widget'], bodyText: ['It is quiet and effective.'], images: [{ url: 'https://cdn.example/a.jpg', alt: 'photo' } as SectionSpec['images'][number]] }),
      ]),
    );
    expect(r.keptIndices).toEqual([1]);
    expect(r.postContent).toContain('Why our widget');
    // A real core block was emitted (heading/media-text/group), not only a core/html island.
    expect(/<!-- wp:(heading|media-text|group|paragraph|columns|image)/.test(r.postContent)).toBe(true);
  });

  it('rewrites CDN media URLs through the provided map', () => {
    const r = buildProductMarketing(
      file([
        sec({ sectionIndex: 0, headings: [] }),
        sec({ sectionIndex: 1, interactionModel: 'media-text', headings: ['Photo'], bodyText: ['Body copy here.'], images: [{ url: 'https://cdn.example/a.jpg', alt: 'p' } as SectionSpec['images'][number]] }),
      ]),
      { mediaUrlMap: new Map([['https://cdn.example/a.jpg', '/wp-content/uploads/2026/06/a.jpg']]) },
    );
    expect(r.postContent).toContain('/wp-content/uploads/2026/06/a.jpg');
    expect(r.postContent).not.toContain('cdn.example');
  });

  it('dropDeadImages drops non-local (unjoined/dead CDN) imgs but keeps local library imgs', () => {
    const html =
      '<figure><img src="https://cdn.example/dead-recommendation.png?v=1" alt="x"></figure>' +
      '<figure><img src="http://localhost:8883/wp-content/uploads/2026/06/real.jpg" alt="y"></figure>' +
      '<figure><img src="//getsnooz.cdn/also-dead.png"></figure>';
    const out = dropDeadImages(html);
    expect(out).toContain('/wp-content/uploads/2026/06/real.jpg'); // local kept
    expect(out).not.toContain('dead-recommendation'); // unjoined CDN dropped (no broken icon)
    expect(out).not.toContain('also-dead'); // protocol-relative CDN dropped
    expect((out.match(/<img/g) || []).length).toBe(1);
  });

  it('dropDeadImages does not corrupt markup when an attribute value contains ">"', () => {
    // Shopify alt text routinely contains ">"; a naive [^>]* match truncates here.
    const html = '<img src="http://localhost/wp-content/uploads/a.jpg" alt="before > after"><p>keep me</p>';
    const out = dropDeadImages(html);
    expect(out).toContain('/wp-content/uploads/a.jpg'); // local img survives intact
    expect(out).toContain('alt="before > after"'); // attribute not truncated
    expect(out).toContain('<p>keep me</p>'); // following markup not corrupted
  });

  it('returns empty post_content when only chrome + hero remain', () => {
    const r = buildProductMarketing(
      file([
        sec({ sectionIndex: 0, headings: ['Gallery hero'] }),
        sec({ sectionIndex: 1, interactionModel: 'footer', headings: ['Shop'] }),
      ]),
    );
    expect(r.postContent).toBe('');
    expect(r.keptIndices).toEqual([]);
  });
});
