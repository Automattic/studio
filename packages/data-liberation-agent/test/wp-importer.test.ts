import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { importToWordPress } from '../src/lib/import/wp-importer.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WxrBuilder } from '../src/lib/wxr/index.js';

/** Build a WXR file using WxrBuilder, writing to the given path. */
function buildWxrFile(wxrPath: string, setup: (b: WxrBuilder) => void): void {
  const b = new WxrBuilder({ title: 'Test Site', url: 'https://old.example.com' });
  setup(b);
  b.serialize(wxrPath);
}

/** Auto-incrementing mock fetch that returns IDs and tracks call order. */
function createMockFetch() {
  let nextId = 100;
  const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];

  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method || 'GET';
    let body: unknown = null;
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    } else {
      body = init.body;
    }
    calls.push({ url, method, body, headers: init.headers as Record<string, string> });

    const id = nextId++;
    return {
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({
        id,
        link: `https://wp.example.com/${id}`,
        source_url: `https://wp.example.com/wp-content/uploads/file-${id}.jpg`,
      }),
      text: async () => JSON.stringify({ id }),
    };
  });

  return { fn, calls, reset: () => { nextId = 100; calls.length = 0; fn.mockClear(); } };
}

let tmpDir: string;
let wxrPath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `wp-importer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  wxrPath = join(tmpDir, 'export.wxr');
});

afterEach(() => {
  vi.restoreAllMocks();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('importToWordPress', () => {
  it('imports categories, tags, media, pages, and posts in dependency order', async () => {
    buildWxrFile(wxrPath, (b) => {
      b.addCategory({ slug: 'tech', name: 'Tech' });
      b.addTag({ slug: 'js', name: 'JavaScript' });
      b.addMedia({ url: 'https://old.example.com/img.jpg', title: 'Image', slug: 'img' });
      b.addPage({ title: 'About', slug: 'about', content: '<p>About us</p>' });
      b.addPost({
        title: 'Hello',
        slug: 'hello',
        content: '<p>World</p>',
        categories: ['tech'],
        tags: ['js'],
      });
    });

    const mock = createMockFetch();
    vi.stubGlobal('fetch', mock.fn);

    const result = await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      delay: 0,
    });

    // Verify counts
    expect(result.categories.created).toBe(1);
    expect(result.tags.created).toBe(1);
    expect(result.media.total).toBe(1);
    expect(result.pages.created).toBe(1);
    expect(result.posts.created).toBe(1);

    // Verify dependency order: categories before tags before media before pages before posts
    const urlStages = mock.calls.map((c) => {
      if (typeof c.url !== 'string') return 'unknown';
      if (c.url.includes('/categories')) return 'categories';
      if (c.url.includes('/tags')) return 'tags';
      if (c.url.includes('/media')) return 'media';
      if (c.url.includes('/pages')) return 'pages';
      if (c.url.includes('/posts')) return 'posts';
      return 'other';
    });

    const stageOrder = ['categories', 'tags', 'media', 'pages', 'posts'];
    const filtered = urlStages.filter((s) => stageOrder.includes(s));
    // Each stage should appear in order (categories before tags before media etc.)
    let lastIndex = -1;
    for (const stage of stageOrder) {
      const idx = filtered.indexOf(stage);
      if (idx === -1) continue; // media may be skipped if file not found
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
  });

  it('continues on individual item failure', async () => {
    buildWxrFile(wxrPath, (b) => {
      b.addPage({ title: 'Page 1', slug: 'page-1', content: '<p>One</p>' });
      b.addPage({ title: 'Page 2', slug: 'page-2', content: '<p>Two</p>' });
      b.addPage({ title: 'Page 3', slug: 'page-3', content: '<p>Three</p>' });
    });

    let callCount = 0;
    const fn = vi.fn(async (_url: string, _init: RequestInit) => {
      callCount++;
      if (callCount === 2) {
        // Second page fails
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ message: 'Internal Server Error' }),
          text: async () => 'Internal Server Error',
        };
      }
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ id: callCount * 10, link: `https://wp.example.com/${callCount}` }),
        text: async () => JSON.stringify({ id: callCount * 10 }),
      };
    });
    vi.stubGlobal('fetch', fn);

    const result = await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      delay: 0,
    });

    expect(result.pages.total).toBe(3);
    expect(result.pages.created).toBe(2);
    expect(result.pages.failed).toBe(1);
  });

  it('dry run makes no API calls', async () => {
    buildWxrFile(wxrPath, (b) => {
      b.addCategory({ slug: 'news', name: 'News' });
      b.addTag({ slug: 'hot', name: 'Hot' });
      b.addPage({ title: 'Home', slug: 'home', content: '<p>Welcome</p>' });
      b.addPost({ title: 'First Post', slug: 'first', content: '<p>Content</p>', categories: ['news'] });
    });

    const mock = createMockFetch();
    vi.stubGlobal('fetch', mock.fn);

    const result = await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      dryRun: true,
      delay: 0,
    });

    expect(mock.fn).not.toHaveBeenCalled();
    expect(result.categories.total).toBe(1);
    expect(result.tags.total).toBe(1);
    expect(result.pages.total).toBe(1);
    expect(result.posts.total).toBe(1);
  });

  it('rewrites media URLs in post content', async () => {
    const oldUrl = 'https://old.example.com/images/photo.jpg';
    buildWxrFile(wxrPath, (b) => {
      b.addMedia({ url: oldUrl, title: 'Photo', slug: 'photo' });
      b.addPost({
        title: 'Post with image',
        slug: 'post-with-image',
        content: `<p>Check out <img src="${oldUrl}" /> this photo</p>`,
      });
    });

    // Create media file so upload succeeds
    const mediaDir = join(tmpDir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'photo.jpg'), Buffer.from('fake-jpg'));

    const mock = createMockFetch();
    vi.stubGlobal('fetch', mock.fn);

    await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      delay: 0,
    });

    // Find the post creation call
    const postCall = mock.calls.find((c) => c.url.includes('/posts'));
    expect(postCall).toBeDefined();
    const postBody = postCall!.body as Record<string, unknown>;
    const content = postBody.content as string;

    // Old URL should be replaced with new WP URL
    expect(content).not.toContain(oldUrl);
    expect(content).toContain('https://wp.example.com/wp-content/uploads/');
  });

  it('falls back to downloading media from source URL when local file missing', async () => {
    const mediaUrl = 'https://old.example.com/images/remote-photo.jpg';
    buildWxrFile(wxrPath, (b) => {
      b.addMedia({ url: mediaUrl, title: 'Remote Photo', slug: 'remote-photo' });
    });

    // No local file created — media dir has no matching file

    let nextId = 100;
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      // Download request: fetch from source URL (no auth headers)
      if (url === mediaUrl) {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(8),
          json: async () => ({}),
          text: async () => 'fake-image-data',
        };
      }

      // REST API call (has auth headers)
      const id = nextId++;
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({
          id,
          link: `https://wp.example.com/${id}`,
          source_url: `https://wp.example.com/wp-content/uploads/file-${id}.jpg`,
        }),
        text: async () => JSON.stringify({ id }),
      };
    });
    vi.stubGlobal('fetch', fn);

    const result = await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      delay: 0,
    });

    expect(result.media.total).toBe(1);
    expect(result.media.created).toBe(1);
    expect(result.media.failed).toBe(0);

    // Verify the download fetch was called (no auth header)
    const downloadCall = fn.mock.calls.find((c: unknown[]) => c[0] === mediaUrl);
    expect(downloadCall).toBeDefined();

    // Verify the upload fetch was called (to /media endpoint)
    const uploadCall = fn.mock.calls.find((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('/media'));
    expect(uploadCall).toBeDefined();
  });

  it('topologically sorts parent pages before children', async () => {
    // Deliberately add child before parent in WXR.
    // WxrBuilder assigns IDs starting at 1, so child=1, parent=2.
    // Child references parent=2.
    buildWxrFile(wxrPath, (b) => {
      b.addPage({ title: 'Child', slug: 'child', content: '<p>Child</p>', parent: 2 });
      b.addPage({ title: 'Parent', slug: 'parent', content: '<p>Parent</p>' });
    });

    const creationOrder: string[] = [];
    let nextId = 100;
    const fn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
      if (body.slug) creationOrder.push(body.slug);
      const id = nextId++;
      return {
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({ id, link: `https://wp.example.com/${body.slug || id}` }),
        text: async () => JSON.stringify({ id }),
      };
    });
    vi.stubGlobal('fetch', fn);

    await importToWordPress({
      site: 'wp.example.com',
      username: 'admin',
      token: 'secret',
      wxrFile: wxrPath,
      delay: 0,
    });

    // Parent should be created before child
    const parentIdx = creationOrder.indexOf('parent');
    const childIdx = creationOrder.indexOf('child');
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeGreaterThanOrEqual(0);
    expect(parentIdx).toBeLessThan(childIdx);
  });
});
