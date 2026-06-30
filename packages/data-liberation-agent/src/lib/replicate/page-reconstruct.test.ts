import { describe, it, expect } from 'vitest';
import {
  reconstructPagePattern,
  escapeHtml,
} from './page-reconstruct.js';
import {
  normalizeCopy,
  sanitizePatternHeaderField,
  stripChrome,
  sanitizeSvgAsset,
} from '@automattic/blocks-engine/theme';
import { scanForInjection } from './validate-artifacts.js';
import type { SectionSpec } from './section-extract.js';

const WP = 'http://localhost:8883/wp-content/uploads/2026/05/';

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

function img(url: string, alt = '') {
  return { url, sourceUrl: url, alt, kind: 'img' as const, width: 800, height: 800 };
}

describe('escapeHtml', () => {
  it('escapes injection-relevant characters', () => {
    expect(escapeHtml('a & b <c> "d" \'e\'')).toBe('a &amp; b &lt;c&gt; &quot;d&quot; &#039;e&#039;');
  });
});

describe('normalizeCopy', () => {
  it('collapses whitespace and strips zero-width/soft-hyphen noise', () => {
    expect(normalizeCopy('  foo­​   bar\n baz ')).toBe('foo bar baz');
  });
});

describe('stripChrome', () => {
  it('drops trailing footer (Shop/Support/Company) and newsletter sections', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, headings: ['Hello'] }),
      section({ sectionIndex: 1, interactionModel: 'columns', headings: ['Shop', 'Support', 'Company'] }),
      section({ sectionIndex: 2, bodyText: ['Get some good SNOOZ.'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].headings).toEqual(['Hello']);
  });

  it('drops explicit footer/nav models from the ends only', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, interactionModel: 'nav' }),
      section({ sectionIndex: 1, headings: ['Body'] }),
      section({ sectionIndex: 2, interactionModel: 'footer', headings: ['Shop', 'Support', 'Company'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].headings).toEqual(['Body']);
  });

  it('drops a trailing footer detected by a generic copyright/attribution line', () => {
    // a page-builder footer: nav labels + contact + "© 2026 Website by …". Not the
    // getsnooz Shop/Support/Company shape, so it needs the generic copyright signal
    // — otherwise the page shows two footers (this section + the theme footer part).
    const out = stripChrome([
      section({ sectionIndex: 0, interactionModel: 'animated-cover', headings: ['Hero'] }),
      section({ sectionIndex: 1, headings: ['Body'] }),
      section({
        sectionIndex: 2,
        interactionModel: 'columns',
        bodyText: ['PRODUCTS', 'GALLERY', 'CALL US', '© 2026 Website by Acme Studio'],
      }),
    ]);
    expect(out.map((s) => s.sectionIndex)).toEqual([0, 1]);
  });

  it('strips a leading header-chrome tile (short nav+contact band) captured as static', () => {
    // Flat-Wix pages get captured as <section> tiles; the header tile arrives as
    // a short `static` band of nav links + contact, not model `nav`. It must be
    // stripped (the theme supplies its own header) or it renders above content.
    const out = stripChrome([
      section({
        sectionIndex: 0,
        interactionModel: 'static',
        height: 116,
        headings: ['Acme Co 555-0142'],
        bodyText: ['PRODUCTS', 'GALLERY', 'JOB OPPORTUNITIES', 'ABOUT US'],
      }),
      section({ sectionIndex: 1, height: 800, headings: ['Premium Hardwood'] }),
    ]);
    expect(out.map((s) => s.sectionIndex)).toEqual([1]);
  });

  it('does NOT strip a tall leading content band that happens to have short lines', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, height: 520, headings: ['Hero'], bodyText: ['A', 'B', 'C'] }),
      section({ sectionIndex: 1, height: 400, headings: ['Body'] }),
    ]);
    expect(out.map((s) => s.sectionIndex)).toEqual([0, 1]);
  });

  it('preserves a mid-page dark content band that is not the footer', () => {
    const out = stripChrome([
      section({ sectionIndex: 0, headings: ['Top'] }),
      section({
        sectionIndex: 1,
        backgroundColor: 'rgb(47, 56, 78)',
        headings: ['100 Night Happiness Guarantee'],
      }),
      section({ sectionIndex: 2, interactionModel: 'footer', headings: ['Shop', 'Support', 'Company'] }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].headings).toEqual(['100 Night Happiness Guarantee']);
  });
});

describe('reconstructPagePattern', () => {
  const opts = { patternSlug: 'demo-replica/page-x', title: 'Page — X' };

  it('reproduces the source heading SIZES (responsive clamp) so eyebrow/headline are not inverted', () => {
    const s = section({ headings: ['WHY DO BUSINESS WITH US', 'The Premium Advantage'] }) as SectionSpec;
    s.headingSizes = [16, 55]; // tiny eyebrow label, large headline
    const r = reconstructPagePattern([s], opts);
    // Each heading carries a clamp() whose max equals the captured px.
    expect(r.php).toMatch(/font-size:clamp\([^)]*16px\)/); // eyebrow stays 16px
    expect(r.php).toMatch(/font-size:clamp\([^)]*55px\)/); // headline 55px
    // Headings without a captured size emit no explicit font-size (theme scale).
    const noSize = reconstructPagePattern([section({ headings: ['Plain'] })], opts);
    expect(noSize.php).not.toContain('font-size:clamp');
  });

  it('reproduces measured section vertical padding (whitespace) as responsive CSS', () => {
    // section-extract measures padding geometrically (content-box vs section-box)
    // because page-builder sections report padding:0. The renderer must trust the
    // measured px over the theme preset so source whitespace is faithful.
    const s = section({ headings: ['Spacious'] }) as SectionSpec;
    s.layout = { ...s.layout, padTopPx: 120, padBottomPx: 140 };
    const r = reconstructPagePattern([s], opts);
    // Responsive clamp whose max equals the captured px, on both top and bottom.
    expect(r.php).toMatch(/padding-top:clamp\(\d+px, [\d.]+vw, 120px\)/);
    expect(r.php).toMatch(/padding-bottom:clamp\(\d+px, [\d.]+vw, 140px\)/);
    // The preset spacing is NOT used for the measured vertical edges.
    expect(r.php).not.toMatch(/padding-top:var\(--wp--preset--spacing--60\)/);
  });

  it('emits a near-zero measured padding literally (no invalid clamp) and falls back to preset when unmeasured', () => {
    // Small measured values can't form a valid clamp (min would exceed max), so
    // they emit as a literal px. A full-bleed source band (≈0 padding) stays flush.
    const tight = section({ headings: ['Flush'] }) as SectionSpec;
    tight.layout = { ...tight.layout, padTopPx: 8, padBottomPx: 0 };
    const t = reconstructPagePattern([tight], opts);
    expect(t.php).toContain('padding-top:8px');
    expect(t.php).toContain('padding-bottom:0px');
    // No measurement → theme spacing preset (back-compat).
    const plain = reconstructPagePattern([section({ headings: ['Default'] })], opts);
    expect(plain.php).toMatch(/padding-top:var\(--wp--preset--spacing--60\)/);
  });

  it('honors the source text alignment instead of hard-centering (left source → left output)', () => {
    // the source left-aligns every heading; the renderer must not center them.
    const left = section({ headings: ['The Premium Advantage'], bodyText: ['Body copy.'], buttonLabels: ['SEE ALL'] }) as SectionSpec;
    left.textAlign = 'left';
    const lr = reconstructPagePattern([left], opts);
    expect(lr.php).not.toContain('has-text-align-center');
    expect(lr.php).toContain('is-content-justification-left'); // button row follows
    // A genuinely centered source band still centers.
    const ctr = section({ headings: ['Centered'], buttonLabels: ['GO'] }) as SectionSpec;
    ctr.textAlign = 'center';
    const cr = reconstructPagePattern([ctr], opts);
    expect(cr.php).toContain('has-text-align-center');
    expect(cr.php).toContain('is-content-justification-center');
  });

  it('preserves a body line that repeats a heading (the source genuinely shows both)', () => {
    const s = section({ headings: ['Premium Hardwood'], bodyText: ['Premium Hardwood', 'Real prose here.'] });
    const r = reconstructPagePattern([s], opts);
    // Heading tags and <p> are disjoint, visible-only captures — an exact match
    // means the source renders BOTH (e.g. a large subheading AND an identical
    // paragraph), so we keep both rather than lose content: the text appears
    // twice, once as a heading block and once as a paragraph block.
    expect((r.php.match(/Premium Hardwood/g) || []).length).toBe(2);
    expect(r.php).toContain('wp:heading');
    expect(r.php).toContain('wp:paragraph');
    expect(r.php).toContain('Real prose here.');
  });

  it('renders a 3+ same-scale non-lead image row as a gallery below the lead', () => {
    const s = section({
      headings: ['Products'],
      images: [
        img(`${WP}kiln.png`, 'kiln'), // lead (big)
        img(`${WP}s1.png`), img(`${WP}s2.png`), img(`${WP}s3.png`), // sample strip
      ],
    });
    // shrink the samples below the lead threshold but above the gallery floor
    (s.images[1] as { width: number; height: number }).width = 146;
    (s.images[1] as { width: number; height: number }).height = 146;
    (s.images[2] as { width: number; height: number }).width = 146;
    (s.images[2] as { width: number; height: number }).height = 146;
    (s.images[3] as { width: number; height: number }).width = 146;
    (s.images[3] as { width: number; height: number }).height = 146;
    const r = reconstructPagePattern([s], opts);
    expect(r.php).toContain('wp:gallery');
    expect(r.php).toContain('s1.png');
    expect(r.php).toContain('s3.png');
  });

  it('does not sprout a gallery for a text band with fewer than 3 extra images', () => {
    const s = section({ headings: ['Story'], images: [img(`${WP}lead.png`), img(`${WP}one.png`)] });
    const r = reconstructPagePattern([s], opts);
    expect(r.php).not.toContain('wp:gallery');
  });

  it('renders 1–2 extra content images individually instead of dropping them', () => {
    // A merged media-text section with a 2nd photo: both images must appear (no
    // gallery, but no dropped content either). Mirrors the about-us case where the
    // extractor merged two stacked image-right rows into one 2-image section.
    const s = section({ interactionModel: 'static', headings: ['Journey'], bodyText: ['Body.'], images: [img(`${WP}first.png`), img(`${WP}second.png`)] });
    s.mediaLayout = 'image-right';
    const r = reconstructPagePattern([s], opts);
    expect(r.php).not.toContain('wp:gallery'); // 1 extra → not a gallery
    expect(r.php).toContain('first.png'); // lead (media column)
    expect(r.php).toContain('second.png'); // extra — rendered, NOT dropped
  });

  it('renders a captured side-by-side mediaLayout as a 2-column media-text with the correct side', () => {
    // image-left: the image column precedes the text column.
    const left = section({ interactionModel: 'static', headings: ['Headline'], bodyText: ['Body.'], images: [img(`${WP}photo.png`, 'p')] });
    left.mediaLayout = 'image-left';
    const lr = reconstructPagePattern([left], opts);
    expect(lr.php).toContain('wp:columns');
    expect(lr.php.indexOf('photo.png')).toBeLessThan(lr.php.indexOf('>Headline<'));
    // image-right: the text column precedes the image column.
    const right = section({ interactionModel: 'static', headings: ['Headline'], bodyText: ['Body.'], images: [img(`${WP}photo.png`, 'p')] });
    right.mediaLayout = 'image-right';
    const rr = reconstructPagePattern([right], opts);
    expect(rr.php.indexOf('>Headline<')).toBeLessThan(rr.php.indexOf('photo.png'));
  });

  it('does not route a gallery model to media-text even if mediaLayout is set', () => {
    const s = section({ interactionModel: 'gallery', headings: ['Gallery'], images: [img(`${WP}a.png`), img(`${WP}b.png`)] });
    s.mediaLayout = 'image-left';
    const r = reconstructPagePattern([s], opts);
    expect(r.php).toContain('wp:gallery'); // stays a gallery, not 2-col media-text
  });

  it('renders sub-200px cell images (team headshots) that the lead threshold would drop', () => {
    const cell = (heading: string, url: string) => ({
      heading,
      body: ['contact'],
      image: { url, sourceUrl: url, alt: '', kind: 'img' as const, width: 182, height: 193 },
      icon: null,
      button: null,
    });
    const s = section({ interactionModel: 'static', headings: ['Meet the Experts'] }) as SectionSpec & {
      cells: unknown[];
    };
    s.cells = [cell('Jane Doe', `${WP}al.png`), cell('John Smith', `${WP}shap.png`)];
    const r = reconstructPagePattern([s as SectionSpec], opts);
    expect(r.php).toContain('al.png');
    expect(r.php).toContain('shap.png');
  });

  it('un-flattens a static band with columnCount>=2 and heading-only cells into a real grid', () => {
    const headingOnly = (heading: string) => ({ heading, body: [], image: null, icon: null, button: null });
    const s = section({ interactionModel: 'static', headings: ['Our Process'] }) as SectionSpec & {
      cells: unknown[];
    };
    s.layout = { ...s.layout, columnCount: 3 };
    s.cells = [headingOnly('Discover'), headingOnly('Design'), headingOnly('Deliver')];
    const r = reconstructPagePattern([s as SectionSpec], opts);
    // Was flattened to a centered text band that dropped the card titles; now a real grid.
    expect(r.php).toContain('wp:columns');
    expect(r.php).toContain('Discover');
    expect(r.php).toContain('Design');
    expect(r.php).toContain('Deliver');
  });

  it('does NOT un-flatten heading-only cells when columnCount < 2 (the gate)', () => {
    const headingOnly = (heading: string) => ({ heading, body: [], image: null, icon: null, button: null });
    const s = section({ interactionModel: 'static', headings: ['Single'] }) as SectionSpec & {
      cells: unknown[];
    };
    s.layout = { ...s.layout, columnCount: 1 };
    s.cells = [headingOnly('A'), headingOnly('B')];
    const r = reconstructPagePattern([s as SectionSpec], opts);
    expect(r.php).not.toContain('wp:columns');
  });

  it('maps per-heading font-families to display vs body and reproduces line-height', () => {
    const s = section({ headings: ['Serif Headline', 'A SANS EYEBROW'] }) as SectionSpec;
    s.headingFamilies = ['libre baskerville', 'wfont_5499e3_8190210ff07446afa535fc100a057226'];
    s.headingLineHeights = [1.4, 1.4];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'X',
      fontFamilies: [
        { slug: 'display', family: 'libre baskerville, serif' },
        { slug: 'body', family: 'Inter, sans-serif' },
        { slug: 'wf-8190210ff07446afa535fc100', family: 'wf_8190210ff07446afa535fc100, sans-serif' },
      ],
    });
    // The serif headline → display; the sans eyebrow (a Wix handle WP won't render
    // reliably) → the body face by elimination. Line-height transferred.
    expect(r.php).toMatch(/has-display-font-family[^>]*>Serif Headline</);
    expect(r.php).toMatch(/has-body-font-family[^>]*>A SANS EYEBROW</);
    expect(r.php).toContain('line-height:1.4');
  });

  it('body paragraphs use the body font even when the computed family is a substring of the display name', () => {
    // Fictional fonts: display = "Caldera Display", body = "Caldera". The body
    // font's name ("caldera") is a prefix-substring of the display font's full
    // name ("caldera display"), so familyMatches wrongly fires for display before
    // it can match body. Body prose must land on has-body-font-family, never display.
    const s = section({ headings: ['Intro'], bodyText: ['Body prose here.'] }) as SectionSpec;
    (s as SectionSpec & { bodyFamilies?: string[] }).bodyFamilies = ['caldera'];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-body-font',
      title: 'Body font test',
      fontFamilies: [
        { slug: 'display', family: 'Caldera Display, sans-serif' },
        { slug: 'body', family: 'Caldera, sans-serif' },
      ],
    });
    // Body prose rendered in the body font (Caldera), NOT the display variant.
    expect(r.php).toMatch(/has-body-font-family[^>]*>Body prose here\./);
  });

  it('carries source image width + aspect (not blown up to the container, not forced 4:3)', () => {
    // A standalone lead photo keeps its source rendered width, capped responsively.
    const big = section({
      headings: ['Photo'],
      images: [{ url: `${WP}kiln.png`, sourceUrl: `${WP}kiln.png`, alt: '', kind: 'img', width: 532, height: 472 }],
    });
    const r = reconstructPagePattern([big], opts);
    expect(r.php).toContain('width:532px');
    expect(r.php).toContain('max-width:100%');
    expect(r.php).toContain('is-resized');
    // A row of SQUARE thumbnails → a gallery whose items carry the source square
    // size via core/image width+height ATTRIBUTES (which survive block-fixer
    // canonicalization), not a stripped inline flex/aspect-ratio. 149×149 stays
    // square (width===height), not the theme's default 4:3 / 220–380px cell.
    const sq = (n: number) => ({ url: `${WP}s${n}.png`, sourceUrl: `${WP}s${n}.png`, alt: '', kind: 'img' as const, width: 149, height: 149 });
    const g = reconstructPagePattern([section({ headings: ['Samples'], images: [sq(1), sq(2), sq(3)] })], opts);
    expect(g.php).toContain('wp:gallery');
    expect(g.php).toContain('"width":"149px"');
    expect(g.php).toContain('"height":"149px"');
    expect(g.php).toContain('size-large is-resized');
    // No stripped-on-canonicalization inline flex/aspect-ratio on gallery figures.
    expect(g.php).not.toContain('flex:0 0');
    expect(g.php).not.toContain('aspect-ratio:149');
  });

  it('gallery is a fixed-height row constrained to the (clamped) landscape image height', () => {
    // A same-scale landscape gallery (the routed case — the first big photo is the
    // lead, the 3+ same-scale extras below it become the gallery). 800×400 items
    // wider than the 560 clamp: row height = 400*560/800 = 280, each item width =
    // 280*800/400 = 560. Uniform box, source 2:1 aspect retained (560/280), never
    // stretched or forced to the theme's 4:3 cell.
    const wide = (n: number) => ({ url: `${WP}w${n}.png`, sourceUrl: `${WP}w${n}.png`, alt: '', kind: 'img' as const, width: 800, height: 400 });
    const g = reconstructPagePattern([section({ headings: ['Gallery'], images: [wide(1), wide(2), wide(3), wide(4)] })], opts);
    expect(g.php).toContain('wp:gallery');
    expect((g.php.match(/"height":"280px"/g) || []).length).toBe(3); // 3 extras share the row height
    expect((g.php.match(/"width":"560px"/g) || []).length).toBe(3); // width clamped at the basis
    expect(g.php).toContain('size-large is-resized');
  });

  it('reproduces a structured CTA: source button color (token), icon, and destination href', () => {
    const s = section({ interactionModel: 'static', headings: ['Hero'] }) as SectionSpec;
    s.buttons = [
      {
        label: 'GET A QUOTE',
        href: '/contact',
        background: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
        icon: { kind: 'svg', markup: '<svg viewBox="0 0 24 24"><path d="M3 9h4"/></svg>', width: 18, height: 18 },
      },
    ];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'X',
      paletteTokens: [
        { slug: 'surface-base', hex: '#ffffff' },
        { slug: 'text-default', hex: '#000000' },
        { slug: 'accent-primary', hex: '#175236' },
      ],
    });
    expect(r.php).toContain('href="/contact"'); // destination link
    expect(r.php).toContain('has-surface-base-background-color'); // white → surface-base
    expect(r.php).not.toContain('has-accent-primary-background-color'); // NOT the default green
    expect(r.php).toContain("get_theme_file_uri('assets/icon-0.svg')"); // icon shipped + referenced
    expect(r.iconAssets.length).toBeGreaterThan(0);
    expect(r.php).toContain('GET A QUOTE</a>'); // label present
  });

  it('places the button icon on the source-captured side (after the label when iconAfter)', () => {
    const icon = { kind: 'svg' as const, markup: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>', width: 18, height: 18 };
    const after = section({ interactionModel: 'static', headings: ['H'] }) as SectionSpec;
    after.buttons = [{ label: 'NEXT', href: '/x', icon, iconAfter: true }];
    const ra = reconstructPagePattern([after], opts);
    // label precedes the icon <img> in the markup
    expect(ra.php.indexOf('NEXT')).toBeLessThan(ra.php.indexOf('icon-0.svg'));
    const before = section({ interactionModel: 'static', headings: ['H'] }) as SectionSpec;
    before.buttons = [{ label: 'BACK', href: '/y', icon, iconAfter: false }];
    const rb = reconstructPagePattern([before], opts);
    // icon precedes the label
    expect(rb.php.indexOf('icon-0.svg')).toBeLessThan(rb.php.indexOf('BACK'));
  });

  it('emits a PHP doc-comment header with the slug and title', () => {
    const r = reconstructPagePattern([section({ headings: ['Hello world'] })], opts);
    expect(r.php).toContain('Title: Page — X');
    expect(r.php).toContain('Slug: demo-replica/page-x');
    expect(r.php).toContain('Inserter: false');
  });

  it('emits verbatim headings as wp:heading and tracks them as expectedText', () => {
    const r = reconstructPagePattern([section({ headings: ['Shop All', 'Simple products'] })], opts);
    expect(r.php).toContain('>Shop All</h1>');
    expect(r.php).toContain('>Simple products</h2>');
    expect(r.expectedText).toContain('Shop All');
    expect(r.expectedText).toContain('Simple products');
  });

  it('emits body prose verbatim and tracks it as bodyText', () => {
    const r = reconstructPagePattern(
      [section({ headings: ['H'], bodyText: ['A good night of sleep matters.'] })],
      opts,
    );
    expect(r.php).toContain('A good night of sleep matters.');
    expect(r.bodyText).toContain('A good night of sleep matters.');
  });

  it('references WP-library image URLs and lists them as expectedAssets', () => {
    const url = `${WP}hero.jpg`;
    const r = reconstructPagePattern(
      [section({ interactionModel: 'media-text', headings: ['H'], bodyText: ['B'], images: [img(url, 'Hero')] })],
      opts,
    );
    expect(r.php).toContain(`src="${url}"`);
    expect(r.php).toContain('alt="Hero"');
    expect(r.expectedAssets).toContain(url);
  });

  it('emits a missing-media placeholder and flag for a non-WP (CDN) image', () => {
    const cdn = 'https://cdn.shopify.com/s/files/x.jpg';
    const r = reconstructPagePattern(
      [section({ interactionModel: 'media-text', headings: ['H'], images: [img(cdn)] })],
      opts,
    );
    expect(r.php).toContain('image unavailable');
    expect(r.php).not.toContain('cdn.shopify.com');
    expect(r.provenanceFlags.join(' ')).toContain('not in WP library');
  });

  it('renders verbatim reviews with stars/quote/author and never synthesizes', () => {
    const r = reconstructPagePattern(
      [
        section({
          interactionModel: 'review-grid',
          headings: ['Loved by Thousands'],
          reviews: [
            { category: null, stars: 5, quote: '"It just works."', author: '- AVA S.' },
          ],
        }),
      ],
      opts,
    );
    expect(r.php).toContain('It just works.');
    expect(r.php).toContain('- AVA S.');
    expect(r.php).toContain('★★★★★');
    expect(r.bodyText).toContain('"It just works."');
  });

  it('renders a dark-background review band on the inverse surface with light text', () => {
    const r = reconstructPagePattern(
      [
        section({
          interactionModel: 'review-grid',
          headings: ['Loved by Thousands'],
          backgroundColor: 'rgb(47, 57, 78)',
          backgroundBrightness: 56,
          reviews: [{ category: null, stars: 5, quote: '"It just works."', author: '- AVA S.' }],
        }),
      ],
      opts,
    );
    expect(r.php).toContain('has-surface-inverse-background-color');
    // Quote text is light (inverse), not dark — readable on navy.
    expect(r.php).toContain('has-text-inverse-color');
    expect(r.php).not.toContain('has-text-default-color');
    // Content still verbatim.
    expect(r.php).toContain('It just works.');
    expect(r.php).toContain('★★★★★');
  });

  it('flags an empty review band with no captured copy as a placeholder, never invents', () => {
    const r = reconstructPagePattern(
      [section({ interactionModel: 'review-grid', headings: ['Reviews'], reviews: [], bodyText: [] })],
      opts,
    );
    expect(r.php).toContain('[reviews not captured]');
    expect(r.provenanceFlags.join(' ')).toContain('no verbatim reviews captured');
  });

  it('renders captured bodyText verbatim when a review band lacks structured reviews[]', () => {
    const quote = 'I did not realize how soothing white noise could be at any volume.';
    const r = reconstructPagePattern(
      [
        section({
          interactionModel: 'review-grid',
          headings: ['Loved by Thousands'],
          reviews: [],
          bodyText: ['4.8/5 rating - 5,209 reviews', quote, 'Vicki E.'],
        }),
      ],
      opts,
    );
    expect(r.php).toContain(quote);
    expect(r.php).toContain('Vicki E.');
    expect(r.php).not.toContain('[reviews not captured]');
    // No fabrication flag when real copy was present.
    expect(r.provenanceFlags.join(' ')).not.toContain('no verbatim reviews captured');
    expect(r.bodyText).toContain(quote);
  });

  it('renders product-card rows with title + desc + button per card', () => {
    const r = reconstructPagePattern(
      [
        section({
          interactionModel: 'product-card-row',
          headings: ['SNOOZ Original', 'SNOOZ Go 2'],
          bodyText: ['Best Seller', 'Travel ready'],
          buttonLabels: ['Shop Now', 'Shop Now'],
          images: [img(`${WP}a.jpg`), img(`${WP}b.jpg`)],
        }),
      ],
      opts,
    );
    expect(r.php).toContain('>SNOOZ Original</h3>');
    expect(r.php).toContain('>SNOOZ Go 2</h3>');
    expect(r.php.match(/wp-block-button__link/g) || []).toHaveLength(2);
    expect(r.expectedText).toContain('Shop Now');
  });

  it('renders re-captured FAQ pairs as wp:details accordions, verbatim', () => {
    const s = section({ interactionModel: 'static', headings: ['Frequently Asked Questions'] }) as SectionSpec & {
      faqs?: { question: string; answer: string }[];
    };
    s.faqs = [{ question: 'Why recall Breez?', answer: 'Because the connector can corrode.' }];
    const r = reconstructPagePattern([s], opts);
    expect(r.php).toContain('<!-- wp:details -->');
    expect(r.php).toContain('<summary>Why recall Breez?</summary>');
    expect(r.php).toContain('Because the connector can corrode.');
    expect(r.expectedText).toContain('Why recall Breez?');
    expect(r.bodyText).toContain('Because the connector can corrode.');
  });

  it('emits a placeholder + flag for a FAQ question whose answer was not captured', () => {
    const s = section({ interactionModel: 'static', headings: ['FAQ'] }) as SectionSpec & {
      faqs?: { question: string; answer: string }[];
    };
    s.faqs = [{ question: 'Hydrated question?', answer: '' }];
    const r = reconstructPagePattern([s], opts);
    expect(r.php).toContain('<summary>Hydrated question?</summary>');
    expect(r.php).toContain('[answer not captured]');
    expect(r.provenanceFlags.join(' ')).toContain('not captured');
  });

  it('bounds card count by image count so responsive-duplicate headings do not spawn phantom cards', () => {
    // Replo captures desktop+mobile DOM: 5 features each appearing twice (+1) but only 5 images.
    const r = reconstructPagePattern(
      [
        section({
          interactionModel: 'project-card-grid',
          headings: ['A', 'B', 'C', 'D', 'E', 'A', 'B', 'C', 'D', 'E', 'A'],
          bodyText: ['da', 'db', 'dc', 'dd', 'de'],
          images: [img(`${WP}1.jpg`), img(`${WP}2.jpg`), img(`${WP}3.jpg`), img(`${WP}4.jpg`), img(`${WP}5.jpg`)],
        }),
      ],
      opts,
    );
    // Exactly 5 cards, all backed by a real image — no "[image unavailable]" placeholders.
    expect(r.php).not.toContain('image unavailable');
    expect(r.provenanceFlags).toHaveLength(0);
    expect((r.php.match(/wp-block-image/g) || []).length).toBe(5);
  });

  it('drops footer chrome so the pattern has no Shop/Support/Company nav', () => {
    const r = reconstructPagePattern(
      [
        section({ sectionIndex: 0, headings: ['Real content'] }),
        section({ sectionIndex: 1, interactionModel: 'footer', headings: ['Shop', 'Support', 'Company'] }),
      ],
      opts,
    );
    expect(r.php).toContain('Real content');
    expect(r.php).not.toContain('>Support</');
    expect(r.sectionsRendered).toBe(1);
  });

  it('skips a decorative (sub-200px) lead image in a text band but keeps a real photo', () => {
    // A 144x144 quote-mark glyph must NOT become the hero lead image — but it is
    // still source content, so media recovery appends it as a small image block
    // at its natural size instead of dropping it (never-lose-source-content).
    const deco = reconstructPagePattern(
      [section({ interactionModel: 'cover-with-headline', headings: ['Hero'], images: [{ url: `${WP}quote.png`, sourceUrl: `${WP}quote.png`, alt: '', kind: 'img', width: 144, height: 144 }] })],
      opts,
    );
    expect(deco.php).not.toContain('wp-block-cover__image-background'); // never the cover/lead
    expect(deco.php).toContain('quote.png'); // recovered as a small image block
    expect(deco.provenanceFlags.some((f) => /media-recovered#0/.test(f))).toBe(true);
    // ...but a real 800x800 photo is rendered.
    const photo = reconstructPagePattern(
      [section({ interactionModel: 'cover-with-headline', headings: ['Hero'], images: [img(`${WP}hero.jpg`, 'Hero')] })],
      opts,
    );
    expect(photo.php).toContain(`${WP}hero.jpg`);
  });

  it('renders a uniform multi-cell grid (icon-feature row) as columns with all cell titles + body', () => {
    const s = section({
      interactionModel: 'columns',
      headings: ['One device.', 'Three bedtime essentials.'],
    }) as SectionSpec;
    s.cells = [
      { heading: 'Built-In Sounds', body: ['No Subscriptions Ever'], image: null, icon: null, button: null },
      { heading: 'Bluetooth Speaker', body: ['Listen to Anything'], image: null, icon: null, button: null },
      { heading: 'Night Light', body: ['Optional Soft Light'], image: null, icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // Band headings render above the grid; all three cell titles recovered as h3.
    expect(r.php).toContain('>One device.</h2>');
    expect(r.php).toContain('>Three bedtime essentials.</h3>');
    expect(r.php).toContain('>Built-In Sounds</h3>');
    expect(r.php).toContain('>Bluetooth Speaker</h3>');
    expect(r.php).toContain('>Night Light</h3>');
    expect(r.php).toContain('Optional Soft Light');
    // Three columns, one per cell (count opening column comments only).
    expect((r.php.match(/<!-- wp:column /g) || []).length).toBe(3);
  });

  it('emits cell icons as theme SVG assets referenced via get_theme_file_uri (no wp:html)', () => {
    const s = section({ interactionModel: 'columns', headings: ['Three bedtime essentials.'] }) as SectionSpec;
    s.cells = [
      { heading: 'Built-In Sounds', body: ['No Subscriptions Ever'], image: null, icon: { kind: 'svg', markup: '<svg viewBox="0 0 24 24"><path d="M3 9h4l5-5v16l-5-5H3z"/></svg>', width: 52, height: 52 }, button: null },
      { heading: 'Night Light', body: ['Optional Soft Light'], image: null, icon: { kind: 'svg', markup: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>', width: 52, height: 52 }, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // Two icon assets registered for the driver to write...
    expect(r.iconAssets).toHaveLength(2);
    expect(r.iconAssets[0].path).toBe('assets/icon-0.svg');
    expect(r.iconAssets[0].svg).toContain('<svg');
    // ...and referenced via the gate-sanctioned get_theme_file_uri form (not inlined).
    expect(r.php).toContain("get_theme_file_uri('assets/icon-0.svg')");
    expect(r.php).not.toMatch(/<svg/); // never inlined into block markup
    // The whole pattern passes the injection scan (the PHP form is sanctioned).
    expect(scanForInjection(r.php)).toEqual([]);
  });

  it('sanitizes a malicious cell-icon SVG before writing it as an asset', () => {
    const s = section({ interactionModel: 'columns', headings: ['Features'] }) as SectionSpec;
    const evil = '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><path d="M0 0h24v24H0z"/></svg>';
    s.cells = [
      { heading: 'A', body: ['a'], image: null, icon: { kind: 'svg', markup: evil, width: 40, height: 40 }, button: null },
      { heading: 'B', body: ['b'], image: null, icon: { kind: 'svg', markup: evil, width: 40, height: 40 }, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    expect(r.iconAssets.length).toBeGreaterThan(0);
    for (const a of r.iconAssets) {
      expect(a.svg).not.toMatch(/<script/i);
      expect(a.svg).not.toMatch(/onload/i);
    }
  });

  it('sanitizeSvgAsset strips SMIL animation + external/script hrefs (direct-navigation XSS vectors)', () => {
    // SMIL <set> setting an event handler — must be removed (on*= strip misses it).
    expect(sanitizeSvgAsset('<svg><set attributeName="onload" to="alert(1)"/></svg>')).not.toMatch(/<set|onload/i);
    expect(sanitizeSvgAsset('<svg><animate attributeName="onbegin" to="x"/></svg>')).not.toMatch(/<animate|onbegin/i);
    // External href on <image>/<a>/<use> — removed; local #refs + data:image kept.
    expect(sanitizeSvgAsset('<svg><image href="https://evil.example/x"/></svg>')).not.toMatch(/https?:/i);
    expect(sanitizeSvgAsset('<svg><a xlink:href="javascript:alert(1)">x</a></svg>')).not.toMatch(/javascript:/i);
    expect(sanitizeSvgAsset('<svg><use href="#local-glyph"/></svg>')).toContain('#local-glyph');
    // A normal icon is untouched.
    expect(sanitizeSvgAsset('<svg viewBox="0 0 24 24"><path d="M3 9h4"/></svg>')).toContain('<path');
  });

  it('renders a colorful light-tinted section on the raised surface (mint band), white on default', () => {
    // A mint-tinted band (rgba(158,228,211,...), brightness ~205) -> surface-raised.
    const tinted = reconstructPagePattern(
      [section({ interactionModel: 'static', headings: ['Tinted'], backgroundColor: 'rgba(158, 228, 211, 0.3)', backgroundBrightness: 205 })],
      opts,
    );
    expect(tinted.php).toContain('has-surface-raised-background-color');
    // A white band stays default (no raised background).
    const white = reconstructPagePattern(
      [section({ interactionModel: 'static', headings: ['White'], backgroundColor: 'rgb(255, 255, 255)', backgroundBrightness: 255 })],
      opts,
    );
    expect(white.php).not.toContain('has-surface-raised-background-color');
    // A neutral light grey is NOT treated as a tint.
    const grey = reconstructPagePattern(
      [section({ interactionModel: 'static', headings: ['Grey'], backgroundColor: 'rgb(238, 238, 238)', backgroundBrightness: 238 })],
      opts,
    );
    expect(grey.php).not.toContain('has-surface-raised-background-color');
    expect(grey.php).not.toContain('background-color:#');
  });

  it('paints an opaque COLORED tint band with its exact captured color (not the grey raised token)', () => {
    // A solid pale-blue band (rgb(232,239,241)) is painted edge-to-edge with its
    // real color instead of being approximated by surface-raised.
    const blue = reconstructPagePattern(
      [section({ interactionModel: 'static', headings: ['Pale blue band'], backgroundColor: 'rgb(232, 239, 241)', backgroundBrightness: 237 })],
      opts,
    );
    expect(blue.php).toContain('background-color:#e8eff1');
    expect(blue.php).toContain('has-background');
    expect(blue.php).not.toContain('has-surface-raised-background-color');
  });

  it('stacks sections gaplessly — every section zeroes its top/bottom margin', () => {
    // White gaps between sections come from WP's default top-level block-gap;
    // each reconstructed section must zero its margin so bands butt edge-to-edge.
    const r = reconstructPagePattern(
      [
        section({ interactionModel: 'static', headings: ['One'] }),
        section({ interactionModel: 'static', headings: ['Two'] }),
      ],
      opts,
    );
    expect(r.php).toContain('margin-top:0;margin-bottom:0;');
    expect(r.php).not.toMatch(/"margin":\{"top":"var:preset/);
  });

  it('renders a cover-with-headline hero WITH a lead photo as a 2-column media-text', () => {
    const withPhoto = reconstructPagePattern(
      [
        section({
          interactionModel: 'cover-with-headline',
          headings: ['Your Go-Anywhere Sound Machine', '$59.99'],
          bodyText: ['A travel-ready 3-in-1.'],
          images: [
            { url: `${WP}quote.png`, sourceUrl: `${WP}quote.png`, alt: '', kind: 'img', width: 144, height: 144 },
            img(`${WP}hero.jpg`, 'Hero photo'),
          ],
        }),
      ],
      opts,
    );
    // Two-column band with the real photo (not the 144px glyph) in the media column;
    // the glyph is still recovered as a small trailing image block (source content).
    expect(withPhoto.php).toContain('<!-- wp:columns');
    expect(withPhoto.php).toContain(`${WP}hero.jpg`);
    const mediaColumn = withPhoto.php.slice(0, withPhoto.php.indexOf('<!-- /wp:columns -->'));
    expect(mediaColumn).not.toContain('quote.png'); // never in the media column
    expect(withPhoto.provenanceFlags.some((f) => /media-recovered#0/.test(f))).toBe(true);
    // A photo-less cover (e.g. a text sale banner) stays a centered text band.
    const banner = reconstructPagePattern(
      [section({ interactionModel: 'cover-with-headline', headings: ['SUMMER SALE'], images: [] })],
      opts,
    );
    expect(banner.php).not.toContain('<!-- wp:columns');
    expect(banner.php).toContain('>SUMMER SALE</h1>');
  });

  it('renders feature cells with a card background as distinct token-colored cards', () => {
    const s = section({ interactionModel: 'columns', headings: ['WHY DO BUSINESS WITH US', 'The Advantage'] }) as SectionSpec;
    const noFillIcon = { kind: 'svg' as const, markup: '<svg viewBox="0 0 24 24"><path d="M3 9h4"/></svg>', width: 48, height: 48 };
    s.cells = [
      { heading: 'EXPERIENCE', body: ['100 years in lumber.'], image: null, icon: noFillIcon, button: null, background: 'rgb(102, 101, 88)', radius: 10 },
      { heading: 'PROXIMITY', body: ['Near three major ports.'], image: null, icon: noFillIcon, button: null, background: 'rgb(102, 101, 88)', radius: 10 },
    ];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'X',
      paletteTokens: [
        { slug: 'surface-base', hex: '#ffffff' },
        { slug: 'surface-raised', hex: '#666558' },
        { slug: 'surface-inverse', hex: '#175236' },
      ],
    });
    // Each card maps to the nearest token (surface-raised taupe), rounded, light text.
    expect((r.php.match(/has-surface-raised-background-color/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(r.php).toContain('border-radius:10px');
    expect(r.php).toContain('has-text-inverse-color'); // dark card → light text
    // The (fill-less) icon glyph is recolored white so it's visible on the dark card.
    expect(r.iconAssets.length).toBe(2);
    expect(r.iconAssets.every((a) => /fill="#ffffff"/.test(a.svg))).toBe(true);
    // Without paletteTokens, the same cells render as plain columns (no card bg).
    const plain = reconstructPagePattern([s], { patternSlug: 'demo-replica/page-x', title: 'X' });
    expect(plain.php).not.toContain('has-surface-raised-background-color');
  });

  it('renders a full-width source card grid edge-to-edge (full-bleed), not constrained with margins', () => {
    const cells = [
      { heading: 'A', body: ['da'], image: null, icon: null, button: null, background: 'rgb(204, 198, 198)', radius: 0 },
      { heading: 'B', body: ['db'], image: null, icon: null, button: null, background: 'rgb(240, 237, 237)', radius: 0 },
    ] as unknown as SectionSpec['cells'];
    const palette = [{ slug: 'surface-base', hex: '#ffffff' }, { slug: 'surface-raised', hex: '#ccc6c6' }];
    const full = section({ interactionModel: 'columns', headings: ['Services'] }) as SectionSpec;
    full.layout = { ...full.layout, containerWidth: 1440 };
    full.cells = cells;
    const r = reconstructPagePattern([full], { patternSlug: 'x/x', title: 'X', paletteTokens: palette });
    expect(r.php).toContain('"align":"full"'); // full-bleed columns
    expect(r.php).toMatch(/wp:columns \{[^}]*"blockGap":"0"/); // cards touch (no gap)
    expect(r.php).toContain('padding-left:0px'); // no side margin

    // A genuinely constrained source (narrow container) keeps the constraint.
    const narrow = section({ interactionModel: 'columns', headings: ['X'] }) as SectionSpec;
    narrow.layout = { ...narrow.layout, containerWidth: 760 };
    narrow.cells = cells;
    const r2 = reconstructPagePattern([narrow], { patternSlug: 'x/x', title: 'X', paletteTokens: palette });
    expect(r2.php).toContain('wideSize":"1100px');
  });

  it('defaults card corners to FLAT (0px) when the source card has no rounding — not a phantom 12px', () => {
    const s = section({ interactionModel: 'columns', headings: ['Services'] }) as SectionSpec;
    s.cells = [
      { heading: 'A', body: ['desc a'], image: null, icon: null, button: null, background: 'rgb(204, 198, 198)', radius: 0 },
      { heading: 'B', body: ['desc b'], image: null, icon: null, button: null, background: 'rgb(240, 237, 237)', radius: 0 },
    ] as unknown as SectionSpec['cells'];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'X',
      paletteTokens: [{ slug: 'surface-base', hex: '#ffffff' }, { slug: 'surface-raised', hex: '#ccc6c6' }],
    });
    expect(r.php).not.toContain('border-radius:12px');
    expect(r.php).toContain('border-radius:0px');
  });

  it('reproduces a card’s captured padding + left icon/text alignment (computed-style transfer)', () => {
    const s = section({ interactionModel: 'columns', headings: ['WHY'] }) as SectionSpec;
    s.textAlign = 'left';
    const icon = { kind: 'svg' as const, markup: '<svg viewBox="0 0 24 24"><path d="M3 9h4"/></svg>', width: 48, height: 48 };
    const base = {
      body: ['desc'],
      image: null,
      icon,
      button: null,
      background: 'rgb(102, 101, 88)',
      radius: 10,
      padding: { top: 34, right: 45, bottom: 96, left: 45 },
      align: 'left' as const,
      iconAlign: 'left' as const,
    };
    s.cells = [{ heading: 'EXPERIENCE', ...base }, { heading: 'PROXIMITY', ...base }];
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'X',
      paletteTokens: [{ slug: 'surface-raised', hex: '#666558' }],
    });
    // Captured card padding reproduced as a responsive clamp (max == captured px).
    // (The section wrapper keeps the preset for its own horizontal padding.)
    expect(r.php).toMatch(/padding-left:clamp\([^)]*45px\)/);
    expect(r.php).toMatch(/padding-top:clamp\([^)]*34px\)/);
    // Icon follows the card alignment (left) — not the old hard-center.
    expect(r.php).not.toContain('aligncenter');
    // Card text is left-aligned (no centered text).
    expect(r.php).not.toContain('has-text-align-center');
  });

  it('renders an animated-cover hero as a wp:cover with the photo + overlaid white text', () => {
    const wideHero = { url: `${WP}yard.jpg`, sourceUrl: `${WP}yard.jpg`, alt: 'lumber yard', kind: 'img' as const, width: 1440, height: 796 };
    const r = reconstructPagePattern(
      [section({ interactionModel: 'animated-cover', headings: ['Over 100 Years'], bodyText: ['We collaborate.'], buttonLabels: ['TALK TO US'], images: [wideHero] })],
      opts,
    );
    expect(r.php).toContain('<!-- wp:cover');
    expect(r.php).toContain('wp-block-cover__image-background');
    expect(r.php).toContain(`${WP}yard.jpg`);
    expect(r.php).toContain('>Over 100 Years</h1>');
    expect(r.php).toContain('has-text-inverse-color'); // overlaid white text
    expect(r.expectedAssets).toContain(`${WP}yard.jpg`);
    // No usable full-bleed photo → falls back to a centered text band.
    const noImg = reconstructPagePattern([section({ interactionModel: 'animated-cover', headings: ['Hi'] })], opts);
    expect(noImg.php).not.toContain('<!-- wp:cover');
  });

  it('renders the cover hero height as a proportional vw (scales across widths), not fixed desktop px', () => {
    const wideHero = { url: `${WP}yard.jpg`, sourceUrl: `${WP}yard.jpg`, alt: '', kind: 'img' as const, width: 1440, height: 796 };
    const s = section({ interactionModel: 'animated-cover', headings: ['Hero'], images: [wideHero] }) as SectionSpec;
    s.height = 720; // captured at the 1440-px desktop width
    const r = reconstructPagePattern([s], opts);
    // 720 / 1440 = 50vw — proportional, so it renders ~513px at 1008, not a fixed
    // 720px that is too tall at any narrower width.
    expect(r.php).toMatch(/min-height:50vw/);
    expect(r.php).toContain('"minHeightUnit":"vw"');
    expect(r.php).not.toMatch(/min-height:720px/);
  });

  it('renders a many-image gallery as a wp:gallery grid, not a 25-wide flex row', () => {
    const imgs = Array.from({ length: 25 }, (_, i) => img(`${WP}g${i}.jpg`, `img ${i}`));
    const r = reconstructPagePattern([section({ interactionModel: 'gallery', headings: ['Gallery'], images: imgs })], opts);
    expect(r.php).toContain('<!-- wp:gallery');
    expect(r.php).toContain('columns-4');
    expect(r.php).toContain('is-gallery-scroller');
    // 25 images become 25 wp:image figures inside ONE gallery, not 25 wp:columns.
    expect((r.php.match(/<!-- wp:image /g) || []).length).toBe(25);
    expect((r.php.match(/<!-- wp:column /g) || []).length).toBe(0);
    expect(r.expectedAssets).toHaveLength(25);
  });

  it('does NOT route to a cell grid when fewer than 2 cells carry a title + body (e.g. a hero split)', () => {
    const s = section({ interactionModel: 'cover-with-headline', headings: ['Hero'], bodyText: ['Sub'] }) as SectionSpec;
    // A 2-up hero: one text cell (title+body), one image cell (no title/body).
    s.cells = [
      { heading: 'Hero', body: ['Sub'], image: null, icon: null, button: null },
      { heading: null, body: [], image: img(`${WP}p.jpg`), icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // Falls through to the text band (single h1), not a column grid.
    expect(r.php).toContain('>Hero</h1>');
    expect((r.php.match(/wp:columns\b/g) || []).length).toBe(0);
  });

  it('produces only WordPress block comments (no raw PHP/script/handlers in body)', () => {
    const r = reconstructPagePattern(
      [section({ headings: ['Hi <script>'], bodyText: ['onerror=alert(1)'] })],
      opts,
    );
    const body = r.php.split('?>\n')[1];
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/<\?php/);
    // The dangerous chars are escaped, not emitted raw.
    expect(body).toContain('&lt;script&gt;');
  });

  it('renderFaq carries the captured intro heading size', () => {
    const s = section({ interactionModel: 'static', headings: ['Questions'], headingSizes: [28], headingLineHeights: [1.2], headingFamilies: ['display'] }) as SectionSpec & { faqs?: { question: string; answer: string }[] };
    s.faqs = [{ question: 'Q one?', answer: 'A one.' }];
    const r = reconstructPagePattern([s], opts);
    expect(r.php).toMatch(/"fontSize":"[^"]*28px|font-size:[^;]*28px/);
  });

  it('renderCardGrid carries captured card heading/body type', () => {
    const r = reconstructPagePattern([section({ interactionModel: 'project-card-grid', headings: ['Alpha', 'Beta'], headingSizes: [20, 20], headingLineHeights: [1.3, 1.3], headingFamilies: ['display', 'display'], bodyText: ['desc a', 'desc b'], bodyTextSizes: [15, 15], images: [img(`${WP}1.jpg`), img(`${WP}2.jpg`)] })], opts);
    expect(r.php).toMatch(/"fontSize":"[^"]*20px|font-size:[^;]*20px/);
  });

  it('renderReviewGrid carries the captured heading size + line-height (not the theme preset)', () => {
    const r = reconstructPagePattern([section({ interactionModel: 'review-grid', headings: ['What People Say'], headingSizes: [24], headingLineHeights: [1.4], headingFamilies: ['display'], bodyText: ['Great service', 'Loved it', 'Recommend'] })], opts);
    expect(r.php).toMatch(/"fontSize":"[^"]*24px|font-size:[^;]*24px/);
  });

  it('neutralizes a comment-breakout title so the doc-comment header cannot inject PHP', () => {
    // A source-derived title crafted to close the doc-comment early, run PHP,
    // and re-open a comment that swallows the rest through the real `*/?>`.
    const malicious = '*/ system($_GET[0]); /*';
    const r = reconstructPagePattern([section({ headings: ['Hello'] })], {
      patternSlug: 'demo-replica/page-x',
      title: malicious,
    });
    // The comment-breakout delimiters are stripped, so the injected text is left
    // inert inside a properly-closed doc-comment (it never closes the comment to
    // reach executable context). Exactly one `*/` (the real header close) remains.
    expect(r.php).not.toContain('*/ system');
    expect(r.php).not.toContain('/*\n');
    expect((r.php.match(/\*\//g) || []).length).toBe(1);
    // ...and the whole pattern passes the injection scan (no smuggled PHP).
    expect(scanForInjection(r.php)).toEqual([]);
  });
});

describe('sanitizePatternHeaderField', () => {
  it('strips comment and PHP-tag delimiters and collapses to one line', () => {
    expect(sanitizePatternHeaderField('*/ evil(); /*')).toBe('evil();');
    // Only the `<?` / `?>` delimiters are stripped (so `<?php` leaves `php`); the
    // point is no open/close PHP tag survives, not lexical reconstruction.
    expect(sanitizePatternHeaderField('a <?php b ?> c')).toBe('a php b  c');
    expect(sanitizePatternHeaderField('line1\nline2')).toBe('line1 line2');
  });

  it('leaves a normal title/slug unchanged', () => {
    expect(sanitizePatternHeaderField('Page — X')).toBe('Page — X');
    expect(sanitizePatternHeaderField('demo-replica/page-x')).toBe('demo-replica/page-x');
  });
});

describe('reconstructPagePattern — coverage-gated core/html fallback', () => {
  const opts = { patternSlug: 'demo-replica/page-x', title: 'Page — X' };

  it('emits a verbatim core/html island when the structured render drops a captured image', () => {
    // A 60px glyph is below the 90px media-recovery floor, so it cannot be recovered —
    // a silent content loss. With sectionHtml present, we fall back to the island.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="/wp-content/uploads/team.jpg" alt=""/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    expect(r.body).toContain('/wp-content/uploads/team.jpg'); // the dropped image is preserved
    expect(r.provenanceFlags.some((f) => /html-fallback#0/.test(f))).toBe(true);
  });

  it('keeps structured blocks when the render covers the captured content', () => {
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/big.jpg', sourceUrl: 'https://cdn.test/big.jpg', alt: '', kind: 'img', width: 800, height: 600 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="/wp-content/uploads/big.jpg"/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).not.toContain('<!-- wp:html');
    expect(r.provenanceFlags.some((f) => /html-fallback/.test(f))).toBe(false);
  });

  it('prefers the styled snapshot and flags html-fallback-styled when styledHtml is present (R4b floor)', () => {
    // Same silent loss as above, but the section carries a self-contained styled
    // snapshot — R4b emits THAT (renders styled), not the bare sectionHtml.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="/wp-content/uploads/team.jpg" alt=""/></section>',
      styledHtml:
        '<section style="display:flex;background-color:rgb(10,20,30)">' +
        '<h2 style="color:rgb(255,255,255)">Our Story</h2>' +
        '<img style="width:150px;height:150px" src="/wp-content/uploads/team.jpg" alt=""/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    // The STYLED snapshot is what shipped — inline styles preserved verbatim.
    expect(r.body).toContain('display:flex');
    expect(r.body).toContain('color:rgb(255,255,255)');
    // Distinct provenance prefix so the styled island is NOT counted as an
    // unstyled fallback (`html-fallback#<i>` is the unstyled signal).
    expect(r.provenanceFlags.some((f) => /html-fallback-styled#0/.test(f))).toBe(true);
    expect(r.provenanceFlags.some((f) => /(^|\s)html-fallback#0/.test(f))).toBe(false);
  });

  it('does NOT fall back when the section is lossy but has no sectionHtml (ineligible)', () => {
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      // no sectionHtml → not fallback-eligible (e.g. over-cap / truncated)
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).not.toContain('<!-- wp:html');
  });

  it('blocks path: fires adapter recipe before the core/html island when adapterBlocks is supplied', () => {
    // A 60px glyph is below the 90px media-recovery floor, so it cannot be recovered —
    // triggering the lost-coverage branch. The adapter recipe matches <img> and
    // emits a core/image block — it should win over the core/html fallback island.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<img src="https://cdn.test/team.jpg" alt="a"/>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'Page — X',
      adapterBlocks: { recipes: [{ match: 'img', block: 'core/image', inner: 'drop' }] },
      sourceUrl: 'https://example.com/page',
    });
    expect(r.body).toContain('<!-- wp:image -->');
    expect(r.body).not.toContain('<!-- wp:html');
    expect(r.provenanceFlags.some((f) => f.includes('adapter-recipe#'))).toBe(true);
    expect(r.provenanceFlags.some((f) => f.includes('html-fallback'))).toBe(false);
  });

  it('carry path: falls through to core/html island when adapterBlocks is absent', () => {
    // Same fixture but NO adapterBlocks — the carry/theme path. Must land on
    // the html-fallback island, not an adapter-recipe block.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<img src="https://cdn.test/team.jpg" alt="a"/>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], {
      patternSlug: 'demo-replica/page-x',
      title: 'Page — X',
      // no adapterBlocks — carry/theme path
    });
    expect(r.body).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    expect(r.provenanceFlags.some((f) => f.includes('html-fallback'))).toBe(true);
    expect(r.provenanceFlags.some((f) => f.includes('adapter-recipe#'))).toBe(false);
  });
});

describe('reconstructPagePattern — section-level media recovery (no island for recoverable media)', () => {
  const opts = { patternSlug: 'demo-replica/page-x', title: 'Page — X' };

  it('cell grid renders an unclaimed section-level background image as its own column', () => {
    // The Wix photo|card column-strip shape: heading-only cells route the section
    // to the cell grid, but the photo column is captured as a SECTION-level
    // background image no cell claims — it must land as an image column, not
    // drop and island the whole section.
    const headingOnly = (heading: string) => ({ heading, body: [], image: null, icon: null, button: null });
    const s = section({
      interactionModel: 'static',
      headings: ['Step 1', 'Check out my site'],
      images: [
        { url: `${WP}step-photo.jpg`, sourceUrl: 'https://cdn.test/step-photo.jpg', alt: 'desk', kind: 'background', width: 810, height: 362 },
      ],
      sectionHtml: '<section><h3>Step 1</h3><h3>Check out my site</h3><img src="/wp-content/uploads/2026/05/step-photo.jpg"/></section>',
    }) as SectionSpec & { cells: unknown[] };
    s.layout = { ...s.layout, columnCount: 3 };
    s.cells = [headingOnly('Step 1'), headingOnly('Check out my site')];
    const r = reconstructPagePattern([s as SectionSpec], opts);
    expect(r.body).not.toContain('<!-- wp:html');
    expect(r.body).toContain('step-photo.jpg');
    // photo column joins the two card columns
    expect((r.body.match(/<!-- wp:column\b/g) || []).length).toBe(3);
    expect(r.provenanceFlags.some((f) => f.includes('html-fallback'))).toBe(false);
  });

  it('recovers a dropped local image at the coverage gate instead of islanding (text intact)', () => {
    // A 150px image is below MIN_LEAD_IMAGE_PX (200) so renderTextBand drops it,
    // but it has a local uploads URL and is above the decorative floor (90) —
    // append it as an image block rather than demoting the section to an island.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/team.jpg', sourceUrl: 'https://cdn.test/team.jpg', alt: '', kind: 'img', width: 150, height: 150 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="/wp-content/uploads/team.jpg" alt=""/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).not.toContain('<!-- wp:html');
    expect(r.body).toContain('/wp-content/uploads/team.jpg');
    expect(r.provenanceFlags.some((f) => /media-recovered#0/.test(f))).toBe(true);
    expect(r.provenanceFlags.some((f) => f.includes('html-fallback'))).toBe(false);
  });

  it('renders a native missing-media placeholder for an un-migrated remote-CDN image (no leak, no island)', () => {
    // Under the structured strategy the section renders natively. A non-uploads
    // image URL cannot ship (the gate bans remote CDN URLs), so it becomes a
    // native missing-media placeholder rather than leaking the URL — the heading
    // survives, there is no remote URL, and no verbatim island.
    const s = section({
      headings: ['Our Story'],
      images: [{ url: 'https://cdn.test/photo.jpg', sourceUrl: 'https://cdn.test/photo.jpg', alt: '', kind: 'img', width: 800, height: 600 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="https://cdn.test/photo.jpg"/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).not.toContain('cdn.test'); // no remote URL leak
    expect(r.body).toContain('Our Story'); // heading preserved
    expect(r.provenanceFlags.some((f) => /media-recovered/.test(f))).toBe(false);
  });

  it('rewrites a native wp:image remote src via mediaUrlMap (no remote leak past the gate)', () => {
    // The engine's native reconstruction emits the source <img src> verbatim
    // (a remote CDN variant URL), which it does NOT route through mediaUrlMap —
    // only the island path does. reconstructPagePattern must apply a media
    // post-pass so the migrated upload URL replaces the remote one; otherwise a
    // hasUnmigratedRemoteAsset gate failure ships on every native image page.
    const remote =
      'https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_680,h_510,q_90/abc123~mv2.jpg';
    const s = section({
      headings: ['Our Team'],
      images: [{ url: remote, sourceUrl: remote, alt: '', kind: 'img', width: 680, height: 510 }],
      sectionHtml: `<section><h2>Our Team</h2><img src="${remote}" alt=""/></section>`,
    } as Partial<SectionSpec>);
    const mediaUrlMap = new Map([[remote, '/wp-content/uploads/2026/06/abc123.jpg']]);
    const r = reconstructPagePattern([s], { ...opts, mediaUrlMap });
    expect(r.body).toContain('/wp-content/uploads/2026/06/abc123.jpg');
    expect(r.body).not.toContain('static.wixstatic.com');
  });

  it('does NOT recover a sub-90px decorative glyph — the section still islands', () => {
    const s = section({
      headings: ['Our Story'],
      images: [{ url: '/wp-content/uploads/glyph.png', sourceUrl: 'https://cdn.test/glyph.png', alt: '', kind: 'img', width: 60, height: 60 }],
      sectionHtml: '<section><h2>Our Story</h2><img src="/wp-content/uploads/glyph.png"/></section>',
    } as Partial<SectionSpec>);
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    expect(r.provenanceFlags.some((f) => /media-recovered/.test(f))).toBe(false);
  });
});

describe('reconstructPagePattern — converted-sections (HTML→blocks) branch', () => {
  const opts = { patternSlug: 'demo-replica/page-x', title: 'Page — X' };
  // The provenance flag `html-to-blocks#<i>` is the reliable discriminator that the
  // converted branch fired (the structured render never emits it).
  const conv = (markup: string, wpHtmlResidue = 0) =>
    new Map([[0, { markup, wpHtmlResidue }]]);

  it('emits clean converted markup (native, no island) and skips the structured render', () => {
    const s = section({ headings: ['My Heading'], bodyText: ['some body copy'] });
    const markup =
      '<!-- wp:heading --><h2>My Heading</h2><!-- /wp:heading -->\n' +
      '<!-- wp:paragraph --><p>some body copy</p><!-- /wp:paragraph -->';
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup) });
    expect(r.body).toContain('<!-- wp:heading');   // native blocks present
    expect(r.body).not.toContain('<!-- wp:html');  // no core/html island
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(true);
  });

  it('falls through to the structured render when residue > 0', () => {
    const s = section({ headings: ['Fallback Heading'] });
    const markup = '<!-- wp:html --><div>unconverted</div><!-- /wp:html -->';
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup, 2) });
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(false);
    expect(r.body).toContain('Fallback Heading');  // structured render ran
    expect(r.body).not.toContain('unconverted');
  });

  it('falls through when the conversion drops a captured image (coverage lost)', () => {
    const s = section({ headings: ['Has Image'], images: [img('https://example.test/keep.jpg')] });
    const markup = '<!-- wp:heading --><h2>Has Image</h2><!-- /wp:heading -->'; // image missing
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup) });
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(false);
  });

  it('falls through when a converted image keeps a remote (non-migrated) URL', () => {
    // rawHandler preserves the source <img src>; a non-downloaded asset's remote CDN
    // URL would FAIL the drift gate (validate-artifacts). Coverage can't catch it —
    // the URL is present in BOTH the markup and the captured images — so the
    // remote-asset guard must reject it and fall through to the structured render
    // (which placeholders non-WP images).
    const s = section({ headings: ['Remote Photo'], images: [img('https://cdn.example.test/photo.jpg')] });
    const markup =
      '<!-- wp:heading --><h2>Remote Photo</h2><!-- /wp:heading -->\n' +
      '<!-- wp:image --><figure class="wp-block-image"><img src="https://cdn.example.test/photo.jpg" alt=""/></figure><!-- /wp:image -->';
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup) });
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(false);
    expect(r.body).not.toContain('https://cdn.example.test/photo.jpg'); // gate-safe fallback
  });

  it('accepts a converted image already migrated to the WP media library', () => {
    const wpImg = `${WP}local.jpg`;
    const s = section({ headings: ['Local Photo'], images: [img(wpImg)] });
    const markup =
      '<!-- wp:heading --><h2>Local Photo</h2><!-- /wp:heading -->\n' +
      `<!-- wp:image --><figure class="wp-block-image"><img src="${wpImg}" alt=""/></figure><!-- /wp:image -->`;
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup) });
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(true);
    expect(r.body).toContain(wpImg); // migrated URL preserved natively (no island)
  });

  it('does not emit the converted branch when no convertedSections map is supplied', () => {
    const s = section({ headings: ['Plain'] });
    const r = reconstructPagePattern([s], opts);
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#'))).toBe(false);
    expect(r.body).toContain('Plain'); // structured render ran
  });

  it('falls through (not accepted) when converted markup carries an unresolved {{placeholder}}', () => {
    const s = section({ headings: ['Tutorial'] });
    const markup =
      '<!-- wp:heading --><h2>Tutorial</h2><!-- /wp:heading -->\n' +
      '<!-- wp:code --><pre class="wp-block-code"><code>Hello {{ name }}</code></pre><!-- /wp:code -->';
    const r = reconstructPagePattern([s], { ...opts, convertedSections: conv(markup) });
    expect(r.provenanceFlags.some((f) => f.startsWith('html-to-blocks#0'))).toBe(false);
  });
});

describe('reconstructPagePattern — gallery strip vs wrapping grid', () => {
  const opts = { patternSlug: 'demo-replica/page-g', title: 'G' };
  const imgs = (n: number, w: number, h: number) =>
    Array.from({ length: n }, (_, i) => ({
      url: `${WP}shot-${i}.jpg`,
      sourceUrl: `${WP}shot-${i}.jpg`,
      alt: '',
      kind: 'img' as const,
      width: w,
      height: h,
    }));

  it('renders a multi-row source gallery as a wrapping CROPPED grid (no scroller)', () => {
    // The projects-page shape: 25 items ~238px tall inside an ~1800px section —
    // the source wraps over many rows. A horizontal scroller here hides ~80% of
    // the photos past the right edge.
    const s = section({
      interactionModel: 'gallery',
      height: 1802,
      images: imgs(25, 318, 238),
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('"imageCrop":true');
    expect(r.body).toContain('is-cropped');
    expect(r.body).not.toContain('is-gallery-scroller');
  });

  it('renders a single-row source gallery as the horizontal scroller strip', () => {
    // The homepage shape: 25 items ~510px tall inside a ~586px section — one
    // visual row the source presents as a swipeable strip.
    const s = section({
      interactionModel: 'gallery',
      height: 586,
      images: imgs(25, 680, 510),
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('is-gallery-scroller');
    expect(r.body).not.toContain('is-cropped');
  });

  it('defaults to the scroller when the section height is missing/zero (back-compat)', () => {
    const s = section({
      interactionModel: 'gallery',
      height: 0,
      images: imgs(8, 600, 400),
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('is-gallery-scroller');
  });
});

describe('reconstructPagePattern — promoted-heading body echo', () => {
  const opts = { patternSlug: 'demo-replica/page-x', title: 'X' };

  it('drops a bodyText echo of a heading when the source section shows the text ONCE (promoted styled <p>)', () => {
    // Wix marks a headline as a styled <p>: the walk promotes it to a heading
    // (≥28px) AND captures it as body — same element, captured twice. The
    // source renders it once, so the replica must too.
    const s = section({
      headings: ['Connect With Our Fictional Yard'],
      bodyText: ['Connect With Our Fictional Yard', 'A real supporting paragraph.'],
      sectionHtml:
        '<section><p class="font_2"><span>Connect With Our Fictional Yard</span></p>' +
        '<p>A real supporting paragraph.</p></section>',
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body.match(/Connect With Our Fictional Yard/g)).toHaveLength(1);
    expect(r.body).toContain('A real supporting paragraph.');
  });

  it('keeps the paragraph when the source genuinely renders the text twice', () => {
    // The about-us case: a heading AND a separate paragraph with identical copy,
    // both visible in the source — dropping the paragraph loses real content.
    const s = section({
      headings: ['Three Years Later'],
      bodyText: ['Three Years Later'],
      sectionHtml:
        '<section><h2>Three Years Later</h2><p>Three Years Later</p></section>',
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body.match(/Three Years Later/g)).toHaveLength(2);
  });

  it('keeps the paragraph when sectionHtml is unavailable (back-compat: never guess, never drop)', () => {
    const s = section({
      headings: ['Ambiguous Line'],
      bodyText: ['Ambiguous Line'],
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body.match(/Ambiguous Line/g)).toHaveLength(2);
  });

  it('keeps a genuine duplicate whose text carries an HTML entity (& vs &amp;)', () => {
    // Captured heading/body are DECODED DOM text; sectionHtml carries entities.
    // A raw-substring count finds 0 occurrences of "Food & Drink" in the encoded
    // source and would drop the genuine twice-rendered paragraph.
    const s = section({
      headings: ['Food & Drink'],
      bodyText: ['Food & Drink'],
      sectionHtml: '<section><h2>Food &amp; Drink</h2><p>Food &amp; Drink</p></section>',
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body.match(/Food &amp; Drink/g)).toHaveLength(2);
  });

  it('still drops an entity-bearing promoted echo shown once in the source', () => {
    const s = section({
      headings: ['Tools & Tips'],
      bodyText: ['Tools & Tips', 'A real supporting paragraph.'],
      sectionHtml:
        '<section><p class="font_2"><span>Tools &amp; Tips</span></p>' +
        '<p>A real supporting paragraph.</p></section>',
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body.match(/Tools &amp; Tips/g)).toHaveLength(1);
    expect(r.body).toContain('A real supporting paragraph.');
  });

  it('keeps echo-drop arrays index-aligned (surviving paragraph keeps its own typography)', () => {
    const s = section({
      headings: ['Promoted Headline'],
      bodyText: ['Promoted Headline', 'Styled survivor.'],
      bodyTextSizes: [34, 19],
      sectionHtml: '<section><p>Promoted Headline</p><p>Styled survivor.</p></section>',
    });
    const r = reconstructPagePattern([s], opts);
    // The survivor renders with ITS size (19px), not the dropped echo's 34px.
    expect(r.body).toMatch(/19px[^<]*<\/p>|19px[^>]*>Styled survivor\./);
    expect(r.body).not.toContain('34px');
    expect(r.body.match(/Promoted Headline/g)).toHaveLength(1);
  });
});

describe('reconstructPagePattern — captured forms → jetpack blocks', () => {
  const opts = { patternSlug: 'demo-replica/page-contact', title: 'Contact' };
  const contactForm = {
    fields: [
      { kind: 'name' as const, label: 'Full name', required: true, widthPct: 50 as const },
      { kind: 'email' as const, label: 'Email address', required: true, widthPct: 50 as const },
      { kind: 'select' as const, label: 'Topic', required: false, options: ['Billing', 'Support'] },
      { kind: 'textarea' as const, label: 'Message', required: false },
      { kind: 'hidden' as const, label: 'Campaign id', required: false },
    ],
    submitLabel: 'Send Message',
  };

  it('emits a jetpack/contact-form INSIDE the section group, after the section text', () => {
    const s = section({
      headings: ['Get in Touch'],
      bodyText: ['Drop us a line and our fictional team will reply.'],
      forms: [contactForm],
    });
    const r = reconstructPagePattern([s], opts);
    const open = r.body.indexOf('<!-- wp:jetpack/contact-form ');
    expect(open).toBeGreaterThan(-1);
    // Inside the section wrapper: the form opens BEFORE the section's close.
    expect(open).toBeLessThan(r.body.lastIndexOf('</section>'));
    // After the section's text content.
    expect(open).toBeGreaterThan(r.body.indexOf('Get in Touch'));
    // Field blocks + the core/button submit (current Jetpack form-editor
    // grammar — jetpack/button is connection-gated and renders empty on
    // unconnected installs) are present; banned shapes absent.
    expect(r.body).toContain('wp:jetpack/field-name');
    expect(r.body).toContain('wp:jetpack/field-email');
    expect(r.body).toContain('wp:jetpack/field-select');
    expect(r.body).toContain('wp:jetpack/field-textarea');
    expect(r.body).toContain('form-button-submit is-submit');
    expect(r.body).toContain('>Send Message</button>');
    expect(r.body).not.toContain('jetpack/button');
    expect(r.body).not.toContain('wp:columns');
  });

  it('registers emitted labels/options/submit with the provenance corpus; skipped fields flag only', () => {
    const s = section({ headings: ['Get in Touch'], forms: [contactForm] });
    const r = reconstructPagePattern([s], opts);
    for (const t of ['Full name', 'Email address', 'Topic', 'Billing', 'Support', 'Message', 'Send Message']) {
      expect(r.expectedText).toContain(t);
    }
    // The hidden field emits no text → not registered, but flagged for provenance.
    expect(r.expectedText).not.toContain('Campaign id');
    expect(r.provenanceFlags.some((f) => f.startsWith('form-field-skipped#') && f.includes('Campaign id'))).toBe(true);
  });

  it('suppresses the duplicate CTA whose label is the form submit (walk captures the submit twice)', () => {
    const s = section({
      headings: ['Get in Touch'],
      buttonLabels: ['Send Message'],
      forms: [contactForm],
    });
    const r = reconstructPagePattern([s], opts);
    // ONE Send Message — the live form submit; no dead twin CTA.
    expect(r.body.match(/Send Message/g)).toHaveLength(1);
    expect(r.body).toContain('form-button-submit is-submit');
  });

  it('suppression is count-based: a second identically-labeled source CTA survives', () => {
    const s = section({
      headings: ['Get in Touch'],
      buttonLabels: ['Send Message', 'Send Message'], // submit re-capture + a REAL second button
      forms: [contactForm],
    });
    const r = reconstructPagePattern([s], opts);
    // Two Send Message total: the surviving legit CTA + the form submit's inner HTML.
    expect(r.body.match(/Send Message/g)).toHaveLength(2);
    // Exactly ONE live submit; the survivor renders as a normal section CTA
    // (a plain core button without the submit classes), alongside the form.
    expect(r.body.match(/<button type="submit"/g)).toHaveLength(1);
    expect(r.body).toContain('wp:button');
  });

  it('cells path: the form submit re-captured as a cell.button is suppressed (no dead twin above the live form)', () => {
    // A homepage subscribe band that routes to the CELL GRID: >=2 cells with
    // heading+body, one cell carrying the form's own submit as its button.
    const s = section({
      interactionModel: 'columns',
      headings: ['Stay in the Loop'],
      forms: [{ fields: [{ kind: 'email' as const, label: 'Email', required: true }], submitLabel: 'Join' }],
    }) as SectionSpec;
    s.cells = [
      { heading: 'Newsletter', body: ['Fictional monthly digest.'], image: null, icon: null, button: 'Join' },
      { heading: 'No Spam', body: ['Unsubscribe anytime.'], image: null, icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // ONE Join — the live form submit; the cell's dead twin is suppressed.
    expect(r.body.match(/>Join</g)).toHaveLength(1);
    expect(r.body).toContain('form-button-submit is-submit');
    // The grid itself still rendered (cell headings survive).
    expect(r.body).toContain('Newsletter');
    expect(r.body).toContain('No Spam');
  });

  it('cells path: a heading that merely echoes the suppressed submit (walk double-capture) is dropped with it; a same-label heading in another cell survives', () => {
    // The corneliusholmes homepage shape: the subscribe band's submit widget is
    // captured as a cell whose heading AND button are both the submit text —
    // the heading is the button's own text node, not separate source content.
    const s = section({
      interactionModel: 'columns',
      headings: [],
      forms: [{ fields: [{ kind: 'email' as const, label: 'Email', required: true }], submitLabel: 'Join' }],
    }) as SectionSpec;
    s.cells = [
      { heading: 'Subscribe to my newsletter', body: ['Fictional monthly digest.'], image: null, icon: null, button: null },
      { heading: 'Join', body: [], image: null, icon: null, button: 'Join' }, // the submit, double-captured
      { heading: 'Join', body: ['A genuine standalone Join heading.'], image: null, icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // Join renders exactly twice: the live submit + the genuine third-cell heading.
    expect(r.body.match(/>Join</g)).toHaveLength(2);
    expect(r.body.match(/<button type="submit"/g)).toHaveLength(1);
    expect(r.body).toContain('A genuine standalone Join heading.');
    expect(r.body).toContain('Subscribe to my newsletter');
  });

  it('cells path: cells that re-capture the form FIELD labels are suppressed (photo + live form render, not a label grid)', () => {
    // The swiftlumber talk-to-us shape: a contact hero (form left | photo
    // right) whose walk re-captured the form's own field labels as content
    // cells (heading = the label, body = the required "*" marker). Unsuppressed,
    // those cells route the section to the CELL GRID, which drops the photo —
    // the coverage gate then islands the section and the live form is lost.
    const wpImg = `${WP}facility-flag.png`;
    const s = section({
      interactionModel: 'cover-with-headline',
      headings: ['Talk To Our Fictional Team'],
      bodyText: ['Connect with our fictional yard today.'],
      images: [img(wpImg, 'flag at the yard entrance')],
      mediaLayout: 'image-right',
      forms: [
        {
          fields: [
            { kind: 'name' as const, label: 'First name', required: true, widthPct: 50 as const },
            { kind: 'name' as const, label: 'Last name', required: true, widthPct: 50 as const },
            { kind: 'email' as const, label: 'Email', required: true },
            { kind: 'textarea' as const, label: 'How can we help?', required: true },
          ],
          submitLabel: 'Submit',
        },
      ],
    }) as SectionSpec;
    s.cells = [
      { heading: 'First name', body: ['*'], image: null, icon: null, button: null },
      { heading: 'Last name', body: ['*'], image: null, icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    // The photo renders natively — the section did NOT collapse to a label grid.
    expect(r.body).toContain(wpImg);
    expect(r.provenanceFlags.some((f) => f.includes('html-fallback'))).toBe(false);
    // The live jetpack form is present; labels live in the field attrs only.
    expect(r.body).toContain('wp:jetpack/contact-form');
    expect(r.body.match(/First name/g)).toHaveLength(1);
    expect(r.body).not.toMatch(/<h3[^>]*>First name/);
  });

  it('cells path: a field-label cell carrying REAL extra content survives field suppression', () => {
    // A genuine content cell that happens to share a field's label (e.g. an
    // "Email" help card next to the form) is NOT the walk's field echo — it
    // carries its own body copy — so it must keep rendering.
    const s = section({
      interactionModel: 'columns',
      headings: ['Reach Us'],
      forms: [{ fields: [{ kind: 'email' as const, label: 'Email', required: true }], submitLabel: 'Send' }],
    }) as SectionSpec;
    s.cells = [
      { heading: 'Email', body: ['Our fictional inbox is open around the clock.'], image: null, icon: null, button: null },
      { heading: 'Phone', body: ['Call the fictional front desk.'], image: null, icon: null, button: null },
    ];
    const r = reconstructPagePattern([s], opts);
    expect(r.body).toContain('Our fictional inbox is open around the clock.');
    expect(r.body).toContain('Call the fictional front desk.');
  });

  it('cells path suppression is count-based: a second same-label cell button survives', () => {
    const s = section({
      interactionModel: 'columns',
      headings: ['Stay in the Loop'],
      forms: [{ fields: [{ kind: 'email' as const, label: 'Email', required: true }], submitLabel: 'Join' }],
    }) as SectionSpec;
    s.cells = [
      { heading: 'Newsletter', body: ['Fictional monthly digest.'], image: null, icon: null, button: 'Join' },
      { heading: 'Community', body: ['A real second Join CTA.'], image: null, icon: null, button: 'Join' },
    ];
    const r = reconstructPagePattern([s], opts);
    // Two Join total: the surviving legit cell CTA + the live form submit.
    expect(r.body.match(/>Join</g)).toHaveLength(2);
    expect(r.body.match(/<button type="submit"/g)).toHaveLength(1);
  });

  it('is deterministic — two runs are byte-identical', () => {
    const make = () => reconstructPagePattern([section({ headings: ['Get in Touch'], forms: [contactForm] })], opts);
    expect(make().php).toBe(make().php);
  });

  it('emits no jetpack markup for sections without forms', () => {
    const r = reconstructPagePattern([section({ headings: ['Plain Band'] })], opts);
    expect(r.body).not.toContain('jetpack/');
  });

  it('renders the captured form once as a native jetpack/contact-form (no island doubling)', () => {
    // Under the structured strategy the section renders natively, so the captured
    // form becomes a single jetpack/contact-form. There is no verbatim island, so
    // the historical island+jetpack double-form risk does not arise; the
    // un-migrated image degrades to a native missing-media placeholder.
    const s = section({
      headings: ['Get in Touch'],
      images: [img('https://cdn.example.test/never-migrated.jpg')], // un-migrated image → native placeholder
      sectionHtml: '<section><h2>Get in Touch</h2><form><input type="email"/></form></section>',
      forms: [contactForm],
    });
    const r = reconstructPagePattern([s], opts);
    expect(r.body).not.toContain('lib-coverage-island'); // native, not islanded
    expect((r.body.match(/<!-- wp:jetpack\/contact-form/g) || []).length).toBe(1); // exactly one form (opening delimiter)
  });
});
