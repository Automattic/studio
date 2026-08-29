import { describe, it, expect } from 'vitest';
import { resolvePageTitle } from '../src/lib/html-extract/index.js';

// Real-world shape from www.360chiro.co.uk: the owner set one custom SEO
// title on every page, so document.title carries no page-specific name.
const SITE_TITLE = 'Chiropractor Sheffield - Expert Care for Pain Relief';
const NAV = [
  { text: 'Home', href: 'https://www.360chiro.co.uk' },
  { text: 'First Visit', href: 'https://www.360chiro.co.uk/new-patients' },
  { text: 'Treatments', href: 'https://www.360chiro.co.uk/treatments' },
  { text: 'Fees', href: 'https://www.360chiro.co.uk/fees' },
];

describe('resolvePageTitle', () => {
  it('strips a trailing " | Site Name" suffix', () => {
    expect(resolvePageTitle('About | MySite Copy', 'about', {})).toBe('About');
  });

  it('keeps a page-specific title unchanged', () => {
    expect(
      resolvePageTitle('Our Prices', 'fees', { siteTitle: SITE_TITLE })
    ).toBe('Our Prices');
  });

  it('uses the navigation label when the title is just the site-wide title', () => {
    expect(
      resolvePageTitle(SITE_TITLE, 'treatments', {
        siteTitle: SITE_TITLE,
        navigation: NAV,
        url: 'https://www.360chiro.co.uk/treatments',
      })
    ).toBe('Treatments');
  });

  it('matches navigation hrefs regardless of trailing slash', () => {
    expect(
      resolvePageTitle(SITE_TITLE, 'new-patients', {
        siteTitle: SITE_TITLE,
        navigation: NAV,
        url: 'https://www.360chiro.co.uk/new-patients/',
      })
    ).toBe('First Visit');
  });

  it('falls back to the humanized slug when no navigation entry matches', () => {
    expect(
      resolvePageTitle(SITE_TITLE, 'neck-pain-stiffness', {
        siteTitle: SITE_TITLE,
        navigation: NAV,
        url: 'https://www.360chiro.co.uk/neck-pain-stiffness',
      })
    ).toBe('Neck Pain Stiffness');
  });

  it('keeps the site title on the homepage when nothing better exists', () => {
    expect(
      resolvePageTitle(SITE_TITLE, '', { siteTitle: SITE_TITLE })
    ).toBe(SITE_TITLE);
  });

  it('names the homepage from the navigation when it links to the site root', () => {
    expect(
      resolvePageTitle(SITE_TITLE, '', {
        siteTitle: SITE_TITLE,
        navigation: NAV,
        url: 'https://www.360chiro.co.uk/',
      })
    ).toBe('Home');
  });

  it('humanizes the slug when the page has no title at all', () => {
    expect(resolvePageTitle('', 'contact-us', {})).toBe('Contact Us');
  });
});
