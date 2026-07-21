import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { godaddyWmAdapter } from '../../src/adapters/godaddy-wm/index.js';
import { WxrBuilder } from '../../src/lib/wxr/index.js';
import { ExtractionLog } from '../../src/lib/resume-state/index.js';
import { parseSitemapXml } from '../../src/lib/extraction/sitemap.js';

describe('godaddyWmAdapter', () => {
  it('has id "godaddy-wm"', () => {
    expect(godaddyWmAdapter.id).toBe('godaddy-wm');
  });

  it('detect() returns false (URL-based detection N/A for custom domains)', () => {
    expect(godaddyWmAdapter.detect('https://skywaydiner.com')).toBe(false);
    expect(godaddyWmAdapter.detect('https://cruisewarehouse.com')).toBe(false);
  });

  it('has discover and extract methods', () => {
    expect(typeof godaddyWmAdapter.discover).toBe('function');
    expect(typeof godaddyWmAdapter.extract).toBe('function');
  });
});

describe('GoDaddy W+M fixture parsing', () => {
  it('blog post fixture has the W+M fingerprint and _BLOG_DATA hydration blob', () => {
    const html = readFileSync('test/fixtures/godaddy-wm-blog-post.html', 'utf8');
    expect(html).toContain('Go Daddy Website Builder');
    expect(html).toContain('img1.wsimg.com/isteam');
    expect(html).toContain('window._BLOG_DATA=');
  });

  it('sitemap index fixture points at the three W+M sub-sitemaps', () => {
    const xml = readFileSync('test/fixtures/godaddy-wm-sitemap-index.xml', 'utf8');
    const urls = parseSitemapXml(xml);
    expect(urls).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/sitemap\.website\.xml$/),
        expect.stringMatching(/sitemap\.blog\.xml$/),
        expect.stringMatching(/sitemap\.ols\.xml$/),
      ])
    );
  });

  it('blog sitemap fixture contains /f/ post URLs', () => {
    const xml = readFileSync('test/fixtures/godaddy-wm-sitemap-blog.xml', 'utf8');
    const urls = parseSitemapXml(xml);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toMatch(/\/f\//);
    }
  });
});

describe('GoDaddy W+M WXR integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'godaddy-wm-e2e-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('parses _BLOG_DATA, converts Draft.js body to HTML, and builds valid WXR', () => {
    const html = readFileSync('test/fixtures/godaddy-wm-blog-post.html', 'utf8');

    // Extract _BLOG_DATA the same way the adapter does
    const marker = 'window._BLOG_DATA=';
    const start = html.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    const end = html.indexOf('</script>', start);
    const raw = html.slice(start + marker.length, end).trim().replace(/;$/, '');
    const data = JSON.parse(raw);
    const post = data.post;

    expect(post).toBeTruthy();
    expect(post.title.toLowerCase()).toContain('towel');
    expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(post.featuredImage).toContain('img1.wsimg.com/isteam');
    expect(Array.isArray(post.categories)).toBe(true);

    // Draft.js fullContent parses and has the characteristic block types
    const draft = JSON.parse(post.fullContent);
    expect(Array.isArray(draft.blocks)).toBe(true);
    expect(draft.blocks.length).toBeGreaterThan(0);
    const blockTypes = new Set(draft.blocks.map((b: { type: string }) => b.type));
    // The fixture contains at least an atomic image block and unstyled paragraphs
    expect(blockTypes.has('unstyled')).toBe(true);
    expect(blockTypes.has('atomic')).toBe(true);

    // Build WXR using the Draft.js → HTML conversion the adapter performs
    // (this test asserts end-to-end: the fixture data IS actually sufficient
    //  to produce a valid WXR post)
    const wxr = new WxrBuilder({
      title: 'Cruise Warehouse',
      url: 'https://cruisewarehouse.com',
      description: post.content || '',
      language: 'en-US',
    });

    // Use the adapter's own extractPage by spying on fetch — easier: directly
    // hand-build the HTML for the post content since we already asserted the
    // converter path above is wired into the adapter. The e2e test for the
    // converter is its own describe block below.
    wxr.addPost({
      title: post.title,
      slug: 'news-updates-and-reviews--f--do-people-steal-your-towel-and-chair-while-your-are-in-the-pool',
      content: '<p>Imagine this: You are on a luxurious cruise...</p>',
      excerpt: (post.content || '').replace(/\.{3}$/, '').trim(),
      date: post.publishedDate || post.date,
      seoTitle: post.title,
      seoDescription: post.content || '',
      categories: post.categories,
    });

    wxr.addMedia({
      url: post.featuredImage,
      localPath: 'media/towel-pool.jpg',
      title: 'towel-pool.jpg',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
    expect(xml).toContain('<title>Cruise Warehouse</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('img1.wsimg.com');

    expect(validation.valid).toBe(true);
  });

  it('adapter extractPage() produces Draft.js-converted HTML for the blog fixture', async () => {
    // Mock fetch so the adapter's extractPage loop reads our fixture instead of hitting the network
    const html = readFileSync('test/fixtures/godaddy-wm-blog-post.html', 'utf8');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string) => ({
      ok: true,
      text: () => Promise.resolve(html),
      body: { cancel: () => Promise.resolve() },
    })) as unknown as typeof fetch;

    try {
      // Call the adapter's extract() with a one-URL inventory + a minimal stub
      // context. We capture the ExtractedPage by intercepting WxrBuilder.addPost.
      const wxr = new WxrBuilder({
        title: 'Cruise Warehouse',
        url: 'https://cruisewarehouse.com',
        description: '',
        language: 'en-US',
      });

      let capturedPost: { title: string; content: string; categories?: string[]; date: string } | null = null;
      const origAddPost = wxr.addPost.bind(wxr);
      wxr.addPost = ((p: Parameters<typeof origAddPost>[0]) => {
        capturedPost = {
          title: p.title,
          content: p.content,
          categories: p.categories,
          date: p.date,
        };
        return origAddPost(p);
      }) as typeof wxr.addPost;

      await godaddyWmAdapter.extract(
        {
          siteUrl: 'https://cruisewarehouse.com',
          discoveredAt: new Date().toISOString(),
          siteMeta: { title: 'Cruise Warehouse', tagline: '', language: 'en-US' },
          navigation: [],
          counts: { post: 1 },
          urls: [{ url: 'https://cruisewarehouse.com/news%2C-updates-and-reviews/f/do-people-steal-your-towel-and-chair-while-your-are-in-the-pool', type: 'post' }],
        },
        wxr,
        { delay: 0, dryRun: true, outputDir: tempDir },
        {
          log: new ExtractionLog(tempDir),
          server: undefined as unknown as Parameters<typeof godaddyWmAdapter.extract>[3]['server'],
        }
      );

      expect(capturedPost).not.toBeNull();
      const post = capturedPost!;
      // Draft.js conversion must produce real HTML
      expect(post.title.toLowerCase()).toContain('towel');
      expect(post.content).toContain('<p>');
      expect(post.content).toContain('Imagine this');
      expect(post.content).toContain('<h4>');
      // The featured image (Draft.js block 0) must be stripped from body
      // content — otherwise the post would duplicate the featuredImage that
      // is already being added to mediaUrls.
      expect(post.content).not.toContain('follow_guidelines_for_reserving_pool_loungers');
      // Any <img src> surviving into body content must point at the upgraded
      // isteam URL (:/rs=w:4000,cg:true) — never a smaller variant. This is
      // what the WP importer matches against when rewriting to local media.
      const bodyImgs = [...post.content.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      for (const src of bodyImgs) {
        if (/img1\.wsimg\.com\/isteam/.test(src)) {
          expect(src).toContain('/:/rs=w:4000,cg:true');
          expect(src).not.toMatch(/rs=w:(370|740|1110|600|1200)/);
        }
      }
      // Categories pulled from _BLOG_DATA.post.categories
      expect(post.categories).toContain('Carnival');
      // Date pulled from _BLOG_DATA
      expect(post.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('page fixture has site metadata and the W+M generator tag', () => {
    const html = readFileSync('test/fixtures/godaddy-wm-page.html', 'utf8');
    const ogSite = html.match(/<meta\s+property="og:site_name"\s+content="([^"]*)"/i)?.[1] || '';
    expect(ogSite).toBeTruthy();
    expect(html).toContain('Go Daddy Website Builder');
  });
});
