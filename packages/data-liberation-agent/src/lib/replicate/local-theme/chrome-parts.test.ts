// src/lib/replicate/local-theme/chrome-parts.test.ts
import { describe, it, expect } from 'vitest';
import { buildHeaderPart, buildCarriedHeaderPart, buildFooterPart, findChromeMounts, mountPartMarkup } from './chrome-parts.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';
import { InstanceStyleSheet } from '../normalize/instance-styles.js';
import { validateReplicaInputs } from '../../preview/replica-install.js';
import type { NavLink, Section } from '../local-site/types.js';

const NAV: NavLink[] = [
  { fromSlug: 'home', toSlug: 'about', label: 'About' },
  { fromSlug: 'home', toSlug: 'contact', label: 'Contact' },
  { fromSlug: 'home', toSlug: 'about', label: 'About (dupe)' },
  { fromSlug: 'about', toSlug: 'home', label: 'Home' },
];

describe('buildHeaderPart', () => {
  it('emits site-title + core/navigation with deduped links from the home page', () => {
    const html = buildHeaderPart('Acme Co', NAV, ['home', 'about', 'contact']);
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('<!-- wp:site-title');
    expect(html).toContain('<!-- wp:navigation');
    // home-page edges only, deduped by target, first label wins:
    expect(html).toContain('{"label":"About","url":"/about/"}');
    expect(html).toContain('{"label":"Contact","url":"/contact/"}');
    expect(html).not.toContain('About (dupe)');
    expect(html).not.toContain('{"label":"Home"');
  });

  it('falls back to one link per page (skipping home) when home has no outgoing links', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about']);
    expect(html).toContain('{"label":"About","url":"/about/"}');
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
  });

  it('escapes the home link to "/"', () => {
    const nav: NavLink[] = [{ fromSlug: 'home', toSlug: 'home', label: 'Home' }];
    const html = buildHeaderPart('Acme Co', nav, ['home']);
    expect(html).toContain('{"label":"Home","url":"/"}');
  });

  it('sanitizes labels that contain --> (would break block comment boundary)', () => {
    const nav: NavLink[] = [{ fromSlug: 'home', toSlug: 'faq', label: 'FAQ-->Answers' }];
    const html = buildHeaderPart('Acme Co', nav, ['home', 'faq']);
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).not.toContain('FAQ-->Answers');
  });

  it('title-cases hyphenated slugs in the fallback nav', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about-us']);
    expect(html).toContain('{"label":"About Us","url":"/about-us/"}');
  });
});

describe('buildHeaderPart (inNav preference)', () => {
  it('prefers in-nav links so a brand anchor cannot hijack the home label', () => {
    const nav: NavLink[] = [
      { fromSlug: 'home', toSlug: 'home', label: 'Brand Co' },                 // header brand anchor
      { fromSlug: 'home', toSlug: 'home', label: 'Home', inNav: true },        // real nav link
      { fromSlug: 'home', toSlug: 'about', label: 'About', inNav: true },
      { fromSlug: 'home', toSlug: 'services', label: 'inline services link' }, // body link
    ];
    const html = buildHeaderPart('Brand Co', nav, ['home', 'about', 'services']);
    expect(html).toContain('{"label":"Home","url":"/"}');
    expect(html).toContain('{"label":"About","url":"/about/"}');
    expect(html).not.toContain('Brand Co","url":"/"');          // brand label not used for a link
    expect(html).not.toContain('inline services link');          // body links excluded when nav links exist
  });
});

describe('buildCarriedHeaderPart', () => {
  const navHeader: Section = {
    id: 'header',
    role: 'header',
    classes: ['bp-header'],
    html:
      '<header class="bp-header"><nav><ul>' +
      '<li><a href="archive.html">Subjects</a></li>' +
      '<li><a href="archive.html">Community</a></li>' +
      '<li><a href="page.html">About</a></li>' +
      '</ul></nav></header>',
  };

  it('preserves the source root class while renaming the literal header tag away', () => {
    const header: Section = {
      id: 'header',
      role: 'header',
      classes: ['bp-header'],
      html: '<header class="bp-header"><p>Brand</p></header>',
    };
    const html = buildCarriedHeaderPart(header);
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('class="wp-block-group bp-header"');
    expect(html).not.toMatch(/<header\b/i);
    expect(html).not.toContain('</header>');
  });

  it('rewrites internal header hrefs to WordPress permalinks', () => {
    const header: Section = {
      id: 'header',
      role: 'header',
      classes: ['bp-header'],
      html: '<header class="bp-header"><p><a href="reviews.html">Reviews</a></p></header>',
    };
    const html = buildCarriedHeaderPart(header, { pageSlugs: ['home', 'reviews'] });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('href="/reviews/"');
    expect(html).not.toContain('reviews.html');
  });

  it('keeps nav-shaped carried headers valid for theme files', () => {
    const header: Section = {
      id: 'header',
      role: 'header',
      classes: ['bp-header'],
      html: '<header class="bp-header"><nav><a href="reviews.html">Reviews</a></nav></header>',
    };
    const html = buildCarriedHeaderPart(header, { pageSlugs: ['home', 'reviews'] });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('href="/reviews/"');
    expect(html).toContain('bp-header');
    expect(html).not.toContain('wp:html');
    expect(() => validateReplicaInputs([{ relativePath: 'parts/header.html', content: html }], undefined, 'acme-local')).not.toThrow();
  });

  it('uses resolved link labels for carried header nav targets', () => {
    const html = buildCarriedHeaderPart(navHeader, {
      pageSlugs: ['home', 'archive', 'page'],
      labelToUrl: (label) => {
        const key = label.toLowerCase().trim();
        if (key === 'community') return '/category/community/';
        if (key === 'about') return '/about/';
        return undefined;
      },
    });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('href="/archive/"');
    expect(html).toContain('href="/category/community/"');
    expect(html).toContain('href="/about/"');
    expect(html).not.toContain('href="page.html"');
  });

  it('keeps carried header nav targets on rewritten source hrefs without a label resolver', () => {
    const html = buildCarriedHeaderPart(navHeader, { pageSlugs: ['home', 'archive', 'page'] });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('href="/archive/"');
    expect(html).toContain('href="/page/"');
    expect(html).not.toContain('href="/category/community/"');
    expect(html).not.toContain('href="/about/"');
  });

  it('adds root inline styles to the provided instance stylesheet', () => {
    const sheet = new InstanceStyleSheet();
    const header: Section = {
      id: 'header',
      role: 'header',
      classes: ['bp-header'],
      html: '<header class="bp-header" style="display:flex; gap: 12px"><p>Brand</p></header>',
    };
    const html = buildCarriedHeaderPart(header, { instanceStyles: sheet });
    expect(html).toMatch(/class="wp-block-group bp-header lib-i[0-9a-f]{10}"/);
    expect(sheet.toCss()).toContain('{display:flex;gap:12px}');
  });

  it('appends the sticky state block when sticky behavior is provided', () => {
    const header: Section = {
      id: 'header',
      role: 'header',
      classes: ['bp-header'],
      html: '<header class="bp-header"><p>Brand</p></header>',
    };
    const html = buildCarriedHeaderPart(header, {
      sticky: { kind: 'sticky', toggleClass: 'is-scrolled', offset: 24 },
    });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('<!-- wp:dla/sticky {"toggleClass":"is-scrolled","offset":24} -->');
    expect(html.indexOf('wp:dla/sticky')).toBeGreaterThan(html.indexOf('<!-- /wp:group -->'));
  });
});

describe('buildFooterPart', () => {
  it('renders the captured footer section as blocks', () => {
    const footer: Section = { id: 'footer', role: 'footer', html: '<footer><p>All rights reserved</p></footer>' };
    const html = buildFooterPart(footer, 'Acme Co');
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('All rights reserved');
  });

  it('emits footer direct children as separate blocks (not one merged blob)', () => {
    const footer: Section = { id: 'footer', role: 'footer', html: '<footer><p>Copyright 2024 Acme</p><p>All rights reserved</p></footer>' };
    const html = buildFooterPart(footer, 'Acme Co');
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('Copyright 2024 Acme');
    expect(html).toContain('All rights reserved');
    expect((html.match(/<!-- wp:paragraph -->/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('preserves an inline-svg signup badge + form verbatim (not a stripped group)', () => {
    const footer: Section = {
      id: 'footer',
      role: 'footer',
      html:
        '<footer><section class="signup"><div class="signup__card">' +
        '<svg class="signup__icon" viewBox="0 0 24 24"><path d="M2 2h20v20H2Z" fill="#abc"/><path d="M6 6h12v12H6Z" fill="#123"/></svg>' +
        '<div class="signup__text"><h2>Subscribe</h2></div>' +
        '<form class="signup__form"><input class="email-field" type="email"/><button type="submit">Sign Up</button></form>' +
        '</div></section></footer>',
    };
    const html = buildFooterPart(footer, 'Acme Co');
    expect(html).toContain('class="signup__icon"');
    expect(html).toContain('<path'); // the svg paths survive (badge actually renders)
    expect(html).toContain('<svg');
    expect(html).toContain('<input'); // signup form survives
    // the island is unwrapped to raw HTML — no custom-html block in the theme file
    expect(html).not.toContain('<!-- wp:html -->');
    expect(html).not.toContain('wp-block-group signup__icon'); // NOT downgraded to a group
  });

  it('emits a minimal default footer when no footer section exists', () => {
    const html = buildFooterPart(null, 'Acme Co');
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('Acme Co');
  });

  it('rewrites internal footer hrefs to WP permalinks', () => {
    const footer: Section = {
      id: 'footer',
      role: 'footer',
      html: '<footer><p><a href="about.html">About us</a> · <a href="index.html">Home</a> · <a href="https://x.com">Ext</a></p></footer>',
    };
    const html = buildFooterPart(footer, 'Acme Co', { pageSlugs: ['home', 'about'] });
    expect(html).toContain('href="/about/"');
    expect(html).toContain('href="/"');
    expect(html).toContain('https://x.com'); // external untouched
    expect(html).not.toContain('about.html');
  });

  it('wraps the captured footer in a token-styled full-width group when tokens are provided', () => {
    const footer: Section = {
      id: 'footer',
      role: 'footer',
      html: '<footer><p><a href="about.html">About us</a> · <a href="https://x.com">Ext</a></p></footer>',
    };
    const html = buildFooterPart(footer, 'Acme', { pageSlugs: ['home', 'about'], bgToken: 'surface-inverse', textToken: 'text-inverse' });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('"backgroundColor":"surface-inverse"');
    expect(html).toContain('"textColor":"text-inverse"');
    // WP-canonical serialized color classes (text class, bg class, then flags).
    expect(html).toContain('has-text-inverse-color has-surface-inverse-background-color has-text-color has-background');
    expect(html).toContain('About us');       // inner footer content still present
    expect(html).toContain('href="/about/"'); // hrefs still rewritten
  });

  it('styles the default footer too when tokens are provided', () => {
    const html = buildFooterPart(null, 'Acme Co', { bgToken: 'surface-inverse', textToken: 'text-inverse' });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('has-surface-inverse-background-color');
    expect(html).toContain('Acme Co');
  });

  it('emits no token wrapper when no tokens are provided (output unchanged)', () => {
    const footer: Section = { id: 'footer', role: 'footer', html: '<footer><p>plain</p></footer>' };
    const captured = buildFooterPart(footer, 'Acme Co');
    expect(captured).not.toContain('has-background');
    expect(captured).not.toContain('"backgroundColor"');
    const dflt = buildFooterPart(null, 'Acme Co');
    expect(dflt).not.toContain('has-background');
    expect(dflt).not.toContain('"backgroundColor"');
  });
});

describe('buildHeaderPart plain mode (carry)', () => {
  it('emits bare site-title + navigation without the styled wrapper', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about'], { plain: true });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('wp:site-title');
    expect(html).toContain('wp:navigation');
    expect(html).not.toContain('wp:group');       // no decorative wrapper
    expect(html).not.toContain('padding-top');     // no inline styling
    expect(html).toContain('"overlayMenu":"never"'); // mirror source: no JS menu
  });
});

describe('buildHeaderPart sticky state block (nativeBehaviors)', () => {
  const sticky = { kind: 'sticky' as const, toggleClass: 'is-scrolled', offset: 24 };

  it('plain + sticky appends the dla/sticky state block after the nav', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about'], { plain: true, sticky });
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
    expect(html).toContain('<!-- wp:dla/sticky {"toggleClass":"is-scrolled","offset":24} -->');
    expect(html).toContain('class="wp-block-dla-sticky"');
    expect(html).toContain('data-wp-interactive="dla/sticky"');
    expect(html).toContain(`data-wp-context='{"toggleClass":"is-scrolled","offset":24}'`);
    expect(html).toContain('data-wp-init="callbacks.init"');
    // LAYOUT-INERT: display:none removes the marker from the header's flex
    // layout — without it the empty div is a third space-between item and the
    // nav redistributes to center (walrus probe: source navX 1023 vs 639).
    expect(html).toContain('<div class="wp-block-dla-sticky" style="display:none"');
    // After the nav, not inside it.
    expect(html.indexOf('wp:dla/sticky')).toBeGreaterThan(html.indexOf('<!-- /wp:navigation -->'));
    expect(html).toMatch(/<!-- \/wp:dla\/sticky -->$/);
  });

  it('plain without sticky is byte-identical to the pre-sticky shape (regression)', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about'], { plain: true });
    expect(html).toBe(
      `<!-- wp:site-title {"level":0,"className":"brand"} /-->\n` +
        `<!-- wp:navigation {"overlayMenu":"never","layout":{"type":"flex"}} -->\n` +
        `<!-- wp:navigation-link {"label":"About","url":"/about/"} /-->\n` +
        `<!-- /wp:navigation -->`,
    );
  });

  it('non-plain mode ignores sticky (tokens path has no carry chrome)', () => {
    const html = buildHeaderPart('Acme Co', [], ['home', 'about'], { sticky });
    expect(html).not.toContain('dla/sticky');
    expect(blockMarkupRoundtrips(html).ok).toBe(true);
  });
});

describe('findChromeMounts (JS-rendered chrome)', () => {
  const PAGE = `<html><body><div class="page-wrap">
    <div id="siteHeader"></div>
    <main><section id="hero"><h1>Hi</h1></section></main>
    <div id="siteFooter"></div>
  </div></body></html>`;

  it('finds empty id-divs before and after main (through wrappers)', () => {
    const m = findChromeMounts(PAGE);
    expect(m.header).toEqual({ id: 'siteHeader', classes: [] });
    expect(m.footer).toEqual({ id: 'siteFooter', classes: [] });
  });

  it('ignores populated divs and divs inside main', () => {
    const html = `<html><body>
      <div id="topBanner"><p>Sale!</p></div>
      <main><div id="inMain"></div><p>x</p></main>
    </body></html>`;
    const m = findChromeMounts(html);
    expect(m.header).toBeUndefined();
    expect(m.footer).toBeUndefined();
  });

  it('returns empty when there is no main', () => {
    expect(findChromeMounts('<html><body><div id="a"></div></body></html>')).toEqual({});
  });
});

describe('mountPartMarkup', () => {
  it('emits an anchored empty group div the carried JS can render into', () => {
    const markup = mountPartMarkup({ id: 'siteHeader', classes: ['chrome'] });
    expect(markup).toContain('"anchor":"siteHeader"');
    expect(markup).toContain('"tagName":"div"');
    expect(markup).toContain('<div id="siteHeader" class="wp-block-group chrome"></div>');
    expect(markup).not.toContain('wp:html');
  });
});
