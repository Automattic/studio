import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startStaticServer, resolveRequestPath, type StaticServer } from './static-server.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

let server: StaticServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function makeSite(): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'serve-'));
  writeFileSync(join(dir, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(dir, 'about.html'), '<h1>about</h1>');
  writeFileSync(join(dir, 'styles.css'), 'body{color:red}');
  mkdirSync(join(dir, 'blog'), { recursive: true });
  writeFileSync(join(dir, 'blog', 'post.html'), '<h1>post</h1>');
  return dir;
}

describe('startStaticServer', () => {
  it('serves clean URLs aligned with WP permalinks', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      const get = async (p: string) => {
        const res = await fetch(server!.url + p);
        return { status: res.status, body: await res.text(), type: res.headers.get('content-type') ?? '' };
      };
      expect((await get('/')).body).toContain('home');
      expect((await get('/about/')).body).toContain('about');     // clean URL → about.html
      expect((await get('/about.html')).body).toContain('about'); // raw path still works
      expect((await get('/blog/post/')).body).toContain('post');  // nested clean URL
      const css = await get('/styles.css');
      expect(css.body).toContain('color:red');
      expect(css.type).toContain('text/css');
      expect((await get('/missing/')).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects path traversal', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      const res = await fetch(server.url + '/../../etc/passwd');
      expect([403, 404]).toContain(res.status); // fetch may normalize; raw socket below is the real probe
      // raw request bypassing fetch normalization:
      const { request } = await import('node:http');
      const status = await new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port: server!.port, path: '/..%2f..%2fetc%2fpasswd' }, (r) => resolve(r.statusCode ?? 0));
        req.end();
      });
      expect([403, 404]).toContain(status);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps slugs to clean URLs via pageUrl', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      expect(server.pageUrl('home')).toBe(`${server.url}/`);
      expect(server.pageUrl('about')).toBe(`${server.url}/about/`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps relPaths to clean URLs via urlForPage (nested pages resolve)', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      expect(server.urlForPage('index.html')).toBe(`${server.url}/`);
      expect(server.urlForPage('about.html')).toBe(`${server.url}/about/`);
      expect(server.urlForPage('blog/post.html')).toBe(`${server.url}/blog/post/`);
      expect(server.urlForPage('blog/index.html')).toBe(`${server.url}/blog/`);
      // the nested URL it emits actually serves the right file
      const res = await fetch(server.urlForPage('blog/post.html'));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('post');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('survives malformed percent-encoding with a 404', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      const { request } = await import('node:http');
      const rawGet = (path: string) =>
        new Promise<number>((resolve) => {
          const req = request({ host: '127.0.0.1', port: server!.port, path }, (r) => resolve(r.statusCode ?? 0));
          req.end();
        });
      expect(await rawGet('/%zz')).toBe(404); // malformed → 404, no crash
      const after = await fetch(`${server.url}/about/`); // server still alive
      expect(after.status).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveRequestPath', () => {
  it('returns null on malformed percent-encoding', () => {
    const dir = makeSite();
    try {
      expect(resolveRequestPath(dir, '/%zz')).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('relative-asset fallback under clean URLs', () => {
  it('resolves /about/styles.css to the root styles.css (relative href from a clean URL)', async () => {
    const dir = makeSite();
    try {
      server = await startStaticServer(dir);
      const res = await fetch(`${server.url}/about/styles.css`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('color:red');
      // nested page asset: /blog/post/styles.css → root styles.css too
      const nested = await fetch(`${server.url}/blog/post/styles.css`);
      expect(nested.status).toBe(200);
      // html paths never use the fallback (clean-URL semantics preserved)
      const html = await fetch(`${server.url}/about/index.html`);
      expect(html.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
