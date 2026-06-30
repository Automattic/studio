import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { squarespaceAdapter } from '../../src/adapters/squarespace/index.js';
import { WxrBuilder } from '../../src/lib/wxr/index.js';

describe('squarespaceAdapter', () => {
  it('has id "squarespace"', () => {
    expect(squarespaceAdapter.id).toBe('squarespace');
  });

  it('detects squarespace.com URLs', () => {
    expect(squarespaceAdapter.detect('https://mysite.squarespace.com')).toBe(true);
    expect(squarespaceAdapter.detect('https://www.squarespace.com/mysite')).toBe(true);
  });

  it('does not detect non-Squarespace URLs', () => {
    expect(squarespaceAdapter.detect('https://www.example.com')).toBe(false);
    expect(squarespaceAdapter.detect('https://mysite.wixsite.com/blog')).toBe(false);
  });

  it('has discover method', () => {
    expect(typeof squarespaceAdapter.discover).toBe('function');
  });

  it('has extract method', () => {
    expect(typeof squarespaceAdapter.extract).toBe('function');
  });
});

describe('Squarespace adapter WXR integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sqs-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds valid WXR from fixture page data', () => {
    const fixture = JSON.parse(readFileSync('test/fixtures/squarespace-page.json', 'utf8'));

    const wxr = new WxrBuilder({
      title: fixture.website.siteTitle,
      url: 'https://mountaincoffee.squarespace.com',
      description: fixture.website.siteTagLine,
      language: fixture.website.language,
    });

    // Add the blog post from fixture item data
    const item = fixture.item;
    wxr.addPost({
      title: item.title,
      slug: item.urlId,
      content: item.body,
      excerpt: item.excerpt,
      date: new Date(item.publishOn).toISOString(),
      seoTitle: item.seoData.seoTitle,
      seoDescription: item.seoData.seoDescription,
      categories: item.categories,
      tags: item.tags,
    });

    // Register categories and tags so validation is clean
    for (const cat of item.categories) {
      wxr.addCategory({ slug: cat, name: cat });
    }
    for (const tag of item.tags) {
      wxr.addTag({ slug: tag, name: tag });
    }

    // Add a page from the collection mainContent pattern
    wxr.addPage({
      title: 'About',
      slug: 'about',
      content: '<p>Mountain Coffee Roasters was founded in 2018 in the highlands of Colombia.</p>',
      excerpt: 'Our story',
      seoTitle: 'About | Mountain Coffee Roasters',
      seoDescription: 'Learn about our story and mission.',
    });

    // Add media from the fixture
    wxr.addMedia({
      url: item.assetUrl,
      localPath: 'media/pour-over-hero.jpg',
      title: 'pour-over-hero.jpg',
    });

    wxr.addRedirect({ from: '/blog/the-art-of-pour-over-coffee', to: '/the-art-of-pour-over-coffee' });

    wxr.addMenuItem({
      title: 'Home',
      url: 'https://mountaincoffee.squarespace.com',
      menuSlug: 'main-menu',
      order: 1,
    });
    wxr.addMenuItem({
      title: 'Blog',
      url: 'https://mountaincoffee.squarespace.com/blog',
      menuSlug: 'main-menu',
      order: 2,
    });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');

    // Verify structure
    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
    expect(xml).toContain('<title>Mountain Coffee Roasters</title>');

    // Verify blog post content
    expect(xml).toContain('<title>The Art of Pour Over Coffee</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('Pour over coffee');

    // Verify page
    expect(xml).toContain('<title>About</title>');
    expect(xml).toContain('<wp:post_type>page</wp:post_type>');

    // Verify SEO meta
    expect(xml).toContain('<wp:meta_key>_seo_title</wp:meta_key>');
    expect(xml).toContain('Mountain Coffee Roasters');

    // Verify categories and tags
    expect(xml).toContain('Brewing Guides');
    expect(xml).toContain('brewing');

    // Verify media
    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('squarespace-cdn.com');

    // Verify nav menu items
    expect(xml).toContain('<wp:post_type>nav_menu_item</wp:post_type>');

    // Verify redirect map
    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);
    const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
    expect(redirects).toHaveLength(1);
    expect(redirects[0].from).toBe('/blog/the-art-of-pour-over-coffee');

    // Validate
    expect(validation.valid).toBe(true);
  });
});
