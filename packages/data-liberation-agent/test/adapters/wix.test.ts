import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { wixAdapter } from '../../src/adapters/wix/index.js';
import { WxrBuilder } from '../../src/lib/wxr/index.js';

describe('wixAdapter', () => {
  it('has id "wix"', () => {
    expect(wixAdapter.id).toBe('wix');
  });

  it('detects wixsite.com URLs', () => {
    expect(wixAdapter.detect('https://mysite.wixsite.com/blog')).toBe(true);
  });

  it('detects wix.com URLs', () => {
    expect(wixAdapter.detect('https://www.wix.com/mysite')).toBe(true);
  });

  it('does not detect non-Wix URLs', () => {
    expect(wixAdapter.detect('https://www.example.com')).toBe(false);
  });

  it('has discover method', () => {
    expect(typeof wixAdapter.discover).toBe('function');
  });

  it('has extract method', () => {
    expect(typeof wixAdapter.extract).toBe('function');
  });
});

describe('Wix adapter WXR integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wix-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds valid WXR from fixture page data', () => {
    const blogPost = JSON.parse(readFileSync('test/fixtures/wix-page-blog-post.json', 'utf8'));
    const homePage = JSON.parse(readFileSync('test/fixtures/wix-page-home.json', 'utf8'));
    const aboutPage = JSON.parse(readFileSync('test/fixtures/wix-page-about.json', 'utf8'));

    const wxr = new WxrBuilder({ title: 'Test Site', url: 'https://test.wixsite.com/site' });

    wxr.addPage({
      title: homePage.title,
      slug: 'homepage',
      content: homePage.content,
      excerpt: homePage.excerpt,
      seoTitle: homePage.seoTitle,
      seoDescription: homePage.seoDescription,
    });

    wxr.addPost({
      title: blogPost.title,
      slug: 'hello-world',
      content: blogPost.content,
      excerpt: blogPost.excerpt,
      date: blogPost.date,
      seoTitle: blogPost.seoTitle,
      seoDescription: blogPost.seoDescription,
    });

    wxr.addPage({
      title: aboutPage.title,
      slug: 'about',
      content: aboutPage.content,
      excerpt: aboutPage.excerpt,
      seoTitle: aboutPage.seoTitle,
      seoDescription: aboutPage.seoDescription,
    });

    wxr.addRedirect({ from: '/', to: 'homepage' });
    wxr.addRedirect({ from: '/blog/hello-world', to: 'hello-world' });
    wxr.addRedirect({ from: '/about', to: 'about' });

    wxr.addMenuItem({ title: 'Home', url: 'https://test.wixsite.com/site', menuSlug: 'main-menu', order: 1 });
    wxr.addMenuItem({ title: 'About', url: 'https://test.wixsite.com/site/about', menuSlug: 'main-menu', order: 2 });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');

    // Verify structure
    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
    expect(xml).toContain('<title>Test Site</title>');

    // Verify blog post
    expect(xml).toContain('<title>Hello World</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('first blog post');

    // Verify pages
    expect(xml).toContain('<title>Welcome to Test Site</title>');
    expect(xml).toContain('<title>About Us</title>');
    expect(xml).toContain('<wp:post_type>page</wp:post_type>');

    // Verify SEO meta
    expect(xml).toContain('<wp:meta_key>_seo_title</wp:meta_key>');
    expect(xml).toContain('Hello World - Test Site');

    // Verify nav menu items
    expect(xml).toContain('<wp:post_type>nav_menu_item</wp:post_type>');

    // Verify redirect map
    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);
    const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
    expect(redirects).toHaveLength(3);
    expect(redirects[1].from).toBe('/blog/hello-world');
    expect(redirects[1].to).toBe('hello-world');

    // Validate
    expect(validation.valid).toBe(true);
  });

  it('produces valid WXR with media attachments', () => {
    const blogPost = JSON.parse(readFileSync('test/fixtures/wix-page-blog-post.json', 'utf8'));
    const wxr = new WxrBuilder({ title: 'Test Site', url: 'https://test.wixsite.com/site' });

    // Simulate media download results
    for (const mediaUrl of blogPost.mediaUrls) {
      wxr.addMedia({
        url: mediaUrl,
        localPath: `media/${mediaUrl.split('/').pop()}`,
        title: mediaUrl.split('/').pop() || 'image',
      });
    }

    const postId = wxr.addPost({
      title: blogPost.title,
      slug: 'hello-world',
      content: blogPost.content,
      featuredMediaId: 1, // first media item
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('wixstatic.com/media/blog-hero.jpg');
    expect(xml).toContain('<wp:meta_key>_thumbnail_id</wp:meta_key>');
  });
});
