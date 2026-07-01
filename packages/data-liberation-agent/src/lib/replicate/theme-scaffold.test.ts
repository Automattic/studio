import { describe, it, expect } from 'vitest';
import { buildThemeScaffold, safeNavHref } from './theme-scaffold.js';

const FOUNDATION_FIXTURE = {
  version: 1,
  color: {
    surface: {
      base: { value: '#ffffff' },
      raised: { value: '#f6f6f6' },
      inverse: { value: '#2f394e' },
    },
    text: {
      default: { value: '#000000' },
      muted: { value: '#545a71' },
      subtle: { value: '#141414' },
      inverse: { value: '#ffffff' },
    },
    accent: {
      primary: { value: '#6cd7bd' },
      primaryAlt: { value: '#00b4b4' },
      warning: { value: null },
      warm: { value: '#fdfaf7' },
      highlight: { value: '#9ee4d3' },
    },
    border: {
      default: { value: '#e5e6ff' },
      subtle: { value: '#f0f0f0' },
    },
  },
  typography: {
    families: {
      body: { value: 'quasimoda, sans-serif' },
      display: { value: 'Larsseit, sans-serif' },
      mono: { value: 'monospace' },
    },
  },
  breakpoints: { md: '641px', lg: '901px' },
  radius: { sm: '4px', base: '8px', lg: '16px' },
  spacing: { sections: { padX: '40px', padY: '80px', contentMaxWidth: '1200px' } },
  components: {
    button: { background: 'color.accent.primary', text: 'color.text.inverse', radius: 'radius.lg', padding: '12px 24px', fontWeight: 500 },
  },
};

describe('buildThemeScaffold', () => {
  it('emits the canonical theme bundle (core files + header icon assets)', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const paths = files.map((f) => f.relativePath).sort();
    expect(paths).toEqual([
      'assets/gallery-scroller.js',
      'assets/icon-account.svg',
      'assets/icon-cart.svg',
      'assets/icon-search.svg',
      'functions.php',
      'parts/footer.html',
      'parts/header.html',
      'style.css',
      'templates/index.html',
      'templates/page.html',
      'templates/single.html',
      'theme.json',
    ]);
  });

  it('emits base single.html (post title + content) and a page.html fallback', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const single = files.find((f) => f.relativePath === 'templates/single.html');
    const page = files.find((f) => f.relativePath === 'templates/page.html');
    // Without single.html, imported posts fall through to index.html (no
    // post-title) and render titleless — the gap hit on the corneliusholmes run.
    expect(single, 'single.html must be emitted').toBeDefined();
    expect(page, 'page.html fallback must be emitted').toBeDefined();
    // single: post title + body inside the header/footer shell.
    expect(single!.content).toContain('wp:post-title');
    expect(single!.content).toContain('wp:post-content');
    expect(single!.content).toContain('"slug":"header"');
    expect(single!.content).toContain('"slug":"footer"');
    // Post-meta blocks: the template renders date/author/tags/nav so the chrome
    // that rawConvert strips out of post_content (POST_META_CHROME) isn't lost.
    expect(single!.content).toContain('wp:post-date');
    expect(single!.content).toContain('wp:post-author-name');
    expect(single!.content).toContain('wp:post-terms');
    expect(single!.content).toContain('wp:post-navigation-link');
    // page fallback: title + content.
    expect(page!.content).toContain('wp:post-title');
    expect(page!.content).toContain('wp:post-content');
  });

  it('style.css carries a valid theme header', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const styleCss = files.find((f) => f.relativePath === 'style.css')!.content;
    expect(styleCss).toContain('Theme Name: getsnooz-com-replica');
    expect(styleCss).toContain('Version:');
    expect(styleCss).toContain('Text Domain: getsnooz-com-replica');
  });

  it('style.css clamps imported content media to the container width (responsive guard)', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const styleCss = files.find((f) => f.relativePath === 'style.css')!.content;
    // Carried Shopify/Replo content has fixed-px media that overflows at 390px.
    expect(styleCss).toContain('.wp-block-post-content img');
    expect(styleCss).toContain('max-width: 100%');
  });

  it('theme.json is valid JSON with version 3 and the expected palette slugs', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const themeJsonRaw = files.find((f) => f.relativePath === 'theme.json')!.content;
    const themeJson = JSON.parse(themeJsonRaw);
    expect(themeJson.version).toBe(3);
    expect(themeJson.$schema).toContain('schemas.wp.org');
    const slugs = (themeJson.settings.color.palette as Array<{ slug: string }>).map((p) => p.slug).sort();
    expect(slugs).toContain('surface-base');
    expect(slugs).toContain('surface-inverse');
    expect(slugs).toContain('accent-primary');
    expect(slugs).toContain('accent-primary-alt');
    expect(slugs).toContain('accent-highlight');
    expect(slugs).toContain('text-inverse');
    expect(slugs).toContain('border-default');
  });

  it('omits null accent values from the palette', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const slugs = (themeJson.settings.color.palette as Array<{ slug: string }>).map((p) => p.slug);
    // accent-warning has value: null in the fixture → must NOT appear in output.
    expect(slugs).not.toContain('accent-warning');
  });

  it('styles links to inherit the surrounding text color (no browser-blue), accent on hover', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const link = themeJson.styles?.elements?.link;
    expect(link?.color?.text).toBe('currentColor');
    expect(link?.[':hover']?.color?.text).toBe('var(--wp--preset--color--accent-primary)');
  });

  it('emits both display and body fontFamilies when both are set', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const slugs = (themeJson.settings.typography.fontFamilies as Array<{ slug: string }>).map((f) => f.slug);
    expect(slugs).toContain('body');
    expect(slugs).toContain('display');
    // mono is "monospace" (CSS generic) → skipped.
    expect(slugs).not.toContain('mono');
  });

  it('omits display when the foundation lacks one (no hallucination)', () => {
    const noDisplay = JSON.parse(JSON.stringify(FOUNDATION_FIXTURE));
    noDisplay.typography.families.display = { value: null };
    const files = buildThemeScaffold({ foundation: noDisplay, themeSlug: 'site-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const slugs = (themeJson.settings.typography.fontFamilies as Array<{ slug: string }>).map((f) => f.slug);
    expect(slugs).toContain('body');
    expect(slugs).not.toContain('display');
  });

  it('falls back to system sans-serif when body family is missing', () => {
    const noBody = JSON.parse(JSON.stringify(FOUNDATION_FIXTURE));
    noBody.typography.families.body = { value: null };
    const files = buildThemeScaffold({ foundation: noBody, themeSlug: 'site-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const body = (themeJson.settings.typography.fontFamilies as Array<{ slug: string; fontFamily: string }>).find((f) => f.slug === 'body')!;
    expect(body.fontFamily).toMatch(/system-ui|sans-serif/);
  });

  it('layout.contentSize / wideSize map from breakpoints + sections.contentMaxWidth', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    expect(themeJson.settings.layout.contentSize).toBe('901px');
    expect(themeJson.settings.layout.wideSize).toBe('1200px'); // from spacing.sections.contentMaxWidth
  });

  it('button block override resolves radius via foundation token reference', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
    const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
    const button = themeJson.styles.blocks['core/button'];
    expect(button.color.background).toBe('var(--wp--preset--color--accent-primary)');
    expect(button.color.text).toBe('var(--wp--preset--color--text-inverse)');
    // radius.lg in the fixture is "16px"
    expect(button.border.radius).toBe('16px');
  });

  it('functions.php registers blocks via glob and gates on block.json existence', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const fnPhp = files.find((f) => f.relativePath === 'functions.php')!.content;
    expect(fnPhp).toContain('register_block_type');
    expect(fnPhp).toContain("glob(get_theme_file_path('blocks/*/build')");
    expect(fnPhp).toContain('after_setup_theme');
  });

  it('functions.php derives a VALID php function name from a digit-leading slug', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: '7-acme-theme' });
    const fnPhp = files.find((f) => f.relativePath === 'functions.php')!.content;
    // a leading digit is illegal in a PHP identifier — must be prefixed
    expect(fnPhp).not.toMatch(/function\s+\d/);
    expect(fnPhp).toContain('function _7_acme_theme_setup()');
    expect(fnPhp).toContain("add_action('after_setup_theme', '_7_acme_theme_setup')");
  });

  it('functions.php enqueues style.css on the front end (block themes do not auto-load it)', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'getsnooz-com-replica' });
    const fnPhp = files.find((f) => f.relativePath === 'functions.php')!.content;
    expect(fnPhp).toContain('wp_enqueue_scripts');
    expect(fnPhp).toContain('wp_enqueue_style');
    expect(fnPhp).toContain('get_stylesheet_uri()');
  });

  it('templates/index.html is a thin shell wrapping post-content with header+footer parts', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
    const idx = files.find((f) => f.relativePath === 'templates/index.html')!.content;
    expect(idx).toContain('wp:template-part {"slug":"header"');
    expect(idx).toContain('wp:template-part {"slug":"footer"');
    expect(idx).toContain('wp:post-content');
  });

  it('parts/header.html contains site-title (linked) + navigation with page-list', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
    const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
    expect(header).toContain('wp:site-title');
    expect(header).toContain('"isLink":true');
    expect(header).toContain('wp:navigation');
    expect(header).toContain('wp:page-list');
  });

  it('parts/header.html uses source chrome when provided', () => {
    const files = buildThemeScaffold({
      foundation: FOUNDATION_FIXTURE,
      themeSlug: 'site-replica',
      sourceChrome: {
        header: {
          logoUrl: 'http://localhost:8881/wp-content/uploads/2026/04/logo.png',
          logoAlt: 'Swift logo',
          links: [
            { label: 'HOME', href: '/', external: false },
            { label: 'PRODUCTS', href: '/about-us-1', external: false },
            { label: 'JOB OPPORTUNITIES', href: 'https://jobs.example.com', external: true },
          ],
        },
      },
    });
    const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
    expect(header).toContain('http://localhost:8881/wp-content/uploads/2026/04/logo.png');
    expect(header).toContain('"label":"PRODUCTS"');
    expect(header).toContain('"opensInNewTab":true');
    expect(header).not.toContain('wp:page-list');
  });

  it('parts/header.html defaults to a LIGHT header (white bg, dark text)', () => {
    const files = buildThemeScaffold({
      foundation: FOUNDATION_FIXTURE,
      themeSlug: 'site-replica',
      sourceChrome: { header: { logoUrl: 'http://x/logo.png', logoAlt: 'L', links: [{ label: 'Shop', href: '/shop', external: false }] } },
    });
    const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
    expect(header).toContain('"backgroundColor":"surface-base"');
    expect(header).toContain('"textColor":"text-default"');
    expect(header).not.toContain('"backgroundColor":"surface-inverse"');
  });

  it('parts/header.html honors a DARK header tone when the source header is dark', () => {
    const files = buildThemeScaffold({
      foundation: FOUNDATION_FIXTURE,
      themeSlug: 'site-replica',
      sourceChrome: { header: { logoUrl: 'http://x/logo.png', logoAlt: 'L', tone: 'dark', links: [{ label: 'Shop', href: '/shop', external: false }] } },
    });
    const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
    expect(header).toContain('"backgroundColor":"surface-inverse"');
    expect(header).toContain('"textColor":"text-inverse"');
  });

  it('parts/footer.html uses source footer text and links when provided', () => {
    const files = buildThemeScaffold({
      foundation: FOUNDATION_FIXTURE,
      themeSlug: 'site-replica',
      sourceChrome: {
        footer: {
          text: ['Swift Lumber', '1450 Swift Mill Rd, Atmore, AL', '251-446-4123'],
          links: [{ label: 'Privacy Policy', href: '/privacy-policy', external: false }],
        },
      },
    });
    const footer = files.find((f) => f.relativePath === 'parts/footer.html')!.content;
    expect(footer).toContain('Swift Lumber');
    expect(footer).toContain('1450 Swift Mill Rd, Atmore, AL');
    expect(footer).toContain('wp:navigation');
    expect(footer).toContain('"label":"Privacy Policy"');
    expect(footer).toContain('"url":"/privacy-policy"');
    expect(footer).not.toContain('wp:list');
  });

  it('parts/footer.html renders the footer logo, contact phone (tel), and linkified copyright credit', () => {
    // Fictional data only — never real source-site phones/names/titles.
    const files = buildThemeScaffold({
      foundation: FOUNDATION_FIXTURE,
      themeSlug: 'site-replica',
      sourceChrome: {
        footer: {
          logoUrl: 'https://cdn.example.com/footer-logo.png',
          logoAlt: 'Site logo',
          text: ['CALL US', 'SEND US A MESSAGE', '© 2026 Website by Acme Studio'],
          links: [
            { label: 'HOME', href: '/', external: false },
            { label: 'CAREERS', href: 'https://jobs.example.com/x', external: true },
            { label: '555-0142', href: 'tel:+15550142', external: false },
            { label: 'Acme Studio', href: 'https://acme.example', external: true },
          ],
        },
      },
    });
    const footer = files.find((f) => f.relativePath === 'parts/footer.html')!.content;
    // Logo present (CDN url, since no local logo passed here).
    expect(footer).toContain('footer-logo.png');
    // Phone kept as a tel: link (was previously dropped).
    expect(footer).toContain('href="tel:+15550142"');
    // Contact labels verbatim.
    expect(footer).toContain('>CALL US</p>');
    // External nav destination stays in the nav (not mistaken for the credit).
    expect(footer).toContain('"label":"CAREERS"');
    // Credit linkified IN the copyright line (no duplicate label).
    expect(footer).toContain('© 2026 Website by <a href="https://acme.example">Acme Studio</a>');
    expect((footer.match(/Acme Studio/g) || []).length).toBe(1);
  });

  it('parts/footer.html escapes site title HTML when rendering copyright', () => {
    const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', siteTitle: 'A & B <Co>' });
    const footer = files.find((f) => f.relativePath === 'parts/footer.html')!.content;
    expect(footer).toContain('A &amp; B &lt;Co&gt;');
    expect(footer).not.toContain('<Co>');
  });

  describe('self-hosted fonts (capturedFonts)', () => {
    const LARSSEIT = [
      { family: 'Larsseit', src: 'x', format: 'woff', weight: '400', style: 'normal', localPath: 'assets/fonts/Larsseit-Regular.woff' },
      { family: 'Larsseit', src: 'y', format: 'woff', weight: '700', style: 'normal', localPath: 'assets/fonts/Larsseit-Bold.woff' },
    ];

    it('appends @font-face rules with local asset paths to style.css', () => {
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', capturedFonts: LARSSEIT });
      const css = files.find((f) => f.relativePath === 'style.css')!.content;
      expect(css).toContain('@font-face');
      expect(css).toContain("font-family: 'Larsseit'");
      expect(css).toContain("url('assets/fonts/Larsseit-Regular.woff')");
      expect(css).toContain("url('assets/fonts/Larsseit-Bold.woff')");
    });

    it('rebinds the display family to the captured family with a fontFace[]', () => {
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', capturedFonts: LARSSEIT });
      const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
      const display = themeJson.settings.typography.fontFamilies.find((e: { slug: string }) => e.slug === 'display');
      expect(display.fontFamily).toBe('Larsseit, sans-serif');
      expect(display.fontFace).toHaveLength(2);
      expect(display.fontFace[0].src[0]).toContain('assets/fonts/Larsseit-Regular.woff');
    });

    it('binds headings to the display family and sanitizes a bogus 0px line-height', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        capturedFonts: LARSSEIT,
        headingLineHeights: { h1: '0px', h2: '1.3' },
      });
      const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
      const h1 = themeJson.styles.elements.h1.typography;
      expect(h1.fontFamily).toBe('var(--wp--preset--font-family--display)');
      expect(h1.lineHeight).toBe('1.2'); // 0px sanitized
      expect(themeJson.styles.elements.h2.typography.lineHeight).toBe('1.3'); // valid kept
    });

    it('rebinds a SUBSTITUTED display family back to the captured heading font', () => {
      // Foundation substituted Poppins for the headings; typography.json observed
      // the real heading family as Larsseit, which we captured + self-host.
      const substituted = {
        ...FOUNDATION_FIXTURE,
        typography: { families: { body: { value: 'quasimoda, sans-serif' }, display: { value: 'Poppins, sans-serif' } } },
      };
      const files = buildThemeScaffold({
        foundation: substituted,
        themeSlug: 'site-replica',
        capturedFonts: LARSSEIT,
        headingFamily: 'Larsseit, sans-serif',
        bodyFamily: 'quasimoda, sans-serif',
      });
      const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
      const display = themeJson.settings.typography.fontFamilies.find((e: { slug: string }) => e.slug === 'display');
      expect(display.fontFamily).toBe('Larsseit, sans-serif');
      expect(display.fontFace).toHaveLength(2);
      // Body stays quasimoda (not captured / self-hostable).
      const body = themeJson.settings.typography.fontFamilies.find((e: { slug: string }) => e.slug === 'body');
      expect(body.fontFamily).toBe('quasimoda, sans-serif');
    });

    it('consolidates per-weight Larsseit aliases into one display family', () => {
      const aliased = [
        { family: 'Larsseit', src: 'a', format: 'woff', weight: '400', style: 'normal', localPath: 'assets/fonts/Larsseit-Regular.woff' },
        { family: 'Larsseit Bold', src: 'b', format: 'woff', weight: '700', style: 'normal', localPath: 'assets/fonts/Larsseit-Bold.woff' },
        { family: 'Larsseit-Bold', src: 'c', format: 'woff', weight: '700', style: 'normal', localPath: 'assets/fonts/Larsseit-Bold-dup.woff' },
      ];
      const files = buildThemeScaffold({
        foundation: { ...FOUNDATION_FIXTURE, typography: { families: { body: { value: 'quasimoda, sans-serif' }, display: { value: 'Poppins, sans-serif' } } } },
        themeSlug: 'site-replica',
        capturedFonts: aliased,
        headingFamily: 'Larsseit, sans-serif',
      });
      const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
      const fams = themeJson.settings.typography.fontFamilies.map((e: { slug: string }) => e.slug);
      // No separate larsseit-bold / larsseit-regular families.
      expect(fams).not.toContain('larsseit-bold');
      expect(fams).not.toContain('larsseit-regular');
      const display = themeJson.settings.typography.fontFamilies.find((e: { slug: string }) => e.slug === 'display');
      expect(display.fontFamily).toBe('Larsseit, sans-serif');
      expect(display.fontFace).toHaveLength(2); // 400 + 700, dedup of the 700 alias
    });

    it('emits no @font-face and no heading element styles when no fonts captured', () => {
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica' });
      const css = files.find((f) => f.relativePath === 'style.css')!.content;
      // The display family still exists (from foundation), so heading elements bind,
      // but no @font-face rules are emitted without captured fonts.
      expect(css).not.toContain('@font-face');
    });

    it('binds the BODY family to a self-hosted free substitute (quasimoda → Hanken Grotesk)', () => {
      // The handler downloads Hanken Grotesk (the free substitute for the
      // unhostable Typekit body font) into capturedFonts and passes
      // bodySubstituteFamily; the scaffold must rebind body to it instead of the
      // bare `quasimoda, sans-serif` fallback.
      const captured = [
        ...LARSSEIT,
        { family: 'Hanken Grotesk', src: 'hk', format: 'woff2', weight: '400 700', style: 'normal', localPath: 'assets/fonts/HankenGrotesk-400-700.woff2' },
      ];
      const files = buildThemeScaffold({
        foundation: { ...FOUNDATION_FIXTURE, typography: { families: { body: { value: 'quasimoda, sans-serif' }, display: { value: 'Poppins, sans-serif' } } } },
        themeSlug: 'site-replica',
        capturedFonts: captured,
        headingFamily: 'Larsseit, sans-serif',
        bodyFamily: 'quasimoda, sans-serif',
        bodySubstituteFamily: 'Hanken Grotesk',
      });
      const themeJson = JSON.parse(files.find((f) => f.relativePath === 'theme.json')!.content);
      const body = themeJson.settings.typography.fontFamilies.find((e: { slug: string }) => e.slug === 'body');
      expect(body.fontFamily).toBe('Hanken Grotesk, sans-serif');
      expect(body.fontFace.length).toBeGreaterThanOrEqual(1);
      expect(body.fontFace[0].src[0]).toContain('assets/fonts/HankenGrotesk');
      // styles.typography.fontFamily resolves to the body preset (the substitute).
      expect(themeJson.styles.typography.fontFamily).toBe('var(--wp--preset--font-family--body)');
      // No bare `quasimoda` left as the body family.
      expect(body.fontFamily).not.toContain('quasimoda');
    });
  });

  describe('header utility icons', () => {
    const CHROME = { header: { logoUrl: 'http://x/logo.png', logoAlt: 'L', links: [{ label: 'Shop', href: '/shop', external: false }] } };

    it('renders ONLY the utility icons the source header actually has (core/image, no wp:html)', () => {
      // A storefront with cart + search (but no account affordance) → cart + search only.
      const chrome = { header: { ...CHROME.header, utilities: { search: true, cart: true } } };
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', sourceChrome: chrome });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).toContain('clone-header-icons');
      expect(header).toContain('href="/cart"');
      expect(header).toContain('href="/?s="');
      expect(header).not.toContain('href="/account"'); // not detected → not emitted
      // referenced as core/image SVG assets, NOT inline wp:html (banned)
      expect(header).toContain('/wp-content/themes/site-replica/assets/icon-cart.svg');
      expect(header).not.toContain('wp:html');
    });

    it('omits the icon cluster entirely when the source header has no utility affordances', () => {
      // swiftlumber's case — no cart/account/search, so no invented storefront icons.
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', sourceChrome: CHROME });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).not.toContain('clone-header-icons');
    });

    it('renders the source header CTA as a button (captured separately from the nav)', () => {
      const chrome = { header: { ...CHROME.header, cta: { label: 'CALL US', href: '', external: false } } };
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', sourceChrome: chrome });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).toContain('wp:button');
      expect(header).toContain('>CALL US</a>');
    });

    it('ships the icon SVGs as theme assets', () => {
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: 'site-replica', sourceChrome: CHROME });
      const cart = files.find((f) => f.relativePath === 'assets/icon-cart.svg');
      expect(cart).toBeDefined();
      expect(cart!.content).toContain('<svg');
      expect(cart!.content).toContain('stroke="#2f394e"');
      expect(files.find((f) => f.relativePath === 'assets/icon-search.svg')).toBeDefined();
      expect(files.find((f) => f.relativePath === 'assets/icon-account.svg')).toBeDefined();
    });
  });

  describe('localized header logo', () => {
    it('references a theme-asset logo path when localLogoPath is set (not the CDN url)', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: { header: { logoUrl: 'https://cdn.example.com/SNOOZ-Logo.png', logoAlt: 'SNOOZ', links: [{ label: 'Shop', href: '/shop', external: false }] } },
        localLogoPath: 'assets/SNOOZ-Logo.png',
      });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).toContain('/wp-content/themes/site-replica/assets/SNOOZ-Logo.png');
      expect(header).not.toContain('cdn.example.com');
    });

    it('falls back to the captured CDN logo url when no local logo was downloaded', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: { header: { logoUrl: 'https://cdn.example.com/SNOOZ-Logo.png', logoAlt: 'SNOOZ', links: [{ label: 'Shop', href: '/shop', external: false }] } },
      });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).toContain('cdn.example.com/SNOOZ-Logo.png');
    });
  });

  describe('nav href remapping (source path → local permalink)', () => {
    const GETSNOOZ_CHROME = {
      header: {
        logoUrl: 'https://cdn/SNOOZ.png',
        logoAlt: 'SNOOZ',
        links: [
          { label: 'Shop', href: '/pages/shop-all', external: false },
          { label: 'Bundle & Save', href: '/pages/sleep-bundle', external: false },
          { label: 'About', href: '/pages/about-us', external: false },
          { label: 'Support', href: 'https://snooz.zendesk.com/hc/en-us', external: true },
        ],
      },
    };
    const REDIRECT_MAP = {
      '/pages/shop-all': '/shop-all/',
      '/pages/sleep-bundle': '/sleep-bundle/',
      '/pages/about-us': '/about-us/',
    };

    function header(opts: Partial<Parameters<typeof buildThemeScaffold>[0]> = {}) {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'getsnooz-com-replica',
        sourceChrome: GETSNOOZ_CHROME,
        ...opts,
      });
      return files.find((f) => f.relativePath === 'parts/header.html')!.content;
    }

    it('rewrites same-site nav hrefs to their local permalinks', () => {
      const h = header({ navHrefMap: REDIRECT_MAP });
      expect(h).toContain('"url":"/shop-all/"');
      expect(h).toContain('"url":"/sleep-bundle/"');
      expect(h).toContain('"url":"/about-us/"');
      // The raw source paths must be gone.
      expect(h).not.toContain('/pages/shop-all');
      expect(h).not.toContain('/pages/about-us');
    });

    it('leaves external nav links unchanged', () => {
      const h = header({ navHrefMap: REDIRECT_MAP });
      expect(h).toContain('snooz.zendesk.com/hc/en-us');
    });

    it('drops a same-site nav link whose target page was not imported (no dead 404)', () => {
      const partialMap = { '/pages/shop-all': '/shop-all/' };
      const h = header({ navHrefMap: partialMap });
      expect(h).toContain('"url":"/shop-all/"');
      // about-us / sleep-bundle weren't imported → dropped, not emitted as /pages/* 404s.
      expect(h).not.toContain('/pages/about-us');
      expect(h).not.toContain('/pages/sleep-bundle');
      expect(h).not.toContain('"label":"About"');
    });

    it('keeps unmapped same-site links when onUnmappedNavLink="keep"', () => {
      const partialMap = { '/pages/shop-all': '/shop-all/' };
      const h = header({ navHrefMap: partialMap, onUnmappedNavLink: 'keep' });
      expect(h).toContain('/pages/about-us');
    });

    it('passes hrefs through unchanged when no map is supplied (back-compat)', () => {
      const h = header();
      expect(h).toContain('/pages/shop-all');
      expect(h).toContain('/pages/about-us');
    });

    it('recognizes an already-local href (matches a redirect target) and keeps it', () => {
      const chrome = {
        header: {
          links: [{ label: 'Shop', href: '/shop-all/', external: false }],
        },
      };
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'getsnooz-com-replica',
        sourceChrome: chrome,
        navHrefMap: REDIRECT_MAP,
      });
      const h = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(h).toContain('"url":"/shop-all/"');
    });

    it('also remaps footer links', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'getsnooz-com-replica',
        sourceChrome: {
          footer: {
            text: ['SNOOZ'],
            links: [
              { label: 'About', href: '/pages/about-us', external: false },
              { label: 'Privacy', href: 'https://external.com/privacy', external: true },
            ],
          },
        },
        navHrefMap: REDIRECT_MAP,
      });
      const footer = files.find((f) => f.relativePath === 'parts/footer.html')!.content;
      expect(footer).toContain('"url":"/about-us/"');
      expect(footer).toContain('external.com/privacy');
      expect(footer).not.toContain('/pages/about-us');
    });
  });

  describe('nav label/href XSS hardening', () => {
    it('escapes a source nav label containing --><script> (no raw <script> in markup)', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: {
          header: {
            logoUrl: 'http://x/logo.png',
            logoAlt: 'L',
            links: [{ label: 'Shop --><script>alert(1)</script>', href: '/shop', external: false }],
          },
        },
      });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      // The raw <script> must not survive; the label is HTML-escaped.
      expect(header).not.toContain('<script>');
      expect(header).toContain('&lt;script&gt;');
    });

    it('drops a javascript: nav href to an inert anchor', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: {
          header: {
            logoUrl: 'http://x/logo.png',
            logoAlt: 'L',
            // eslint-disable-next-line no-script-url
            links: [{ label: 'Evil', href: 'javascript:alert(document.cookie)', external: true }],
          },
        },
      });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).not.toContain('javascript:');
      expect(header).toContain('"url":"#"');
    });

    it('round-trips a normal label + href unchanged', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: {
          header: {
            logoUrl: 'http://x/logo.png',
            logoAlt: 'L',
            links: [{ label: 'Products', href: '/shop-all', external: false }],
          },
        },
      });
      const header = files.find((f) => f.relativePath === 'parts/header.html')!.content;
      expect(header).toContain('"label":"Products"');
      expect(header).toContain('"url":"/shop-all"');
    });

    it('safeNavHref allows http/https/relative/mailto/tel and drops javascript/data/vbscript', () => {
      expect(safeNavHref('/about')).toBe('/about');
      expect(safeNavHref('https://example.com/x')).toBe('https://example.com/x');
      expect(safeNavHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
      expect(safeNavHref('tel:+15551234567')).toBe('tel:+15551234567');
      expect(safeNavHref('#section')).toBe('#section');
      // eslint-disable-next-line no-script-url
      expect(safeNavHref('javascript:alert(1)')).toBe('#');
      expect(safeNavHref('data:text/html,<script>1</script>')).toBe('#');
      expect(safeNavHref('vbscript:msgbox(1)')).toBe('#');
    });
  });

  describe('dropped-nav observability (stats out-param)', () => {
    it('reports the count of unmapped same-site nav links dropped during remap', () => {
      const stats: { droppedNavLinks?: number } = {};
      buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: {
          header: {
            logoUrl: 'http://x/logo.png',
            logoAlt: 'L',
            links: [
              { label: 'About', href: '/pages/about-us', external: false }, // mapped
              { label: 'Ghost', href: '/pages/never-imported', external: false }, // unmapped → dropped
              { label: 'Ext', href: 'https://other.com/x', external: true }, // external → kept
            ],
          },
        },
        navHrefMap: { '/pages/about-us': '/about-us/' },
        stats,
      });
      expect(stats.droppedNavLinks).toBe(1);
    });

    it('reports 0 dropped when every same-site link maps', () => {
      const stats: { droppedNavLinks?: number } = {};
      buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: 'site-replica',
        sourceChrome: {
          header: {
            logoUrl: 'http://x/logo.png',
            logoAlt: 'L',
            links: [{ label: 'About', href: '/pages/about-us', external: false }],
          },
        },
        navHrefMap: { '/pages/about-us': '/about-us/' },
        stats,
      });
      expect(stats.droppedNavLinks).toBe(0);
    });
  });

  describe('per-page reconstructed templates (reconstructedPages)', () => {
    const SLUG = 'getsnooz-com-replica';

    it('emits no per-page templates when reconstructedPages is absent (carried-HTML default)', () => {
      const files = buildThemeScaffold({ foundation: FOUNDATION_FIXTURE, themeSlug: SLUG });
      const pagePaths = files.map((f) => f.relativePath).filter((p) => /^templates\/page-/.test(p));
      expect(pagePaths).toEqual([]);
      // No front-page.html either — root stays on index.html / WP default.
      expect(files.some((f) => f.relativePath === 'templates/front-page.html')).toBe(false);
    });

    it('emits templates/page-<slug>.html wiring each page to its reconstructed pattern (not post-content)', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: SLUG,
        reconstructedPages: [
          { slug: 'about-us', patternSlug: `${SLUG}/page-about-us` },
          { slug: 'sleep-bundle', patternSlug: `${SLUG}/page-sleep-bundle` },
        ],
      });
      const about = files.find((f) => f.relativePath === 'templates/page-about-us.html');
      const bundle = files.find((f) => f.relativePath === 'templates/page-sleep-bundle.html');
      expect(about).toBeDefined();
      expect(bundle).toBeDefined();
      // Renders the page's reconstructed PATTERN, not raw post-content.
      expect(about!.content).toContain(`<!-- wp:pattern {"slug":"${SLUG}/page-about-us"} /-->`);
      expect(about!.content).not.toContain('wp:post-content');
      // Shares the sitewide header/footer parts.
      expect(about!.content).toContain('<!-- wp:template-part {"slug":"header","tagName":"header"} /-->');
      expect(about!.content).toContain('<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->');
    });

    it('emits front-page.html for the homepage entry (isHome) in addition to its page template', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: SLUG,
        reconstructedPages: [
          { slug: 'homepage', patternSlug: `${SLUG}/homepage`, isHome: true },
        ],
      });
      const front = files.find((f) => f.relativePath === 'templates/front-page.html');
      const page = files.find((f) => f.relativePath === 'templates/page-homepage.html');
      expect(front).toBeDefined();
      expect(page).toBeDefined();
      expect(front!.content).toContain(`<!-- wp:pattern {"slug":"${SLUG}/homepage"} /-->`);
      // Both point at the same reconstructed pattern.
      expect(front!.content).toBe(page!.content);
    });

    it('skips entries with a malformed slug or pattern slug (never writes an unsafe file path / attr)', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: SLUG,
        reconstructedPages: [
          { slug: '../etc/passwd', patternSlug: `${SLUG}/evil` }, // bad slug
          { slug: 'ok-page', patternSlug: 'no-namespace' }, // bad pattern slug (missing /)
          { slug: 'good', patternSlug: `${SLUG}/page-good` }, // valid → emitted
        ],
      });
      const pagePaths = files.map((f) => f.relativePath).filter((p) => /^templates\/page-/.test(p));
      expect(pagePaths).toEqual(['templates/page-good.html']);
    });

    it('de-dupes repeated slugs (first wins)', () => {
      const files = buildThemeScaffold({
        foundation: FOUNDATION_FIXTURE,
        themeSlug: SLUG,
        reconstructedPages: [
          { slug: 'about', patternSlug: `${SLUG}/page-about` },
          { slug: 'about', patternSlug: `${SLUG}/page-about-dup` },
        ],
      });
      const aboutTemplates = files.filter((f) => f.relativePath === 'templates/page-about.html');
      expect(aboutTemplates).toHaveLength(1);
      expect(aboutTemplates[0].content).toContain(`${SLUG}/page-about"`);
    });
  });
});
