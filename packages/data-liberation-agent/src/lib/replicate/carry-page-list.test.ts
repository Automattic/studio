import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { joinCarryPageList, slimWxr, reconcileCarryIslands } from './carry-page-list.js';

describe('reconcileCarryIslands', () => {
  const dir = join('.tmp-test', 'reconcile-islands');
  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('removes stale islands not in the current set; keeps current + _swap.php', () => {
    for (const f of ['home.html', 'about.html', 'grief-and-loss.html', 'world-teacher-day.html']) {
      writeFileSync(join(dir, f), 'island');
    }
    writeFileSync(join(dir, '_swap.php'), '<?php');
    const removed = reconcileCarryIslands(dir, ['home', 'about']);
    expect(removed.sort()).toEqual(['grief-and-loss', 'world-teacher-day']);
    expect(readdirSync(dir).sort()).toEqual(['_swap.php', 'about.html', 'home.html']);
  });

  it('keeps everything when all islands are in the current set', () => {
    writeFileSync(join(dir, 'home.html'), 'x');
    writeFileSync(join(dir, 'about.html'), 'x');
    expect(reconcileCarryIslands(dir, ['home', 'about', 'extra'])).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['about.html', 'home.html']);
  });

  it('is a no-op when the dir does not exist', () => {
    expect(reconcileCarryIslands(join('.tmp-test', 'reconcile-missing'), ['a'])).toEqual([]);
  });
});

/** Minimal WXR `<item>` — fictional data only (never real source content). */
function item(f: { type: string; name?: string; title?: string; link?: string }): string {
  return [
    '<item>',
    `<title>${f.title ?? ''}</title>`,
    `<link>${f.link ?? ''}</link>`,
    `<wp:post_type>${f.type}</wp:post_type>`,
    `<wp:post_name>${f.name ?? ''}</wp:post_name>`,
    '</item>',
  ].join('\n');
}
const wxr = (items: string[]) => `<rss><channel>\n${items.join('\n')}\n</channel></rss>`;

describe('joinCarryPageList', () => {
  const BASE = wxr([
    item({ type: 'page', name: 'home', title: 'Home', link: 'https://fictional.example/' }),
    item({ type: 'page', name: 'about', title: 'About', link: 'https://fictional.example/about' }),
    item({ type: 'post', name: 'hello-world', title: 'Hello', link: 'https://fictional.example/hello-world' }),
    item({ type: 'attachment', name: '', link: 'https://fictional.example/x.jpg' }),
    item({ type: 'nav_menu_item', name: '' }),
  ]);
  const ENTRIES = {
    'https://fictional.example/': { slug: 'homepage' },
    'https://fictional.example/about': { slug: 'about' },
    'https://fictional.example/post/hello-world': { slug: 'post--hello-world' },
  };
  const STEMS = new Set(['homepage', 'about', 'post--hello-world']);

  it('joins pages + posts, flags the homepage, ignores attachments/nav', () => {
    const { pages, skipped, excluded } = joinCarryPageList(BASE, ENTRIES, STEMS);
    expect(pages).toHaveLength(3);
    expect(skipped).toHaveLength(0);
    expect(excluded).toHaveLength(0);
    expect(pages.find((p) => p.isHome)).toMatchObject({ slug: 'home', htmlSlug: 'homepage', postType: 'page' });
    expect(pages.find((p) => p.postType === 'post')).toMatchObject({ slug: 'hello-world', htmlSlug: 'post--hello-world' });
    expect(pages.find((p) => p.slug === 'about')).toMatchObject({ htmlSlug: 'about', postType: 'page' });
  });

  it('honors the exclude set (by slug)', () => {
    const { pages, excluded } = joinCarryPageList(BASE, ENTRIES, STEMS, { exclude: ['about'] });
    expect(pages.map((p) => p.slug).sort()).toEqual(['hello-world', 'home']);
    expect(excluded.map((p) => p.slug)).toEqual(['about']);
  });

  it('falls back to the last `--` segment for Shopify/Squarespace namespaced slugs', () => {
    const w = wxr([item({ type: 'page', name: 'contact', title: 'Contact', link: 'https://fictional.example/pages/contact' })]);
    const { pages } = joinCarryPageList(w, { 'https://fictional.example/pages/contact': { slug: 'pages--contact' } }, new Set(['pages--contact']));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ slug: 'contact', htmlSlug: 'pages--contact' });
  });

  it('skips items with no captured html (logged, not dropped silently)', () => {
    const w = wxr([item({ type: 'page', name: 'ghost', title: 'Ghost', link: 'https://fictional.example/ghost' })]);
    const { pages, skipped } = joinCarryPageList(w, {}, new Set());
    expect(pages).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ postName: 'ghost', reason: 'no-manifest-match' });
  });

  it('does NOT match a page against a WooCommerce `products--*` manifest slug', () => {
    const w = wxr([item({ type: 'page', name: 'widget', title: 'Widget', link: 'https://fictional.example/widget' })]);
    const { pages, skipped } = joinCarryPageList(w, { 'https://fictional.example/products/widget': { slug: 'products--widget' } }, new Set(['products--widget']));
    expect(pages).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});

describe('slimWxr', () => {
  const statusItem = (type: string, status: string) =>
    `<item><wp:post_type>${type}</wp:post_type><wp:status>${status}</wp:status></item>`;

  it('drops attachment items, flips draft→publish, and keeps pages/posts/nav', () => {
    const src = `<rss><channel>\n${[
      statusItem('page', 'draft'),
      statusItem('post', 'draft'),
      statusItem('attachment', 'inherit'),
      statusItem('attachment', 'inherit'),
      statusItem('nav_menu_item', 'publish'),
    ].join('\n')}\n</channel></rss>`;
    const { wxr: out, dropped, flipped } = slimWxr(src);
    expect(dropped).toBe(2); // both attachments
    expect(flipped).toBe(2); // page + post
    expect(out).not.toContain('attachment');
    expect(out).not.toContain('<wp:status>draft</wp:status>');
    expect((out.match(/<item>/g) || []).length).toBe(3); // page, post, nav kept
  });

  it('is a no-op on a WXR with no attachments or drafts', () => {
    const src = `<rss><channel>\n${statusItem('page', 'publish')}\n</channel></rss>`;
    const { wxr: out, dropped, flipped } = slimWxr(src);
    expect(dropped).toBe(0);
    expect(flipped).toBe(0);
    expect(out).toBe(src);
  });
});
