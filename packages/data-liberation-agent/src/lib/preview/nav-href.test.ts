import { describe, it, expect } from 'vitest';
import { resolveNavHref } from './nav-href.js';

const SITE = 'https://www.swiftlumber.com';

describe('resolveNavHref', () => {
  // ── Home page ───────────────────────────────────────────────────────────────

  it('maps the site root to "/"', () => {
    expect(resolveNavHref('https://www.swiftlumber.com', SITE)).toBe('/');
  });

  it('maps the site root with trailing slash to "/"', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/', SITE)).toBe('/');
  });

  // ── Same-site pages ─────────────────────────────────────────────────────────

  it('maps /about-us to /about-us/', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/about-us', SITE)).toBe('/about-us/');
  });

  it('maps /about-us-1 to /about-us-1/', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/about-us-1', SITE)).toBe('/about-us-1/');
  });

  it('maps /projects to /projects/', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/projects', SITE)).toBe('/projects/');
  });

  it('maps a path with trailing slash correctly', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/about-us/', SITE)).toBe('/about-us/');
  });

  it('maps a nested path to its last segment (source-faithful slug)', () => {
    // The imported page's WP post_name is the LAST path segment
    // (pageSlugFromUrl), so a Shopify /pages/about-us nav link resolves to
    // /about-us/, not the `--`-joined /pages--about-us/.
    expect(resolveNavHref('https://www.swiftlumber.com/pages/about-us', SITE)).toBe('/about-us/');
    expect(resolveNavHref('https://www.swiftlumber.com/products/lumber', SITE)).toBe('/lumber/');
  });

  it('drops query string for local path (slugify uses only pathname)', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/contact?ref=nav', SITE)).toBe('/contact/');
  });

  it('drops hash for local path', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/about#team', SITE)).toBe('/about/');
  });

  // ── www vs apex treated as same site ────────────────────────────────────────

  it('treats www. subdomain and apex as same site (apex href → local)', () => {
    expect(resolveNavHref('https://swiftlumber.com/about-us', SITE)).toBe('/about-us/');
  });

  it('treats www. subdomain and apex as same site (www href, apex siteUrl)', () => {
    expect(resolveNavHref('https://www.swiftlumber.com/about-us', 'https://swiftlumber.com')).toBe('/about-us/');
  });

  it('treats cdn subdomain as same site (same registrable domain)', () => {
    expect(resolveNavHref('https://cdn.swiftlumber.com/about-us', SITE)).toBe('/about-us/');
  });

  // ── External links ──────────────────────────────────────────────────────────

  it('leaves external domain links unchanged', () => {
    const ext = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=123';
    expect(resolveNavHref(ext, SITE)).toBe(ext);
  });

  it('leaves other external domain unchanged', () => {
    expect(resolveNavHref('https://linkedin.com/company/swiftlumber', SITE)).toBe('https://linkedin.com/company/swiftlumber');
  });

  // ── Non-URL hrefs: returned unchanged ───────────────────────────────────────

  it('leaves pure anchor "#" unchanged', () => {
    expect(resolveNavHref('#', SITE)).toBe('#');
  });

  it('leaves "#section" anchor unchanged', () => {
    expect(resolveNavHref('#section', SITE)).toBe('#section');
  });

  it('leaves mailto: unchanged', () => {
    expect(resolveNavHref('mailto:info@swiftlumber.com', SITE)).toBe('mailto:info@swiftlumber.com');
  });

  it('leaves tel: unchanged', () => {
    expect(resolveNavHref('tel:+15551234567', SITE)).toBe('tel:+15551234567');
  });

  it('leaves relative path unchanged', () => {
    expect(resolveNavHref('/about-us', SITE)).toBe('/about-us');
  });

  it('leaves relative path without leading slash unchanged', () => {
    expect(resolveNavHref('about-us', SITE)).toBe('about-us');
  });

  it('leaves javascript: unchanged', () => {
    expect(resolveNavHref('javascript:void(0)', SITE)).toBe('javascript:void(0)');
  });
});
