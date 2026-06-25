import { describe, it, expect } from 'vitest';
import { buildNavGraph } from './nav-graph.js';
import type { LocalSite } from './types.js';

function site(pages: Array<{ slug: string; relPath: string; html: string }>): LocalSite {
  return { root: '/x', pages: pages.map((p) => ({ ...p, title: p.slug })) };
}

describe('buildNavGraph', () => {
  it('records internal links by target slug and ignores external ones', () => {
    const s = site([
      { slug: 'home', relPath: 'index.html', html: '<a href="about.html">About</a><a href="https://x.com">Ext</a>' },
      { slug: 'about', relPath: 'about.html', html: '<a href="index.html">Home</a>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'home', toSlug: 'about', label: 'About' });
    expect(links).toContainEqual({ fromSlug: 'about', toSlug: 'home', label: 'Home' });
    expect(links.some((l) => l.label === 'Ext')).toBe(false);
  });

  it('drops links to unknown targets', () => {
    const s = site([{ slug: 'home', relPath: 'index.html', html: '<a href="missing.html">X</a>' }]);
    expect(buildNavGraph(s)).toEqual([]);
  });

  it('resolves href="/" to the homepage without crashing', () => {
    const s = site([
      { slug: 'home', relPath: 'index.html', html: '<p>hi</p>' },
      { slug: 'about', relPath: 'about.html', html: '<a href="/">Home</a>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'about', toSlug: 'home', label: 'Home' });
  });

  it('resolves ./-prefixed hrefs', () => {
    const s = site([
      { slug: 'home', relPath: 'index.html', html: '<a href="./about.html">About</a>' },
      { slug: 'about', relPath: 'about.html', html: '<p>hi</p>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'home', toSlug: 'about', label: 'About' });
  });

  it('resolves ../-prefixed hrefs from nested pages', () => {
    const s = site([
      { slug: 'home', relPath: 'index.html', html: '<p>hi</p>' },
      { slug: 'blog-post', relPath: 'blog/post.html', html: '<a href="../index.html">Home</a>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'blog-post', toSlug: 'home', label: 'Home' });
  });

  it('resolves root-relative hrefs from nested pages', () => {
    const s = site([
      { slug: 'about', relPath: 'about.html', html: '<p>hi</p>' },
      { slug: 'blog-post', relPath: 'blog/post.html', html: '<a href="/about.html">About</a>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'blog-post', toSlug: 'about', label: 'About' });
  });

  it('resolves percent-encoded and raw-space hrefs to pages with sanitized slugs', () => {
    const s = site([
      {
        slug: 'home',
        relPath: 'index.html',
        html: '<a href="about%20us.html">About</a><a href="about us.html">About raw</a>',
      },
      { slug: 'about-us', relPath: 'about us.html', html: '<p>hi</p>' },
    ]);
    const links = buildNavGraph(s);
    expect(links).toContainEqual({ fromSlug: 'home', toSlug: 'about-us', label: 'About' });
    expect(links).toContainEqual({ fromSlug: 'home', toSlug: 'about-us', label: 'About raw' });
  });

  it('marks links inside a <nav> element with inNav', () => {
    const s = site([
      {
        slug: 'home',
        relPath: 'index.html',
        html: '<header><a class="brand" href="index.html">Brand Co</a><nav><a href="index.html">Home</a><a href="about.html">About</a></nav></header>',
      },
      { slug: 'about', relPath: 'about.html', html: '' },
    ]);
    const links = buildNavGraph(s);
    expect(links.find((l) => l.label === 'Brand Co')?.inNav).toBeFalsy();
    expect(links.find((l) => l.label === 'Home')?.inNav).toBe(true);
    expect(links.find((l) => l.label === 'About')?.inNav).toBe(true);
  });

  it('does not mark footer <nav> links as inNav', () => {
    const s = site([
      { slug: 'home', relPath: 'index.html', html: '<header><nav><a href="index.html">Home</a><a href="about.html">About</a></nav></header><footer><nav><a href="privacy.html">Privacy</a></nav></footer>' },
      { slug: 'about', relPath: 'about.html', html: '' },
      { slug: 'privacy', relPath: 'privacy.html', html: '' },
    ]);
    const links = buildNavGraph(s);
    expect(links.find((l) => l.label === 'Privacy')?.inNav).toBeFalsy();
    expect(links.find((l) => l.label === 'Home')?.inNav).toBe(true);
  });
});
