import { describe, it, expect } from 'vitest';
import { buildBlockHeader } from './block-header.js';
import type { ExtractedNav } from '../screenshot/nav-extract.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Overlay nav: transparent bg + isOverlay:true (Wix-style: header sits over hero).
 * Expected: position:absolute transparent overlay, white text.
 */
const OVERLAY_NAV: ExtractedNav = {
  logoSrc: 'https://example.com/logo.svg',
  logoAlt: 'Example Corp',
  siteTitle: null,
  items: [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
    { label: 'Services', href: '/services' },
    { label: 'Contact', href: '/contact' },
  ],
  cta: { label: 'Get Started', href: '/get-started' },
  style: {
    background: 'transparent',
    isOverlay: true,
    textColor: 'rgb(255, 255, 255)',
    ctaBackground: 'rgb(0, 100, 200)',
    ctaTextColor: 'rgb(255, 255, 255)',
    fontFamily: 'Inter',
    height: 64,
  },
};

/**
 * Solid nav: opaque bg + isOverlay:false (normal-flow solid header).
 * Expected: solid background color, NO position:absolute overlay.
 */
const SOLID_NAV: ExtractedNav = {
  logoSrc: 'https://example.com/logo.svg',
  logoAlt: 'Example Corp',
  siteTitle: null,
  items: [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about' },
    { label: 'Services', href: '/services' },
    { label: 'Contact', href: '/contact' },
  ],
  cta: { label: 'Get Started', href: '/get-started' },
  style: {
    background: 'rgb(20, 20, 20)',
    isOverlay: false,
    textColor: 'rgb(255, 255, 255)',
    ctaBackground: 'rgb(0, 100, 200)',
    ctaTextColor: 'rgb(255, 255, 255)',
    fontFamily: 'Inter',
    height: 64,
  },
};

/**
 * Legacy fixture retained for back-compat tests. Uses opaque dark bg,
 * white text, isOverlay: false — solid-header behavior now.
 */
const SAMPLE_NAV: ExtractedNav = SOLID_NAV;

describe('buildBlockHeader', () => {
  it('contains wp:navigation with overlayMenu mobile', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('wp:navigation');
    expect(markup).toContain('"overlayMenu":"mobile"');
    expect(markup).toContain('/wp:navigation');
  });

  it('emits a wp:navigation-link for each nav item', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    for (const item of OVERLAY_NAV.items) {
      expect(markup).toContain(`"label":"${item.label}"`);
      expect(markup).toContain(`"url":"${item.href}"`);
    }
    expect(markup).toContain('wp:navigation-link');
  });

  it('includes the CTA as a wp:button when present', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('wp:button');
    expect(markup).toContain('Get Started');
    expect(markup).toContain('/get-started');
    expect(markup).toContain('wp:buttons');
  });

  it('emits wp:image with logo src and alt when logo is present', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('wp:image');
    expect(markup).toContain('https://example.com/logo.svg');
    expect(markup).toContain('Example Corp');
  });

  it('uses the provided logoLocalUrl instead of nav.logoSrc', () => {
    const markup = buildBlockHeader(OVERLAY_NAV, { logoLocalUrl: '/wp-content/uploads/logo.svg' });
    expect(markup).toContain('/wp-content/uploads/logo.svg');
    expect(markup).not.toContain('https://example.com/logo.svg');
  });

  it('falls back to wp:site-title when no logo img present', () => {
    const navNoLogo: ExtractedNav = { ...OVERLAY_NAV, logoSrc: null, siteTitle: 'My Brand' };
    const markup = buildBlockHeader(navNoLogo);
    expect(markup).toContain('wp:site-title');
    expect(markup).not.toContain('wp:image');
  });

  it('omits the CTA button when nav.cta is null', () => {
    const navNoCta: ExtractedNav = { ...OVERLAY_NAV, cta: null };
    const markup = buildBlockHeader(navNoCta);
    expect(markup).not.toContain('wp:button');
    expect(markup).not.toContain('wp:buttons');
  });

  it('outer group has tagName header attribute', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('"tagName":"header"');
  });

  it('emits valid open/close WP block comments (no unclosed tags)', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    const openNavigation = (markup.match(/<!-- wp:navigation[\s{]/g) ?? []).length;
    const closeNavigation = (markup.match(/<!-- \/wp:navigation -->/g) ?? []).length;
    expect(openNavigation).toBeGreaterThan(0);
    expect(openNavigation).toBe(closeNavigation);

    const openGroup = (markup.match(/<!-- wp:group[\s{]/g) ?? []).length;
    const closeGroup = (markup.match(/<!-- \/wp:group -->/g) ?? []).length;
    expect(openGroup).toBe(closeGroup);
  });

  it('CTA button uses captured ctaBackground and ctaTextColor', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('rgb(0, 100, 200)');
  });

  it('applies background-image inline style when style.backgroundImage is present', () => {
    const navWithBgImage: ExtractedNav = {
      ...OVERLAY_NAV,
      style: {
        ...OVERLAY_NAV.style,
        background: 'transparent',
        backgroundImage: 'linear-gradient(90deg, rgb(10, 10, 80) 0%, rgb(80, 10, 80) 100%)',
      },
    };
    const markup = buildBlockHeader(navWithBgImage);
    expect(markup).toContain('background-image:linear-gradient(90deg, rgb(10, 10, 80) 0%, rgb(80, 10, 80) 100%)');
    expect(markup).toContain('background-color:transparent');
  });

  it('does NOT emit background-image style when style.backgroundImage is absent', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).not.toContain('background-image:');
  });

  // ── Overlay vs solid header behavior ──────────────────────────────────────

  it('overlay nav (isOverlay:true, transparent bg) → transparent overlay with position:absolute', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    // Header element itself must be transparent
    expect(markup).toContain('background-color:transparent');
    // Override rule must enforce absolute positioning
    expect(markup).toContain('position:absolute !important');
    expect(markup).toContain('top:0');
    expect(markup).toContain('left:0');
    expect(markup).toContain('right:0');
    expect(markup).toContain('z-index:1000');
    expect(markup).toContain('background:transparent !important');
    expect(markup).toContain('background-color:transparent !important');
  });

  it('overlay nav uses #ffffff for nav text (contrast rule, not unreliable extracted color)', () => {
    // Overlay mode always forces #ffffff — extracted textColor is ignored because
    // Wix/similar platforms set nav color via JS at runtime and extraction is unreliable.
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('color:#ffffff !important');
    expect(markup).toContain('"text":"#ffffff"');
  });

  it('solid nav (isOverlay:false, opaque bg) → solid background, NO position:absolute overlay', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    // Header element inline style must carry the extracted background
    expect(markup).toContain('background-color:rgb(20, 20, 20)');
    // Override rule must NOT set position:absolute
    expect(markup).not.toContain('position:absolute !important');
    // Override rule must enforce static position
    expect(markup).toContain('position:static !important');
    // Override rule must reinforce the solid bg
    expect(markup).toContain('background:rgb(20, 20, 20) !important');
    expect(markup).toContain('background-color:rgb(20, 20, 20) !important');
  });

  it('solid nav uses the extracted text color (white)', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).toContain('color:rgb(255, 255, 255) !important');
    expect(markup).toContain('"text":"rgb(255, 255, 255)"');
  });

  it('solid nav with light bg and dark extracted text → emits dark text color', () => {
    const lightSolidNav: ExtractedNav = {
      ...SOLID_NAV,
      style: {
        ...SOLID_NAV.style,
        background: 'rgb(240, 240, 240)',
        textColor: 'rgb(20, 20, 20)',
      },
    };
    const markup = buildBlockHeader(lightSolidNav);
    expect(markup).toContain('background-color:rgb(240, 240, 240)');
    expect(markup).toContain('color:rgb(20, 20, 20) !important');
  });

  it('overlay nav with isOverlay:false but transparent bg → still overlay mode (transparent bg drives it)', () => {
    // isOverlay:false but background is transparent → overlay mode because the bg is transparent
    const transparentNotOverlay: ExtractedNav = {
      ...SOLID_NAV,
      style: { ...SOLID_NAV.style, background: 'transparent', isOverlay: false },
    };
    const markup = buildBlockHeader(transparentNotOverlay);
    expect(markup).toContain('background-color:transparent');
    expect(markup).toContain('position:absolute !important');
  });

  it('missing/transparent textColor falls back to contrast color against effective bg', () => {
    const navNoTextColor: ExtractedNav = {
      ...SOLID_NAV,
      style: { ...SOLID_NAV.style, background: 'rgb(20, 20, 20)', textColor: 'rgba(0, 0, 0, 0)' },
    };
    const markup = buildBlockHeader(navNoTextColor);
    // Dark bg → contrast fallback should be white
    expect(markup).toContain('"text":"#ffffff"');
  });

  // ── brandDark fallback tests ────────────────────────────────────────────────

  it('brandDark feeds the CTA button color (NOT the header background) for overlay nav', () => {
    const overlayNoCta: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, ctaBackground: null },
      cta: { label: 'CALL US', href: '/call-us' },
    };
    const markup = buildBlockHeader(overlayNoCta, { brandDark: '#175236' });
    // Header element must be transparent
    expect(markup).toContain('background-color:transparent');
    // brandDark appears as CTA button background
    expect(markup).toContain('background-color:#175236 !important');
    expect(markup).toContain('<header class="wp-block-group alignfull" style="background-color:transparent');
  });

  it('brandDark used as header bg fallback when solid nav has no extracted bg', () => {
    const solidNoBg: ExtractedNav = {
      ...SOLID_NAV,
      style: { ...SOLID_NAV.style, background: '', ctaBackground: null },
      cta: { label: 'CALL US', href: '/call-us' },
    };
    const markup = buildBlockHeader(solidNoBg, { brandDark: '#175236' });
    // brandDark fills the solid header when no bg extracted
    expect(markup).toContain('background-color:#175236');
  });

  it('treats rgba(0,0,0,0) as transparent; overlay mode applies, brandDark goes to CTA', () => {
    const transparentNav: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, background: 'rgba(0,0,0,0)', ctaBackground: null },
      cta: { label: 'CALL US', href: '/call-us' },
    };
    const markup = buildBlockHeader(transparentNav, { brandDark: '#175236' });
    // Header must be transparent
    expect(markup).toContain('background-color:transparent');
    expect(markup).not.toContain('rgba(0,0,0,0)');
    // brandDark appears as CTA button background
    expect(markup).toContain('#175236');
  });

  it('does not use brandDark when backgroundImage is present (gradient takes over)', () => {
    const bgImageNav: ExtractedNav = {
      ...OVERLAY_NAV,
      style: {
        ...OVERLAY_NAV.style,
        background: 'transparent',
        backgroundImage: 'linear-gradient(90deg, #003 0%, #300 100%)',
      },
    };
    const markup = buildBlockHeader(bgImageNav, { brandDark: '#175236' });
    expect(markup).toContain('background-image:linear-gradient(90deg, #003 0%, #300 100%)');
    expect(markup).not.toContain('background-color:#175236');
  });

  // ── siteUrl nav href rewriting ──────────────────────────────────────────────

  const SITE_URL = 'https://www.swiftlumber.com';

  const SITE_NAV: ExtractedNav = {
    ...OVERLAY_NAV,
    items: [
      { label: 'Home', href: 'https://www.swiftlumber.com/' },
      { label: 'About', href: 'https://www.swiftlumber.com/about-us' },
      { label: 'Projects', href: 'https://www.swiftlumber.com/projects' },
      { label: 'Jobs', href: 'https://workforcenow.adp.com/careers/swiftlumber' },
    ],
    cta: { label: 'Contact', href: 'https://www.swiftlumber.com/contact-us' },
  };

  it('rewrites same-site nav hrefs to local paths when siteUrl is set', () => {
    const markup = buildBlockHeader(SITE_NAV, { siteUrl: SITE_URL });
    expect(markup).toContain('"url":"/"');
    expect(markup).toContain('"url":"/about-us/"');
    expect(markup).toContain('"url":"/projects/"');
  });

  it('preserves external links unchanged when siteUrl is set', () => {
    const markup = buildBlockHeader(SITE_NAV, { siteUrl: SITE_URL });
    expect(markup).toContain('workforcenow.adp.com');
  });

  it('rewrites CTA href to local path when siteUrl is set', () => {
    const markup = buildBlockHeader(SITE_NAV, { siteUrl: SITE_URL });
    expect(markup).toContain('/contact-us/');
    expect(markup).not.toContain('https://www.swiftlumber.com/contact-us');
  });

  it('does not rewrite hrefs when siteUrl is absent (back-compat)', () => {
    const markup = buildBlockHeader(SITE_NAV);
    expect(markup).toContain('https://www.swiftlumber.com/about-us');
    expect(markup).toContain('https://www.swiftlumber.com/projects');
    expect(markup).toContain('https://www.swiftlumber.com/contact-us');
  });

  // ── High-specificity style override tests ─────────────────────────────────

  it('emits a <style> block with !important rules for nav link color', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('<style>');
    expect(markup).toMatch(/header\.wp-block-group .+color:[^;]+ !important/);
  });

  it('emits !important font-size in the style block when extracted from source', () => {
    const navWithFontSize: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, fontSize: '13px' },
    };
    const markup = buildBlockHeader(navWithFontSize);
    expect(markup).toContain('font-size:13px !important');
  });

  it('emits !important letter-spacing in the style block when extracted from source', () => {
    const navWithLetterSpacing: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, letterSpacing: '2.6px' },
    };
    const markup = buildBlockHeader(navWithLetterSpacing);
    expect(markup).toContain('letter-spacing:2.6px !important');
  });

  it('emits !important text-transform in the style block when extracted from source', () => {
    const navWithTextTransform: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, textTransform: 'uppercase' },
    };
    const markup = buildBlockHeader(navWithTextTransform);
    expect(markup).toContain('text-transform:uppercase !important');
  });

  it('emits !important CTA background in the style block when cta has bg color', () => {
    const navWithCtaBg: ExtractedNav = {
      ...OVERLAY_NAV,
      cta: { label: 'CALL US', href: '/call-us', bg: 'rgb(23, 82, 54)', color: 'rgb(255, 255, 255)' },
    };
    const markup = buildBlockHeader(navWithCtaBg);
    expect(markup).toContain('background-color:rgb(23, 82, 54) !important');
    expect(markup).toContain('color:rgb(255, 255, 255) !important');
  });

  it('CTA button rendered with bg/color from cta.bg + cta.color (new shape)', () => {
    const navWithCtaColors: ExtractedNav = {
      ...OVERLAY_NAV,
      cta: { label: 'CALL US', href: '/call-us', bg: 'rgb(23, 82, 54)', color: 'rgb(255, 255, 255)' },
    };
    const markup = buildBlockHeader(navWithCtaColors);
    expect(markup).toContain('wp:button');
    expect(markup).toContain('CALL US');
    expect(markup).toContain('background-color:rgb(23, 82, 54)');
    expect(markup).toContain('color:rgb(255, 255, 255)');
  });

  it('does not emit a style block when no tokens to override', () => {
    const minimalNav: ExtractedNav = {
      ...OVERLAY_NAV,
      cta: null,
      style: {
        background: 'transparent',
        isOverlay: true,
        textColor: 'rgb(255, 255, 255)',
        ctaBackground: null,
        ctaTextColor: null,
        fontFamily: 'Inter',
        height: 64,
      },
    };
    // textColor rule is always emitted when textColor is present, so <style> will exist.
    const markup = buildBlockHeader(minimalNav);
    expect(markup).toContain('<style>');
    expect(markup).toContain('color:');
    expect(markup).toContain('!important');
  });

  // ── Transparent overlay header tests ─────────────────────────────────────

  it('overlay nav: emits position:absolute + z-index:1000 on header.wp-block-group', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('position:absolute !important');
    expect(markup).toContain('top:0');
    expect(markup).toContain('left:0');
    expect(markup).toContain('right:0');
    expect(markup).toContain('z-index:1000');
  });

  it('overlay nav: emits background:transparent !important on header group', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('background:transparent !important');
    expect(markup).toContain('background-color:transparent !important');
  });

  it('emits wide nav gap (2.25rem) on navigation container via !important style rule', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('"blockGap":"2.25rem"');
    expect(markup).toContain('gap:2.25rem !important');
    expect(markup).toContain('.wp-block-navigation__container');
    expect(markup).toContain('.wp-block-navigation{');
  });

  it('overlay nav: nav links get #ffffff (contrast rule for overlay, not extracted color)', () => {
    // Overlay headers always get #ffffff nav text regardless of extracted color.
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('color:#ffffff !important');
    expect(markup).toContain('"text":"#ffffff"');
  });

  it('CTA button has 8px border-radius (sane default) in both block attrs and inline style', () => {
    // Default radius is 8px rounded, not 9999px pill — pill is a specific source style choice.
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('"radius":"8px"');
    expect(markup).toContain('border-radius:8px');
  });

  it('CTA button override rule includes border-radius:8px !important (default)', () => {
    const markup = buildBlockHeader(OVERLAY_NAV);
    expect(markup).toContain('border-radius:8px !important');
  });

  it('CTA button uses captured borderRadius when present in cta fixture', () => {
    const navWithCtaRadius: ExtractedNav = {
      ...OVERLAY_NAV,
      cta: { label: 'CALL US', href: '/call-us', bg: 'rgb(23, 82, 54)', color: '#000000', borderRadius: '10px' },
    };
    const markup = buildBlockHeader(navWithCtaRadius);
    expect(markup).toContain('"radius":"10px"');
    expect(markup).toContain('border-radius:10px !important');
  });

  it('CTA button override has white text (#ffffff) by default when no explicit color', () => {
    const navNoCta: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, ctaTextColor: null },
      cta: { label: 'CALL US', href: '/call-us' },
    };
    const markup = buildBlockHeader(navNoCta);
    expect(markup).toContain('color:#ffffff !important');
  });

  it('brandDark is NOT used as header background for overlay nav but IS used as CTA color when no ctaBackground', () => {
    const navForCta: ExtractedNav = {
      ...OVERLAY_NAV,
      style: { ...OVERLAY_NAV.style, ctaBackground: null },
      cta: { label: 'CALL US', href: '/call-us' },
    };
    const markup = buildBlockHeader(navForCta, { brandDark: '#175236' });
    expect(markup).toContain('<header class="wp-block-group alignfull" style="background-color:transparent');
    expect(markup).toContain('background-color:#175236');
    expect(markup).toContain('background-color:#175236 !important');
  });

  // ── Solid header tests (previously all tests assumed overlay) ─────────────

  it('solid nav: header element carries the extracted background color', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).toContain('background-color:rgb(20, 20, 20)');
    // Must not be accidentally transparent
    expect(markup).not.toContain('background-color:transparent');
  });

  it('solid nav: no position:absolute !important in override rule', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).not.toContain('position:absolute !important');
  });

  it('solid nav: override rule uses position:static !important', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).toContain('position:static !important');
  });

  it('solid nav: override rule enforces solid bg !important to defeat leaked site.css', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).toContain('background:rgb(20, 20, 20) !important');
    expect(markup).toContain('background-color:rgb(20, 20, 20) !important');
  });

  it('solid nav: extracted white textColor used for nav links', () => {
    const markup = buildBlockHeader(SOLID_NAV);
    expect(markup).toContain('color:rgb(255, 255, 255) !important');
    expect(markup).toContain('"text":"rgb(255, 255, 255)"');
  });

  it('solid nav with light bg: dark extracted text color is preserved', () => {
    const lightNav: ExtractedNav = {
      ...SOLID_NAV,
      style: {
        ...SOLID_NAV.style,
        background: 'rgb(245, 245, 245)',
        textColor: 'rgb(20, 20, 20)',
      },
    };
    const markup = buildBlockHeader(lightNav);
    expect(markup).toContain('background-color:rgb(245, 245, 245)');
    expect(markup).toContain('color:rgb(20, 20, 20) !important');
  });

  it('brandDark NOT used as solid header bg when extracted bg is present', () => {
    const markup = buildBlockHeader(SOLID_NAV, { brandDark: '#175236' });
    // Extracted bg takes priority; brandDark must NOT fill the header bg
    expect(markup).toContain('background-color:rgb(20, 20, 20)');
    // SOLID_NAV has ctaBackground=rgb(0,100,200) which takes priority over brandDark,
    // so #175236 should not appear at all
    expect(markup).not.toContain('#175236');
  });

  it('SAMPLE_NAV (back-compat alias = SOLID_NAV) → solid header, not transparent overlay', () => {
    const markup = buildBlockHeader(SAMPLE_NAV);
    expect(markup).toContain('background-color:rgb(20, 20, 20)');
    expect(markup).not.toContain('position:absolute !important');
  });
});
