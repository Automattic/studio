import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ingestLocalSite, slugFromRelPath } from './ingest.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

function makeSite(files: Record<string, string>): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const dir = mkdtempSync(join(FIXTURE_TMP, 'ingest-'));
  for (const [rel, html] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, html);
  }
  return dir;
}

describe('slugFromRelPath', () => {
  it('derives stable slugs from relative paths', () => {
    expect(slugFromRelPath('index.html')).toBe('home');
    expect(slugFromRelPath('about.html')).toBe('about');
    expect(slugFromRelPath('blog/p.html')).toBe('blog-p');
    expect(slugFromRelPath('blog/index.html')).toBe('blog');
    expect(slugFromRelPath('blog/Index.html')).toBe('blog');
  });

  it('falls back to "home" for an empty path', () => {
    expect(slugFromRelPath('')).toBe('home');
  });

  it('sanitizes segments to slug-safe characters', () => {
    expect(slugFromRelPath('about us.html')).toBe('about-us');
    expect(slugFromRelPath('café.html')).toBe('caf');
    expect(slugFromRelPath('my blog/some post.html')).toBe('my-blog-some-post');
  });
});

describe('ingestLocalSite', () => {
  it('enumerates html pages, derives slugs, extracts titles', () => {
    const dir = makeSite({
      'index.html': '<html><head><title>Home</title></head><body><main><h1>Hi</h1></main></body></html>',
      'about.html': '<html><head><title>About Us</title></head><body><main><h1>About</h1></main></body></html>',
    });
    try {
      const site = ingestLocalSite(dir);
      const slugs = site.pages.map((p) => p.slug).sort();
      expect(slugs).toEqual(['about', 'home']);
      const home = site.pages.find((p) => p.slug === 'home');
      expect(home?.title).toBe('Home');
      expect(home?.relPath).toBe('index.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on a directory with no html', () => {
    const dir = makeSite({ 'styles.css': 'body{}' });
    try {
      expect(() => ingestLocalSite(dir)).toThrow(/no html pages/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on a slug collision between distinct files', () => {
    const dir = makeSite({
      'blog/p.html': '<html><head><title>Post</title></head><body><main>a</main></body></html>',
      'blog-p.html': '<html><head><title>Other</title></head><body><main>b</main></body></html>',
    });
    try {
      expect(() => ingestLocalSite(dir)).toThrow(/slug collision/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips symlinked entries (including cycles) without crashing', () => {
    const dir = makeSite({
      'index.html': '<html><head><title>Home</title></head><body><main>hi</main></body></html>',
    });
    try {
      try {
        // Circular link: dir/loop → .. (the parent contains dir itself).
        symlinkSync('..', join(dir, 'loop'));
      } catch {
        // Platform forbids symlink creation — the cycle assertion is moot;
        // ingest of the real files below still verifies.
      }
      const site = ingestLocalSite(dir);
      expect(site.pages.map((p) => p.slug)).toEqual(['home']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
