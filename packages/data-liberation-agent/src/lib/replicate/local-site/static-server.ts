// src/lib/replicate/local-site/static-server.ts
//
// Sandboxed clean-URL static server for the owned-source pipeline. Serves the
// local site so (a) Playwright captures real http pages (file:// breaks some
// asset/CSS behavior) and (b) source pathnames ALIGN WITH WP PERMALINKS —
// compareScreenshotDirs joins origin/replica by pathname, so "/about/" must
// resolve on both sides. Mapping: "/" → index.html; "/x/" or "/x" → x.html
// (when not a real file); real files (styles.css, blog/post.html) serve as-is.
//
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, extname, sep } from 'node:path';

export interface StaticServer {
  url: string;
  port: number;
  close(): Promise<void>;
  /** Clean URL for a page slug: home → "<url>/", about → "<url>/about/". */
  pageUrl(slug: string): string;
  /**
   * Clean URL for a page's source relPath — preserves nesting so the URL
   * actually resolves: "blog/post.html" → "<url>/blog/post/" (whereas
   * pageUrl on the flattened slug "blog-post" would 404). "index.html" →
   * "<url>/", "blog/index.html" → "<url>/blog/".
   */
  urlForPage(relPath: string): string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Resolve a request path to an on-disk file inside root, or null. */
export function resolveRequestPath(root: string, rawPath: string): string | null {
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(rawPath.split(/[?#]/)[0]);
  } catch {
    return null; // malformed encoding → 404
  }
  const rel = normalize(cleaned).replace(/^\/+/, '');
  const abs = resolve(root, rel);
  if (abs !== resolve(root) && !abs.startsWith(resolve(root) + '/')) return null; // traversal
  // exact file (styles.css, blog/post.html)
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  // directory → index.html
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const idx = join(abs, 'index.html');
    return existsSync(idx) ? idx : null;
  }
  // clean URL: /about/ or /about → about.html ; /blog/post/ → blog/post.html
  const noSlash = rel.replace(/\/+$/, '');
  if (noSlash) {
    const html = resolve(root, `${noSlash}.html`);
    if (html.startsWith(resolve(root) + '/') && existsSync(html)) return html;
  } else {
    const idx = resolve(root, 'index.html');
    if (existsSync(idx)) return idx;
  }
  // Relative-asset fallback for clean URLs: a page served at /contact/ whose
  // HTML says href="styles.css" requests /contact/styles.css — under the
  // original .html serving that path meant <page dir>/styles.css. Re-resolve
  // ASSET paths (non-.html, has an extension) by progressively stripping
  // leading segments until a real file is found. Each candidate re-passes the
  // sandbox guard.
  const ext = extname(noSlash);
  if (ext && ext !== '.html' && ext !== '.htm') {
    const segs = noSlash.split('/');
    for (let i = 1; i < segs.length; i++) {
      const candidate = resolve(root, segs.slice(i).join('/'));
      if (
        candidate.startsWith(resolve(root) + '/') &&
        existsSync(candidate) &&
        statSync(candidate).isFile()
      ) {
        return candidate;
      }
    }
  }
  return null;
}

export function startStaticServer(root: string): Promise<StaticServer> {
  const absRoot = resolve(root);
  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer((req, res) => {
      const file = resolveRequestPath(absRoot, req.url ?? '/');
      if (!file) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}`;
      resolvePromise({
        url,
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
        pageUrl: (slug: string) => (slug === 'home' ? `${url}/` : `${url}/${slug}/`),
        urlForPage: (relPath: string) => {
          const noExt = relPath.replace(/\.html?$/i, '');
          const parts = noExt.split(sep).filter(Boolean);
          const last = parts[parts.length - 1]?.toLowerCase();
          if (last === 'index') {
            return parts.length <= 1 ? `${url}/` : `${url}/${parts.slice(0, -1).join('/')}/`;
          }
          return parts.length === 0 ? `${url}/` : `${url}/${parts.join('/')}/`;
        },
      });
    });
  });
}
