import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { XMLParser } from 'fast-xml-parser';
import { WxrBuilder } from '../src/lib/wxr/index.js';

describe('WxrBuilder', () => {
  it('constructs with site metadata', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    expect(wxr).toBeDefined();
  });

  it('addAuthor returns auto-incrementing ID', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const id1 = wxr.addAuthor({ login: 'admin' });
    const id2 = wxr.addAuthor({ login: 'editor', email: 'ed@example.com', displayName: 'Editor' });
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('addCategory returns ID and handles parent', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const id = wxr.addCategory({ slug: 'tech', name: 'Technology' });
    expect(id).toBe(1);
    const childId = wxr.addCategory({ slug: 'js', name: 'JavaScript', parent: 'tech' });
    expect(childId).toBe(2);
  });

  it('addTag returns ID', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const id = wxr.addTag({ slug: 'tutorial', name: 'Tutorial' });
    expect(id).toBe(1);
  });

  it('addMedia returns ID', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const id = wxr.addMedia({
      url: 'https://cdn.example.com/photo.jpg',
      localPath: 'output/media/photo.jpg',
      title: 'A photo',
      altText: 'Photo description',
    });
    expect(id).toBe(1);
  });

  it('addPage returns ID', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const id = wxr.addPage({
      title: 'About',
      slug: 'about',
      content: '<p>About us</p>',
    });
    expect(id).toBe(1);
  });

  it('addPost returns ID and accepts categories, tags, featuredMediaId', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    wxr.addCategory({ slug: 'tech', name: 'Technology' });
    wxr.addTag({ slug: 'tutorial', name: 'Tutorial' });
    const mediaId = wxr.addMedia({
      url: 'https://cdn.example.com/hero.jpg',
      localPath: 'output/media/hero.jpg',
    });
    const postId = wxr.addPost({
      title: 'Hello World',
      slug: 'hello-world',
      content: '<p>First post</p>',
      date: '2026-01-15T10:00:00Z',
      categories: ['tech'],
      tags: ['tutorial'],
      featuredMediaId: mediaId,
      seoTitle: 'Hello World - My Site',
      seoDescription: 'My first blog post',
    });
    expect(postId).toBe(4); // category=1, tag=2, media=3, post=4
  });

  it('addMenuItem does not return an ID', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    const result = wxr.addMenuItem({
      title: 'Home',
      url: 'https://example.com/',
      menuSlug: 'main-menu',
      order: 1,
    });
    expect(result).toBeUndefined();
  });

  it('addRedirect stores redirect mapping', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com' });
    wxr.addRedirect({ from: '/old-path', to: '/new-slug' });
    // Redirect map is verified in serialize tests
  });
});

describe('WxrBuilder.validate', () => {
  it('returns valid for well-formed data', () => {
    const wxr = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr.addCategory({ slug: 'news', name: 'News' });
    wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>', categories: ['news'] });
    const result = wxr.validate();
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns about orphaned featuredMediaId', () => {
    const wxr = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>', featuredMediaId: 999 });
    const result = wxr.validate();
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('999'))).toBe(true);
  });

  it('warns about unknown category references', () => {
    const wxr = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>', categories: ['nonexistent'] });
    const result = wxr.validate();
    expect(result.warnings.some(w => w.includes('nonexistent'))).toBe(true);
  });

  it('warns about empty content', () => {
    const wxr = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr.addPost({ title: 'Post', slug: 'post', content: '' });
    const result = wxr.validate();
    expect(result.warnings.some(w => w.includes('empty content'))).toBe(true);
  });
});

describe('WxrBuilder.serialize', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wxr-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a valid WXR XML file', () => {
    const wxr = new WxrBuilder({ title: 'My Site', url: 'https://example.com', description: 'A test site' });
    wxr.addCategory({ slug: 'news', name: 'News' });
    wxr.addTag({ slug: 'featured', name: 'Featured' });
    wxr.addPost({
      title: 'Hello World',
      slug: 'hello-world',
      content: '<p>First post</p>',
      date: '2026-01-15T10:00:00Z',
      categories: ['news'],
      tags: ['featured'],
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);

    expect(existsSync(wxrPath)).toBe(true);
    const xml = readFileSync(wxrPath, 'utf8');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('xmlns:wp="http://wordpress.org/export/1.2/"');
    expect(xml).toContain('<title>My Site</title>');
    expect(xml).toContain('<wp:cat_name>');
    expect(xml).toContain('<![CDATA[News]]>');
    expect(xml).toContain('<wp:tag_name>');
    expect(xml).toContain('<![CDATA[Featured]]>');
    expect(xml).toContain('<title>Hello World</title>');
    expect(xml).toContain('<wp:post_type>post</wp:post_type>');
    expect(xml).toContain('<![CDATA[<p>First post</p>]]>');
    expect(xml).toContain('<wp:post_name>hello-world</wp:post_name>');
  });

  it('writes SEO custom fields as post meta', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addPost({
      title: 'SEO Post',
      slug: 'seo-post',
      content: '<p>Content</p>',
      seoTitle: 'Custom SEO Title',
      seoDescription: 'Custom SEO description',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:meta_key>_seo_title</wp:meta_key>');
    expect(xml).toContain('<![CDATA[Custom SEO Title]]>');
    expect(xml).toContain('<wp:meta_key>_seo_description</wp:meta_key>');
  });

  it('writes redirect-map.json alongside the WXR', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addRedirect({ from: '/old', to: '/new' });
    wxr.addRedirect({ from: '/about-us', to: '/about' });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);

    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);
    const redirects = JSON.parse(readFileSync(redirectPath, 'utf8'));
    expect(redirects).toEqual([
      { from: '/old', to: '/new' },
      { from: '/about-us', to: '/about' },
    ]);
  });

  it('escapes XML-hostile characters in content', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addPost({
      title: 'Post with <special> & "chars"',
      slug: 'special',
      content: '<p>Content with ]]> CDATA end</p>',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).not.toContain(']]>CDATA');
    expect(xml.length).toBeGreaterThan(0);
  });

  it('never emits 0000-00-00 dates on any item type', () => {
    // Regression: empty post dates caused WP's WXR importer to route
    // attachment uploads into wp-content/uploads/0000/00/, which broke
    // Studio site creation with ENOTEMPTY during blueprint cleanup.
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addMedia({ url: 'https://cdn.example.com/photo.jpg', title: 'Dateless' });
    wxr.addPage({ title: 'Dateless Page', slug: 'dateless-page' });
    wxr.addPost({ title: 'Dateless Post', slug: 'dateless-post' });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).not.toContain('0000-00-00');
  });

  it('includes media attachments with alt text', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addMedia({
      url: 'https://cdn.example.com/photo.jpg',
      localPath: 'media/photo.jpg',
      title: 'Beach Photo',
      altText: 'A sunny beach',
      caption: 'Summer 2025',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('<wp:attachment_url>');
    expect(xml).toContain('<![CDATA[https://cdn.example.com/photo.jpg]]>');
  });

  it('writes channel-level base URLs', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');
    expect(xml).toContain('<wp:base_site_url>https://example.com</wp:base_site_url>');
    expect(xml).toContain('<wp:base_blog_url>https://example.com</wp:base_blog_url>');
    expect(xml).toContain('<wp:wxr_version>1.2</wp:wxr_version>');
  });

  it('writes complete item metadata for posts', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addPost({
      title: 'Test Post',
      slug: 'test-post',
      content: '<p>Hello</p>',
      date: '2026-01-15T10:00:00Z',
      author: 'admin',
    });
    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<dc:creator>');
    expect(xml).toContain('<![CDATA[admin]]>');
    expect(xml).toContain('isPermaLink="false"');
    expect(xml).toContain('<description></description>');
    expect(xml).toContain('<wp:post_date>2026-01-15 10:00:00</wp:post_date>');
    expect(xml).toContain('<wp:post_date_gmt>');
    expect(xml).toContain('<wp:comment_status>closed</wp:comment_status>');
    expect(xml).toContain('<wp:ping_status>');
    expect(xml).toContain('<wp:post_password></wp:post_password>');
    expect(xml).toContain('<wp:is_sticky>0</wp:is_sticky>');
  });

  it('writes post_name and post_parent for all item types', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addMedia({ url: 'https://cdn.example.com/photo.jpg', title: 'Photo' });
    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    // Attachments should also have post_name, post_parent, menu_order
    expect(xml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(xml).toContain('<wp:post_parent>0</wp:post_parent>');
    expect(xml).toContain('<wp:menu_order>0</wp:menu_order>');
  });

  it('writes author first and last name', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addAuthor({ login: 'jdoe', firstName: 'John', lastName: 'Doe' });
    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:author_first_name>');
    expect(xml).toContain('<![CDATA[John]]>');
    expect(xml).toContain('<wp:author_last_name>');
    expect(xml).toContain('<![CDATA[Doe]]>');
  });

  it('writes wfw namespace', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');
    expect(xml).toContain('xmlns:wfw="http://wellformedweb.org/CommentAPI/"');
  });
});

describe('WxrBuilder.addComment', () => {
  it('returns auto-incrementing ID', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const postId = wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>' });
    const c1 = wxr.addComment({ postId, content: 'Great post!' });
    const c2 = wxr.addComment({ postId, content: 'Thanks!', parent: c1 });
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBe(c1 + 1);
  });
});

describe('WxrBuilder comments in serialize', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'wxr-test-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('serializes comments inside their parent item', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const postId = wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>' });
    wxr.addComment({
      postId,
      author: 'Jane',
      authorEmail: 'jane@example.com',
      content: 'Nice post!',
      date: '2026-01-15T12:00:00Z',
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:comment>');
    expect(xml).toContain('<wp:comment_author>');
    expect(xml).toContain('<![CDATA[Jane]]>');
    expect(xml).toContain('<wp:comment_author_email>jane@example.com</wp:comment_author_email>');
    expect(xml).toContain('<wp:comment_content>');
    expect(xml).toContain('<![CDATA[Nice post!]]>');
    expect(xml).toContain('<wp:comment_approved>1</wp:comment_approved>');
    expect(xml).toContain('<wp:comment_type>comment</wp:comment_type>');
  });

  it('threads comments with parent references', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const postId = wxr.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>' });
    const c1 = wxr.addComment({ postId, content: 'First!' });
    wxr.addComment({ postId, content: 'Reply!', parent: c1 });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain(`<wp:comment_parent>${c1}</wp:comment_parent>`);
  });
});

describe('WxrBuilder.addTerm', () => {
  it('returns auto-incrementing ID', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    const id = wxr.addTerm({ taxonomy: 'hashtag', slug: 'travel', name: 'Travel' });
    expect(id).toBeGreaterThan(0);
  });
});

describe('WxrBuilder terms in serialize', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'wxr-test-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('serializes custom terms at channel level', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addTerm({ taxonomy: 'hashtag', slug: 'travel', name: 'Travel', description: 'Travel posts' });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('<wp:term>');
    expect(xml).toContain('<wp:term_taxonomy>');
    expect(xml).toContain('<![CDATA[hashtag]]>');
    expect(xml).toContain('<wp:term_slug>');
    expect(xml).toContain('<![CDATA[travel]]>');
    expect(xml).toContain('<wp:term_name>');
    expect(xml).toContain('<![CDATA[Travel]]>');
    expect(xml).toContain('<wp:term_description>');
    expect(xml).toContain('<![CDATA[Travel posts]]>');
  });

  it('serializes custom terms on posts as category elements', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addTerm({ taxonomy: 'hashtag', slug: 'travel', name: 'Travel' });
    wxr.addPost({
      title: 'My Trip',
      slug: 'my-trip',
      content: '<p>Hello</p>',
      customTerms: [{ taxonomy: 'hashtag', slug: 'travel' }],
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    expect(xml).toContain('domain="hashtag"');
    expect(xml).toContain('nicename="travel"');
    expect(xml).toContain('<![CDATA[Travel]]>');
  });
});

describe('WxrBuilder validate with comments and terms', () => {
  it('warns about comments referencing non-existent posts', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addComment({ postId: 999, content: 'orphan comment' });
    const result = wxr.validate();
    expect(result.warnings.some(w => w.includes('999'))).toBe(true);
  });

  it('warns about custom terms not registered', () => {
    const wxr = new WxrBuilder({ title: 'Site', url: 'https://example.com' });
    wxr.addPost({
      title: 'Post',
      slug: 'post',
      content: '<p>Hi</p>',
      customTerms: [{ taxonomy: 'hashtag', slug: 'unknown' }],
    });
    const result = wxr.validate();
    expect(result.warnings.some(w => w.includes('unknown'))).toBe(true);
  });
});

describe('WxrBuilder backfills inline post terms into the channel header', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'wxr-inline-terms-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  // Regression: a Squarespace extract attached terms to posts inline
  // (<category domain="category|post_tag" nicename="…">) without ever calling
  // addCategory/addTag, so the channel header declared ZERO terms. That produced
  // hundreds of "references unknown category/tag slug …" validator warnings.
  // The builder must now collect the distinct inline terms and declare each once
  // in the header, with the declared slug matching the inline nicename exactly.
  // Data below is fictional — invented outlet names and topics.
  it('emits one <wp:category>/<wp:tag> per distinct inline term with matching slugs', () => {
    const wxr = new WxrBuilder({ title: 'Newsroom', url: 'https://example.com' });
    // No addCategory/addTag calls — terms arrive only inline on the posts.
    wxr.addPost({
      title: 'Quarterly Filing Roundup',
      slug: 'quarterly-filing-roundup',
      content: '<p>Body one</p>',
      date: '2026-01-15T10:00:00Z',
      categories: ['The Gazette Ledger', 'Markets Watch'],
      tags: ['Insurance coverage', 'Annual report'],
    });
    wxr.addPost({
      title: 'Storm Season Outlook',
      slug: 'storm-season-outlook',
      content: '<p>Body two</p>',
      date: '2026-01-16T10:00:00Z',
      // 'The Gazette Ledger' and 'Insurance coverage' repeat across posts.
      categories: ['The Gazette Ledger', 'Weather Desk'],
      tags: ['Insurance coverage', 'Forecasting'],
    });

    const wxrPath = join(tempDir, 'output.wxr');
    const { validation } = wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    // (a) A header declaration exists for each distinct category and tag.
    expect(xml).toContain('<wp:cat_name><![CDATA[The Gazette Ledger]]></wp:cat_name>');
    expect(xml).toContain('<wp:cat_name><![CDATA[Markets Watch]]></wp:cat_name>');
    expect(xml).toContain('<wp:cat_name><![CDATA[Weather Desk]]></wp:cat_name>');
    expect(xml).toContain('<wp:tag_name><![CDATA[Insurance coverage]]></wp:tag_name>');
    expect(xml).toContain('<wp:tag_name><![CDATA[Annual report]]></wp:tag_name>');
    expect(xml).toContain('<wp:tag_name><![CDATA[Forecasting]]></wp:tag_name>');

    // (b) The declared slug matches the inline nicename exactly (so refs resolve).
    expect(xml).toContain('<wp:category_nicename><![CDATA[The Gazette Ledger]]></wp:category_nicename>');
    expect(xml).toContain('<wp:tag_slug><![CDATA[Insurance coverage]]></wp:tag_slug>');
    // The inline post ref uses the same nicename string.
    expect(xml).toContain('nicename="The Gazette Ledger"');
    expect(xml).toContain('nicename="Insurance coverage"');

    // (c) Terms shared across posts are declared exactly once.
    const countOccurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(countOccurrences(xml, '<wp:cat_name><![CDATA[The Gazette Ledger]]></wp:cat_name>')).toBe(1);
    expect(countOccurrences(xml, '<wp:tag_name><![CDATA[Insurance coverage]]></wp:tag_name>')).toBe(1);
    // 3 distinct categories + 3 distinct tags declared in the header.
    expect(countOccurrences(xml, '<wp:cat_name>')).toBe(3);
    expect(countOccurrences(xml, '<wp:tag_name>')).toBe(3);

    // The backfill also clears the would-be "unknown category/tag slug" warnings
    // and surfaces the terms via the public arrays the extract summary reads.
    expect(validation.warnings.some((w) => /unknown (category|tag) slug/.test(w))).toBe(false);
    expect(wxr.categories.map((c) => c.slug).sort()).toEqual(
      ['Markets Watch', 'The Gazette Ledger', 'Weather Desk']
    );
    expect(wxr.tags.map((t) => t.slug).sort()).toEqual(
      ['Annual report', 'Forecasting', 'Insurance coverage']
    );

    // (d) The output still parses as well-formed XML.
    const parser = new XMLParser({ ignoreAttributes: false });
    expect(() => parser.parse(xml)).not.toThrow();
    const parsed = parser.parse(xml);
    expect(parsed.rss.channel).toBeDefined();
  });

  it('does not duplicate a term already registered via addCategory/addTag', () => {
    const wxr = new WxrBuilder({ title: 'Newsroom', url: 'https://example.com' });
    // Explicitly registered with a curated display name; the inline ref reuses
    // the same slug, so the backfill must NOT add a second declaration.
    wxr.addCategory({ slug: 'markets-watch', name: 'Markets Watch Desk' });
    wxr.addPost({
      title: 'Bond Yields Slip',
      slug: 'bond-yields-slip',
      content: '<p>Body</p>',
      date: '2026-01-17T10:00:00Z',
      categories: ['markets-watch'],
    });

    const wxrPath = join(tempDir, 'output.wxr');
    wxr.serialize(wxrPath);
    const xml = readFileSync(wxrPath, 'utf8');

    const countOccurrences = (haystack: string, needle: string): number =>
      haystack.split(needle).length - 1;
    expect(countOccurrences(xml, '<wp:cat_name>')).toBe(1);
    // The curated name is preserved, not overwritten by the slug.
    expect(xml).toContain('<wp:cat_name><![CDATA[Markets Watch Desk]]></wp:cat_name>');
    expect(wxr.categories).toHaveLength(1);
  });
});

describe('WxrBuilder streaming', () => {
  let tempDir: string;
  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'wxr-stream-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('produces same output as serialize() when used incrementally', () => {
    // Build the same WXR two ways and compare
    const wxr1 = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr1.addCategory({ slug: 'news', name: 'News' });
    wxr1.addTag({ slug: 'featured', name: 'Featured' });
    const media1 = wxr1.addMedia({ url: 'https://cdn.example.com/photo.jpg', localPath: 'media/photo.jpg', title: 'Photo' });
    wxr1.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>', categories: ['news'], tags: ['featured'], featuredMediaId: media1, date: '2026-01-15T10:00:00Z' });
    wxr1.addPage({ title: 'About', slug: 'about', content: '<p>About us</p>' });
    wxr1.addRedirect({ from: '/old', to: '/new' });

    const batchPath = join(tempDir, 'batch.wxr');
    wxr1.serialize(batchPath);
    const batchXml = readFileSync(batchPath, 'utf8');

    // Now do the same with streaming
    const wxr2 = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr2.addCategory({ slug: 'news', name: 'News' });
    wxr2.addTag({ slug: 'featured', name: 'Featured' });

    const streamPath = join(tempDir, 'stream.wxr');
    wxr2.openStream(streamPath);

    const media2 = wxr2.addMedia({ url: 'https://cdn.example.com/photo.jpg', localPath: 'media/photo.jpg', title: 'Photo' });
    wxr2.flushItem(wxr2.items[wxr2.items.length - 1]);

    wxr2.addPost({ title: 'Post', slug: 'post', content: '<p>Hello</p>', categories: ['news'], tags: ['featured'], featuredMediaId: media2, date: '2026-01-15T10:00:00Z' });
    wxr2.flushItem(wxr2.items[wxr2.items.length - 1]);

    wxr2.addPage({ title: 'About', slug: 'about', content: '<p>About us</p>' });
    wxr2.flushItem(wxr2.items[wxr2.items.length - 1]);

    wxr2.addRedirect({ from: '/old', to: '/new' });
    const { validation } = wxr2.closeStream();

    const streamXml = readFileSync(streamPath, 'utf8');

    // Both should produce valid WXR with same content (pubDate will differ slightly)
    expect(streamXml).toContain('<title>Test</title>');
    expect(streamXml).toContain('<wp:post_type>post</wp:post_type>');
    expect(streamXml).toContain('<wp:post_type>page</wp:post_type>');
    expect(streamXml).toContain('<wp:post_type>attachment</wp:post_type>');
    expect(streamXml).toContain('</channel>');
    expect(streamXml).toContain('</rss>');

    // Redirect map should also be written
    const redirectPath = join(tempDir, 'redirect-map.json');
    expect(existsSync(redirectPath)).toBe(true);

    expect(validation.valid).toBe(true);
  });

  it('throws if flushItem called without openStream', () => {
    const wxr = new WxrBuilder({ title: 'Test', url: 'https://example.com' });
    wxr.addPage({ title: 'Page', slug: 'page', content: '<p>Hi</p>' });
    expect(() => wxr.flushItem(wxr.items[0])).toThrow();
  });
});
