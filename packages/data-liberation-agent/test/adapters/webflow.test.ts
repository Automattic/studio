import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { webflowAdapter } from '../../src/adapters/webflow/index.js';
import { WxrBuilder } from '../../src/lib/wxr/index.js';

describe('webflowAdapter', () => {
  it('has id "webflow"', () => {
    expect(webflowAdapter.id).toBe('webflow');
  });

  it('detects webflow.io URLs', () => {
    expect(webflowAdapter.detect('https://mysite.webflow.io')).toBe(true);
    expect(webflowAdapter.detect('https://example.webflow.io/blog')).toBe(true);
  });

  it('detects webflow.com URLs', () => {
    expect(webflowAdapter.detect('https://webflow.com')).toBe(true);
    expect(webflowAdapter.detect('https://www.webflow.com/made-in-webflow')).toBe(true);
  });

  it('does not detect non-Webflow URLs', () => {
    expect(webflowAdapter.detect('https://www.example.com')).toBe(false);
    expect(webflowAdapter.detect('https://mysite.squarespace.com')).toBe(false);
    expect(webflowAdapter.detect('https://mysite.wixsite.com/blog')).toBe(false);
  });

  it('has discover method', () => {
    expect(typeof webflowAdapter.discover).toBe('function');
  });

  it('has extract method', () => {
    expect(typeof webflowAdapter.extract).toBe('function');
  });
});

describe('Webflow WXR integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'webflow-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds valid WXR from fixture HTML', () => {
    const html = readFileSync('test/fixtures/webflow-blog-post.html', 'utf8');

    // Extract data from fixture HTML the same way the adapter would
    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1] || '';
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i)?.[1] || '';
    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1] || '';
    const articleDate = html.match(/<meta\s+property="article:published_time"\s+content="([^"]*)"/i)?.[1] || '';
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '').trim() || '';

    // Extract w-richtext content
    const richTextStart = html.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>/i);
    let richTextContent = '';
    if (richTextStart) {
      const startIdx = html.indexOf(richTextStart[0]) + richTextStart[0].length;
      let depth = 1;
      let i = startIdx;
      while (i < html.length && depth > 0) {
        const nextOpen = html.indexOf('<div', i);
        const nextClose = html.indexOf('</div>', i);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          i = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            richTextContent = html.slice(startIdx, nextClose).trim();
          }
          i = nextClose + 6;
        }
      }
    }

    expect(h1).toBe('10 Tips for Better Web Design');
    expect(ogTitle).toBe('10 Tips for Better Web Design');
    expect(richTextContent).toContain('Web design is both an art and a science');
    expect(richTextContent).toContain('<h2>');
    expect(richTextContent).toContain('<blockquote>');

    // Build WXR from the extracted data
    const wxr = new WxrBuilder({
      title: 'Example Blog',
      url: 'https://www.example-blog.com',
      description: 'A blog about web design',
      language: 'en',
    });

    wxr.addPost({
      title: h1,
      slug: 'blog--10-tips-for-better-web-design',
      content: richTextContent,
      excerpt: ogDesc,
      date: articleDate,
      seoTitle: ogTitle,
      seoDescription: ogDesc,
    });

    // Add media from the fixture
    wxr.addMedia({
      url: ogImage,
      localPath: 'media/hero-web-design.jpg',
      title: 'hero-web-design.jpg',
    });

    wxr.addMedia({
      url: 'https://cdn.prod.website-files.com/64a1b2c3d4e5f6/hierarchy-example.jpg',
      localPath: 'media/hierarchy-example.jpg',
      title: 'hierarchy-example.jpg',
    });

    // Add a page
    wxr.addPage({
      title: 'About',
      slug: 'about',
      content: '<p>About this blog.</p>',
      excerpt: 'About us',
      seoTitle: 'About - Example Blog',
      seoDescription: 'Learn about our blog.',
    });

    // Add navigation
    wxr.addMenuItem({
      title: 'Home',
      url: 'https://www.example-blog.com/',
      menuSlug: 'main-menu',
      order: 1,
    });
    wxr.addMenuItem({
      title: 'Blog',
      url: 'https://www.example-blog.com/blog',
      menuSlug: 'main-menu',
      order: 2,
    });

    wxr.addRedirect({ from: '/blog/10-tips-for-better-web-design', to: '/blog--10-tips-for-better-web-design' });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');

    // Verify structure
    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
    expect(xml).toContain('<title>Example Blog</title>');

    // Verify blog post content
    expect(xml).toContain('<title>10 Tips for Better Web Design</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('Web design is both an art and a science');

    // Verify page
    expect(xml).toContain('<title>About</title>');
    expect(xml).toContain('<wp:post_type>page</wp:post_type>');

    // Verify SEO meta
    expect(xml).toContain('<wp:meta_key>_seo_title</wp:meta_key>');

    // Verify media
    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('cdn.prod.website-files.com');

    // Verify nav menu items
    expect(xml).toContain('<wp:post_type>nav_menu_item</wp:post_type>');

    // Verify redirect map
    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);
    const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
    expect(redirects).toHaveLength(1);
    expect(redirects[0].from).toBe('/blog/10-tips-for-better-web-design');

    // Validate
    expect(validation.valid).toBe(true);
  });

  it('fixture HTML has Webflow data attributes', () => {
    const html = readFileSync('test/fixtures/webflow-blog-post.html', 'utf8');
    expect(html).toContain('data-wf-domain');
    expect(html).toContain('data-wf-page');
    expect(html).toContain('data-wf-site');
    expect(html).toContain('w-richtext');
  });
});
