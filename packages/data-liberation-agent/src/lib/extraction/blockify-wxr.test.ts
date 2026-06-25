import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WxrBuilder, type WxrItem } from '../wxr/index.js';
import { readWxr } from '../wxr/index.js';
import { blockifyWxrBodies, blockifyWxrFile } from './blockify-wxr.js';
import type { AdapterBlocks } from '../../adapters/page-actions.js';

// Converts any body containing CONVERT into a single paragraph block; null otherwise.
const RECIPE: AdapterBlocks = {
  htmlToBlocks: (html) =>
    html.includes('CONVERT') ? '<!-- wp:paragraph -->\n<p>converted</p>\n<!-- /wp:paragraph -->' : null,
};

function countByType(items: WxrItem[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const i of items) c[i.type] = (c[i.type] ?? 0) + 1;
  return c;
}

describe('blockifyWxrBodies', () => {
  it('converts post/page bodies the recipe handles and leaves the rest verbatim', () => {
    const items = [
      { id: 1, type: 'post', title: 'a', slug: 'a', content: '<div>CONVERT</div>', sourceUrl: 'https://x/a' },
      { id: 2, type: 'post', title: 'b', slug: 'b', content: '<p>plain</p>', sourceUrl: 'https://x/b' },
      { id: 3, type: 'page', title: 'c', slug: 'c', content: 'CONVERT', sourceUrl: '' },
    ] as unknown as WxrItem[];
    expect(blockifyWxrBodies(items, RECIPE)).toBe(2);
    expect((items[0] as unknown as { content: string }).content).toContain('wp:paragraph');
    expect((items[1] as unknown as { content: string }).content).toBe('<p>plain</p>'); // verbatim
    expect((items[2] as unknown as { content: string }).content).toContain('wp:paragraph');
  });

  it('never touches non-content items (attachment, nav_menu_item)', () => {
    const nav = { id: 1, type: 'nav_menu_item', title: 'Home', url: 'https://x/' } as unknown as WxrItem;
    const att = { id: 2, type: 'attachment', title: 'img', url: 'https://x/i.jpg' } as unknown as WxrItem;
    const items = [nav, att];
    expect(blockifyWxrBodies(items, RECIPE)).toBe(0);
    expect(items[0]).toBe(nav);
    expect(items[1]).toBe(att);
  });

  it('returns 0 when the recipe converts nothing', () => {
    const items = [
      { id: 1, type: 'post', title: 'a', slug: 'a', content: '<p>plain</p>', sourceUrl: '' },
    ] as unknown as WxrItem[];
    expect(blockifyWxrBodies(items, RECIPE)).toBe(0);
  });
});

describe('blockifyWxrFile — lossless round-trip', () => {
  const dir = join(process.cwd(), '.tmp-test', 'blockify-wxr');
  const wxrPath = join(dir, 'output.wxr');

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('converts post/page bodies and preserves every other item (incl. nav menu)', () => {
    const wxr = new WxrBuilder({ title: 'Demo', url: 'https://demo.test', description: 'd', language: 'en-US' }, { contentStatus: 'publish' });
    wxr.addCategory({ slug: 'news', name: 'News' });
    wxr.addPost({ title: 'Convertible', slug: 'conv', content: '<div>CONVERT this body</div>', sourceUrl: 'https://demo.test/conv', categories: ['news'], seoTitle: 'SEO conv' });
    wxr.addPost({ title: 'Plain', slug: 'plain', content: '<p>nothing special</p>', sourceUrl: 'https://demo.test/plain' });
    wxr.addPage({ title: 'About', slug: 'about', content: '<p>about us</p>', sourceUrl: 'https://demo.test/about' });
    wxr.addMedia({ title: 'pic', slug: 'pic', url: 'https://demo.test/pic.jpg', localPath: '/x/pic.jpg', altText: 'pic' });
    // Inject a nav menu item directly — it's the one type rehydrateBuilderFromWxr
    // drops, so its survival is the key proof that blockifyWxrFile keeps all items.
    wxr.items.push({ id: 990, type: 'nav_menu_item', title: 'Home', slug: 'home', url: 'https://demo.test/', menuSlug: 'primary', parent: 0, menuOrder: 1 } as unknown as WxrItem);
    wxr.serialize(wxrPath);

    const before = readWxr(wxrPath);
    const beforeCounts = countByType(before.items);
    expect(beforeCounts.nav_menu_item).toBe(1); // sanity: nav round-tripped through serialize

    // CRITICAL: status must survive. readWxr doesn't parse <wp:status> and a
    // no-opts builder defaults to draft, so blockify must recover + keep publish.
    const publishBefore = (readFileSync(wxrPath, 'utf8').match(/<wp:status>publish<\/wp:status>/g) || []).length;
    expect(publishBefore).toBeGreaterThan(0); // posts/pages/nav serialize as publish (only attachments are 'inherit')

    const res = blockifyWxrFile(wxrPath, RECIPE);
    expect(res.converted).toBe(1); // only the convertible post
    expect(res.postsAndPages).toBe(3);

    const publishAfter = (readFileSync(wxrPath, 'utf8').match(/<wp:status>publish<\/wp:status>/g) || []).length;
    expect(publishAfter).toBe(publishBefore); // preserved — NOT silently downgraded to draft

    const after = readWxr(wxrPath);
    // Nothing dropped: identical per-type counts (incl. nav_menu_item) + categories.
    expect(countByType(after.items)).toEqual(beforeCounts);
    expect(after.categories.length).toBe(before.categories.length);

    const conv = after.items.find((i) => i.slug === 'conv')!;
    const plain = after.items.find((i) => i.slug === 'plain')!;
    const about = after.items.find((i) => i.slug === 'about')!;
    expect((conv as unknown as { content: string }).content).toContain('wp:paragraph'); // converted
    expect((conv as unknown as { seoTitle?: string }).seoTitle).toBe('SEO conv'); // postmeta preserved
    expect((plain as unknown as { content: string }).content).toContain('nothing special'); // verbatim
    expect((about as unknown as { content: string }).content).toContain('about us'); // page verbatim
  });
});
