import { describe, it, expect } from 'vitest';
import { buildPageReconstruction } from './reconstruct-pages.js';
import { buildInternalLinkMap } from '../streaming/internal-link-rewrite.js';
import type { SectionSpec } from './section-extract.js';

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

describe('buildPageReconstruction', () => {
  const base = { themeSlug: 'demo-replica', title: 'About Us' };

  it('emits a pattern, a gate report, variant + template for a content page (no per-slug template file)', () => {
    const r = buildPageReconstruction([section({ headings: ['About Us'], bodyText: ['We sell lumber.'] })], {
      ...base,
      slug: 'about-us',
    });
    expect(r.patternSlug).toBe('demo-replica/page-about-us');
    expect(r.gate.ok).toBe(true);
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain('patterns/page-about-us.php');
    // Per-slug template is no longer emitted — the collapse planner writes the
    // deduped variant template instead.
    expect(paths).not.toContain('templates/page-about-us.html');
    expect(r.variant).toBeDefined();
    expect(r.template).toBeDefined();
    // The template renders the page's post_content (real editable block page),
    // between header/footer parts — NOT a wp:pattern ref.
    const tpl = r.template;
    expect(tpl).toContain('wp:post-content');
    expect(tpl).not.toContain('wp:pattern');
    expect(tpl).toContain('template-part {"slug":"header"');
    expect(tpl).toContain('template-part {"slug":"footer"');
    // Pattern (theme library) carries the verbatim copy.
    const php = r.files.find((f) => f.path === 'patterns/page-about-us.php')!.content;
    expect(php).toContain('We sell lumber.');
    // post_content is the block markup WITHOUT the PHP doc-comment header, for the WP post.
    expect(r.postContent).toContain('We sell lumber.');
    expect(r.postContent).not.toContain('<?php'); // no PHP in post_content
    expect(r.postContent).not.toContain('Slug: demo-replica'); // no pattern header
    expect(r.fallbackDiagnostics).toHaveLength(0);
  });

  it('renders full-width when the source has a full-bleed section, constrained otherwise (defers to source)', () => {
    // A page with a full-bleed section → full-width (default layout) so the hero
    // and bands stretch edge-to-edge.
    const fw = buildPageReconstruction(
      [section({ headings: ['Hero'], fullBleed: true } as Partial<SectionSpec>)],
      { ...base, slug: 'full' },
    );
    expect(fw.template).toContain('wp:post-content {"layout":{"type":"default"}}');
    expect(fw.template).not.toContain('wp:post-content {"layout":{"type":"constrained"}}');
    expect(fw.variant.fullWidth).toBe(true);
    // A page with only boxed content → constrained.
    const cw = buildPageReconstruction([section({ headings: ['Body'], bodyText: ['x'] })], { ...base, slug: 'boxed' });
    expect(cw.template).toContain('wp:post-content {"layout":{"type":"constrained"}}');
    expect(cw.variant.fullWidth).toBe(false);
  });

  it('does NOT force full-width when only a chrome (footer/nav) section is full-bleed', () => {
    // A full-bleed footer/nav band is page chrome, not page content — it must not
    // flip the whole page to full-width.
    const r = buildPageReconstruction(
      [
        section({ headings: ['Body'], bodyText: ['x'] }),
        section({ interactionModel: 'footer', fullBleed: true } as Partial<SectionSpec>),
      ],
      { ...base, slug: 'chrome' },
    );
    expect(r.template).toContain('wp:post-content {"layout":{"type":"constrained"}}');
    expect(r.variant.fullWidth).toBe(false);
  });

  it('an overlay-cover homepage is BOTH full-width and flush-top (the two decisions are independent)', () => {
    const wideHero = { url: 'http://x/wp-content/uploads/hero.jpg', sourceUrl: 'http://x/wp-content/uploads/hero.jpg', alt: '', kind: 'img' as const, width: 1440, height: 796 };
    const r = buildPageReconstruction(
      [section({ interactionModel: 'animated-cover', headings: ['Hero'], images: [wideHero], fullBleed: true } as Partial<SectionSpec>)],
      { ...base, slug: 'home', isHome: true },
    );
    const tpl = r.files.find((f) => f.path === 'templates/front-page.html')!.content;
    expect(tpl).toContain('"className":"site-header-overlay"'); // overlay header
    expect(tpl).toContain('wp:post-content {"layout":{"type":"default"}}'); // full-width
    expect(tpl).toContain('margin-top:0px;padding-top:0px'); // flush-top preserved
  });

  it('a cover hero pushed down by a source header (top >= 40) gets the SOLID header, not overlay', () => {
    const wideHero = { url: 'http://x/wp-content/uploads/hero.jpg', sourceUrl: 'http://x/wp-content/uploads/hero.jpg', alt: '', kind: 'img' as const, width: 1440, height: 796 };
    const r = buildPageReconstruction(
      [section({ interactionModel: 'animated-cover', headings: ['Hero'], images: [wideHero], fullBleed: true, top: 93 } as Partial<SectionSpec>)],
      { ...base, slug: 'home', isHome: true },
    );
    const tpl = r.files.find((f) => f.path === 'templates/front-page.html')!.content;
    // The 93px above the hero is a SOLID source header → no transparent overlay.
    expect(tpl).not.toContain('site-header-overlay');
  });

  it('emits front-page.html for the home page but NOT a per-slug page template', () => {
    const r = buildPageReconstruction([section({ headings: ['Home'] })], { ...base, slug: 'home', isHome: true });
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain('templates/front-page.html');
    // Per-slug template is no longer emitted — the collapse planner dedupes it.
    expect(paths).not.toContain('templates/page-home.html');
    expect(r.variant).toBeDefined();
    expect(r.template).toBeDefined();
  });

  it('wires the overlay header in the template ONLY when the hero is a full-bleed cover', () => {
    const wideHero = { url: 'http://x/wp-content/uploads/hero.jpg', sourceUrl: 'http://x/wp-content/uploads/hero.jpg', alt: '', kind: 'img' as const, width: 1440, height: 796 };
    const coverHome = buildPageReconstruction(
      [section({ interactionModel: 'animated-cover', headings: ['Hero'], bodyText: ['Sub'], images: [wideHero] })],
      { ...base, slug: 'home', isHome: true },
    );
    const coverTpl = coverHome.files.find((f) => f.path === 'templates/front-page.html')!.content;
    expect(coverTpl).toContain('"className":"site-header-overlay"'); // overlay header on the cover-hero homepage

    const plainPage = buildPageReconstruction([section({ headings: ['About'], bodyText: ['copy'] })], { ...base, slug: 'about' });
    expect(plainPage.template).toContain('"slug":"header","tagName":"header"} /-->'); // solid header
    expect(plainPage.template).not.toContain('site-header-overlay');
  });

  it('includes icon SVG assets the pattern references', () => {
    const s = section({ interactionModel: 'columns', headings: ['Features'] });
    s.cells = [
      { heading: 'A', body: ['a'], image: null, icon: { kind: 'svg', markup: '<svg viewBox="0 0 24 24"><path d="M3 9h4"/></svg>', width: 48, height: 48 }, button: null },
      { heading: 'B', body: ['b'], image: null, icon: { kind: 'svg', markup: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>', width: 48, height: 48 }, button: null },
    ];
    const r = buildPageReconstruction([s], { ...base, slug: 'features' });
    expect(r.iconAssetCount).toBe(2);
    const iconFiles = r.files.filter((f) => f.path.startsWith('assets/icon-'));
    expect(iconFiles).toHaveLength(2);
    expect(iconFiles[0].content).toContain('<svg');
  });

  it('throws on an unsafe slug rather than emitting a bad path', () => {
    expect(() => buildPageReconstruction([section({})], { ...base, slug: '../evil' })).toThrow(/unsafe/);
    expect(() => buildPageReconstruction([section({})], { themeSlug: 'a/b', title: 'x', slug: 'ok' })).toThrow(/unsafe/);
  });

  it('rewrites page-body CTA links to local permalinks when a linkMap is supplied', () => {
    const linkMap = buildInternalLinkMap([{ from: '/about-us', to: '/about-us/' }], {
      siteOrigins: ['demo.test'],
    });
    const cta = section({
      headings: ['Learn more'],
      buttons: [{ label: 'About', href: '/about-us' }],
    } as Partial<SectionSpec>);
    const r = buildPageReconstruction([cta], { ...base, slug: 'cta', linkMap });
    // Both the editable post_content and the theme-library pattern get rewritten.
    expect(r.postContent).toContain('href="/about-us/"');
    expect(r.postContent).not.toContain('href="/about-us"');
    const php = r.files.find((f) => f.path === 'patterns/page-cta.php')!.content;
    expect(php).toContain('href="/about-us/"');
    expect(r.gate.ok).toBe(true);
  });

  it('emits a verbatim core/html island for a lossy section, rewriting island media + counting fallbackSections', () => {
    const mediaUrlMap = new Map([['https://cdn.test/team.jpg', '/wp-content/uploads/team.jpg']]);
    const lossy = section({
      headings: ['Our Story'],
      // 60px glyph is below the 90px media-recovery floor → cannot be recovered,
      // so the structured render's drop demotes the section to the island.
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="https://cdn.test/team.jpg" alt=""/></section>',
    } as Partial<SectionSpec>);
    const r = buildPageReconstruction([lossy], { ...base, slug: 'story', mediaUrlMap });
    expect(r.postContent).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    expect(r.postContent).toContain('/wp-content/uploads/team.jpg'); // island media rewritten to local
    expect(r.postContent).not.toContain('cdn.test'); // source CDN URL gone
    expect(r.fallbackSections).toBe(1);
    expect(r.gate.ok).toBe(true);
    expect(r.fallbackDiagnostics).toHaveLength(1);
    // id keys the fallback-diagnostics artifact — must use the bare slug, not the
    // slash-bearing patternSlug.
    expect(r.fallbackDiagnostics[0].id).not.toContain('/');
    expect(r.fallbackDiagnostics[0].reasonCode).toBe('dropped_images');
  });

  it('leaves body links untouched when no linkMap is supplied (back-compat)', () => {
    const cta = section({
      headings: ['Learn more'],
      buttons: [{ label: 'About', href: '/about-us' }],
    } as Partial<SectionSpec>);
    const r = buildPageReconstruction([cta], { ...base, slug: 'cta2' });
    expect(r.postContent).toContain('href="/about-us"');
  });
});

describe('buildPageReconstruction — converted-heading provenance', () => {
  it('passes the gate when a converted section emits a heading not in s.headings', () => {
    // rawHandler faithfully emits sub-headings the structured extraction never
    // captured as s.headings (verified: 6 of 16 on a real page). The converted
    // branch registers the converted markup's OWN <h>/<p> visible text into the
    // gate corpus so those sub-headings don't trip the provenance check.
    const markup =
      '<!-- wp:heading --><h2>Known Heading</h2><!-- /wp:heading -->\n' +
      '<!-- wp:paragraph --><p>Some captured body copy.</p><!-- /wp:paragraph -->\n' +
      '<!-- wp:heading {"level":3} --><h3>Surprise Subheading</h3><!-- /wp:heading -->';
    const result = buildPageReconstruction(
      [
        section({
          headings: ['Known Heading'],       // captured corpus: ONE heading only
          headingSizes: [28],
          bodyText: ['Some captured body copy.'],
          sectionHtml:
            '<h2>Known Heading</h2><p>Some captured body copy.</p><h3>Surprise Subheading</h3>',
        }),
      ],
      {
        slug: 'about',
        title: 'About',
        themeSlug: 'demo-replica',
        convertedSections: new Map([[0, { markup, wpHtmlResidue: 0 }]]),
      },
    );
    // 'Surprise Subheading' was NOT in s.headings, but the converted branch
    // registered it from the markup's <h3> — so the gate must not reject it.
    expect(result.gate.ok).toBe(true);
    expect(result.postContent).toContain('Surprise Subheading');
    // The converted path emits native blocks — no core/html fallback island.
    expect(result.postContent).not.toContain('<!-- wp:html');
  });
});
