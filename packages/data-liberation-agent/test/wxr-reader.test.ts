import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WxrBuilder } from '../src/lib/wxr/index.js';
import { readWxr } from '../src/lib/wxr/index.js';

describe('WXR Reader — round-trip', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildAndRead(setup: (wxr: WxrBuilder) => void) {
    tmpDir = mkdtempSync(join(tmpdir(), 'wxr-reader-'));
    const wxrPath = join(tmpDir, 'export.xml');
    const wxr = new WxrBuilder({ title: 'Test Site', url: 'https://example.com', description: 'A test', language: 'en-US' });
    setup(wxr);
    wxr.serialize(wxrPath);
    return readWxr(wxrPath);
  }

  it('round-trips site metadata', () => {
    const data = buildAndRead(() => {});
    expect(data.site.title).toBe('Test Site');
    expect(data.site.url).toBe('https://example.com');
    expect(data.site.description).toBe('A test');
    expect(data.site.language).toBe('en-US');
  });

  it('round-trips authors', () => {
    const data = buildAndRead((wxr) => {
      wxr.addAuthor({ login: 'admin', email: 'admin@example.com', displayName: 'Admin User', firstName: 'Admin', lastName: 'User' });
      wxr.addAuthor({ login: 'editor' });
    });
    expect(data.authors).toHaveLength(2);
    expect(data.authors[0]).toMatchObject({
      id: 1,
      login: 'admin',
      email: 'admin@example.com',
      displayName: 'Admin User',
      firstName: 'Admin',
      lastName: 'User',
    });
    expect(data.authors[1]).toMatchObject({ id: 2, login: 'editor', email: '', displayName: 'editor' });
  });

  it('round-trips categories with parents', () => {
    const data = buildAndRead((wxr) => {
      wxr.addCategory({ slug: 'tech', name: 'Technology' });
      wxr.addCategory({ slug: 'js', name: 'JavaScript', parent: 'tech', description: 'JS stuff' });
    });
    expect(data.categories).toHaveLength(2);
    expect(data.categories[0]).toMatchObject({ slug: 'tech', name: 'Technology', parent: '' });
    expect(data.categories[1]).toMatchObject({ slug: 'js', name: 'JavaScript', parent: 'tech', description: 'JS stuff' });
  });

  it('round-trips tags', () => {
    const data = buildAndRead((wxr) => {
      wxr.addTag({ slug: 'tutorial', name: 'Tutorial', description: 'How-to guides' });
      wxr.addTag({ slug: 'review', name: 'Review' });
    });
    expect(data.tags).toHaveLength(2);
    expect(data.tags[0]).toMatchObject({ slug: 'tutorial', name: 'Tutorial', description: 'How-to guides' });
    expect(data.tags[1]).toMatchObject({ slug: 'review', name: 'Review', description: '' });
  });

  it('round-trips custom terms', () => {
    const data = buildAndRead((wxr) => {
      wxr.addTerm({ taxonomy: 'genre', slug: 'fiction', name: 'Fiction', description: 'Fiction works' });
      wxr.addTerm({ taxonomy: 'genre', slug: 'nonfiction', name: 'Non-Fiction', parent: 'fiction' });
    });
    expect(data.terms).toHaveLength(2);
    expect(data.terms[0]).toMatchObject({ taxonomy: 'genre', slug: 'fiction', name: 'Fiction', description: 'Fiction works' });
    expect(data.terms[1]).toMatchObject({ taxonomy: 'genre', slug: 'nonfiction', name: 'Non-Fiction', parent: 'fiction' });
  });

  it('round-trips media items', () => {
    const data = buildAndRead((wxr) => {
      wxr.addMedia({
        url: 'https://cdn.example.com/photo.jpg',
        title: 'Beach Photo',
        slug: 'beach-photo',
        altText: 'A sunny beach',
        caption: 'Taken in summer',
      });
    });
    const media = data.items.find((i) => i.type === 'attachment');
    expect(media).toBeDefined();
    expect(media).toMatchObject({
      type: 'attachment',
      title: 'Beach Photo',
      slug: 'beach-photo',
      url: 'https://cdn.example.com/photo.jpg',
      altText: 'A sunny beach',
      // caption is not serialized to WXR by the builder (excerpt:encoded is empty for attachments)
      caption: '',
    });
  });

  it('round-trips pages with parents', () => {
    const data = buildAndRead((wxr) => {
      const parentId = wxr.addPage({
        title: 'About',
        slug: 'about',
        content: '<p>About us</p>',
        excerpt: 'About page',
        date: '2024-06-15T12:00:00Z',
        menuOrder: 1,
        seoTitle: 'About Us | Test Site',
        seoDescription: 'Learn about us',
      });
      wxr.addPage({
        title: 'Team',
        slug: 'team',
        content: '<p>Our team</p>',
        date: '2024-06-16T08:30:00Z',
        parent: parentId,
        menuOrder: 2,
      });
    });

    const pages = data.items.filter((i) => i.type === 'page') as import('../src/lib/wxr/index.js').PageItem[];
    expect(pages).toHaveLength(2);

    expect(pages[0]).toMatchObject({
      title: 'About',
      slug: 'about',
      content: '<p>About us</p>',
      excerpt: 'About page',
      parent: 0,
      menuOrder: 1,
      seoTitle: 'About Us | Test Site',
      seoDescription: 'Learn about us',
    });
    expect(pages[0].date).toBe('2024-06-15T12:00:00.000Z');

    expect(pages[1]).toMatchObject({
      title: 'Team',
      slug: 'team',
      content: '<p>Our team</p>',
      parent: pages[0].id,
      menuOrder: 2,
    });
  });

  it('round-trips posts with categories, tags, featured media, custom terms, and author', () => {
    const data = buildAndRead((wxr) => {
      wxr.addAuthor({ login: 'writer' });
      wxr.addCategory({ slug: 'tech', name: 'Technology' });
      wxr.addTag({ slug: 'tutorial', name: 'Tutorial' });
      wxr.addTerm({ taxonomy: 'series', slug: 'getting-started', name: 'Getting Started' });
      const mediaId = wxr.addMedia({ url: 'https://cdn.example.com/hero.jpg', title: 'Hero' });
      wxr.addPost({
        title: 'Hello World',
        slug: 'hello-world',
        content: '<p>First post</p>',
        excerpt: 'My first post',
        date: '2024-07-01T10:00:00Z',
        categories: ['tech'],
        tags: ['tutorial'],
        featuredMediaId: mediaId,
        author: 'writer',
        seoTitle: 'Hello World | Blog',
        seoDescription: 'The very first post',
        customTerms: [{ taxonomy: 'series', slug: 'getting-started' }],
      });
    });

    const post = data.items.find((i) => i.type === 'post') as import('../src/lib/wxr/index.js').PostItem;
    expect(post).toBeDefined();
    expect(post.title).toBe('Hello World');
    expect(post.slug).toBe('hello-world');
    expect(post.content).toBe('<p>First post</p>');
    expect(post.excerpt).toBe('My first post');
    expect(post.date).toBe('2024-07-01T10:00:00.000Z');
    expect(post.categories).toEqual(['tech']);
    expect(post.tags).toEqual(['tutorial']);
    expect(post.author).toBe('writer');
    expect(post.seoTitle).toBe('Hello World | Blog');
    expect(post.seoDescription).toBe('The very first post');
    expect(post.customTerms).toEqual([{ taxonomy: 'series', slug: 'getting-started' }]);

    // Featured media ID should match the media item's ID
    const media = data.items.find((i) => i.type === 'attachment');
    expect(post.featuredMediaId).toBe(media!.id);
  });

  it('round-trips comments', () => {
    const data = buildAndRead((wxr) => {
      const postId = wxr.addPost({ title: 'Post', slug: 'post', content: '<p>content</p>' });
      wxr.addComment({
        postId,
        author: 'Jane',
        authorEmail: 'jane@example.com',
        authorUrl: 'https://jane.example.com',
        authorIp: '127.0.0.1',
        date: '2024-08-01T14:30:00Z',
        content: 'Great post!',
        approved: true,
        type: 'comment',
        parent: 0,
        userId: 0,
      });
      wxr.addComment({
        postId,
        author: 'Bob',
        content: 'I disagree.',
        approved: false,
      });
    });

    expect(data.comments).toHaveLength(2);
    expect(data.comments[0]).toMatchObject({
      author: 'Jane',
      authorEmail: 'jane@example.com',
      authorUrl: 'https://jane.example.com',
      authorIp: '127.0.0.1',
      content: 'Great post!',
      approved: '1',
      type: 'comment',
      parent: 0,
      userId: 0,
    });
    expect(data.comments[0].date).toBe('2024-08-01T14:30:00.000Z');

    expect(data.comments[1]).toMatchObject({
      author: 'Bob',
      content: 'I disagree.',
      approved: '0',
    });
  });

  it('round-trips menu items with menuSlug', () => {
    const data = buildAndRead((wxr) => {
      wxr.addMenuItem({
        title: 'Home',
        url: 'https://example.com/',
        menuSlug: 'main-menu',
        order: 1,
      });
      wxr.addMenuItem({
        title: 'Blog',
        url: 'https://example.com/blog',
        menuSlug: 'main-menu',
        parent: 0,
        order: 2,
      });
    });

    const menuItems = data.items.filter((i) => i.type === 'nav_menu_item') as import('../src/lib/wxr/index.js').MenuItem[];
    expect(menuItems).toHaveLength(2);
    expect(menuItems[0]).toMatchObject({
      title: 'Home',
      url: 'https://example.com/',
      menuSlug: 'main-menu',
      menuOrder: 1,
    });
    expect(menuItems[1]).toMatchObject({
      title: 'Blog',
      url: 'https://example.com/blog',
      menuSlug: 'main-menu',
      menuOrder: 2,
    });
  });

  it('round-trips redirects from sibling file', () => {
    const data = buildAndRead((wxr) => {
      wxr.addRedirect({ from: '/old-page', to: '/new-page' });
      wxr.addRedirect({ from: '/legacy', to: '/modern' });
    });
    expect(data.redirects).toHaveLength(2);
    expect(data.redirects[0]).toEqual({ from: '/old-page', to: '/new-page' });
    expect(data.redirects[1]).toEqual({ from: '/legacy', to: '/modern' });
  });

  it('returns empty redirects when no redirect-map.json exists', () => {
    const data = buildAndRead(() => {});
    expect(data.redirects).toEqual([]);
  });

  it('handles posts with no optional fields', () => {
    const data = buildAndRead((wxr) => {
      wxr.addPost({ title: 'Bare Post', slug: 'bare-post' });
    });
    const post = data.items.find((i) => i.type === 'post') as import('../src/lib/wxr/index.js').PostItem;
    expect(post).toMatchObject({
      title: 'Bare Post',
      slug: 'bare-post',
      content: '',
      excerpt: '',
      categories: [],
      tags: [],
      featuredMediaId: 0,
      author: '',
      seoTitle: '',
      seoDescription: '',
      customTerms: [],
    });
  });

  it('converts WP dates back to ISO 8601', () => {
    const data = buildAndRead((wxr) => {
      wxr.addPage({ title: 'Dated', slug: 'dated', content: '<p>x</p>', date: '2024-12-25T18:30:45Z' });
    });
    const page = data.items.find((i) => i.type === 'page') as import('../src/lib/wxr/index.js').PageItem;
    expect(page.date).toBe('2024-12-25T18:30:45.000Z');
  });

  it('handles zero dates as empty string', () => {
    // Externally-produced WXR files (e.g. from legacy exports) may contain
    // literal 0000-00-00 post dates. The reader must normalize those to '',
    // not pass them through as broken ISO strings. The builder itself no
    // longer produces zero dates — see test/wxr-builder.test.ts for that —
    // so we craft the WXR directly here.
    tmpDir = mkdtempSync(join(tmpdir(), 'wxr-reader-'));
    const wxrPath = join(tmpDir, 'zero-date.xml');
    writeFileSync(wxrPath, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
  <channel>
    <title>Zero Date Site</title>
    <link>https://example.com</link>
    <wp:wxr_version>1.2</wp:wxr_version>
    <wp:base_site_url>https://example.com</wp:base_site_url>
    <item>
      <title>No Date</title>
      <wp:post_id>1</wp:post_id>
      <wp:post_date>0000-00-00 00:00:00</wp:post_date>
      <wp:post_date_gmt>0000-00-00 00:00:00</wp:post_date_gmt>
      <wp:post_name>no-date</wp:post_name>
      <wp:post_type>post</wp:post_type>
    </item>
  </channel>
</rss>`);
    const data = readWxr(wxrPath);
    const post = data.items.find((i) => i.type === 'post') as import('../src/lib/wxr/index.js').PostItem;
    expect(post.date).toBe('');
  });
});
