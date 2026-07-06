import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WxrBuilder } from './wxr-builder.js';
import { rehydrateBuilderFromWxr } from './wxr-rehydrate.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');
mkdirSync(FIXTURE_TMP, { recursive: true });

function tmpWxr(): string {
  return join(mkdtempSync(join(FIXTURE_TMP, 'rh-')), 'output.wxr');
}

const SITE = 'https://example.com';

describe('rehydrateBuilderFromWxr', () => {
  it('merges prior pages, drops nav_menu_items, and reseeds _nextId past the max id', () => {
    const seed = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' });
    seed.addPage({ title: 'Home', slug: 'home', content: '<p>h</p>', sourceUrl: SITE });
    seed.addPage({ title: 'About', slug: 'about', content: '<p>a</p>', sourceUrl: `${SITE}/about` });
    seed.addMenuItem({ title: 'Home', url: SITE, menuSlug: 'primary' });
    const wxrPath = tmpWxr();
    seed.serialize(wxrPath);

    const fresh = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' });
    const merged = rehydrateBuilderFromWxr(fresh, wxrPath);

    expect(merged).toBe(true);
    // nav_menu_items are intentionally dropped (regenerated each run).
    expect(fresh.items.filter((i) => i.type === 'nav_menu_item')).toHaveLength(0);
    expect(fresh.items.filter((i) => i.type === 'page').map((p) => p.slug).sort()).toEqual(['about', 'home']);

    // _nextId is reseeded past the largest *retained* id so newly added items
    // never collide with rehydrated ones.
    const maxRetainedId = Math.max(...fresh.items.map((i) => i.id));
    expect(fresh._nextId).toBeGreaterThan(maxRetainedId);
    fresh.addPage({ title: 'New', slug: 'new', content: '', sourceUrl: `${SITE}/new` });
    const ids = fresh.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a no-op returning false when there is no prior WXR', () => {
    const fresh = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' });
    const merged = rehydrateBuilderFromWxr(fresh, join(FIXTURE_TMP, 'does-not-exist', 'output.wxr'));
    expect(merged).toBe(false);
    expect(fresh.items).toHaveLength(0);
  });

  it('treats a corrupt prior WXR as a fresh start (returns false, builder untouched)', () => {
    const wxrPath = tmpWxr();
    writeFileSync(wxrPath, '<<< not valid xml at all', 'utf8');
    const fresh = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' });
    fresh.addPage({ title: 'Existing', slug: 'existing', content: '', sourceUrl: SITE });
    const before = fresh.items.length;

    const merged = rehydrateBuilderFromWxr(fresh, wxrPath);

    // Corrupt prior must not throw and must not wipe what the builder already holds.
    expect(merged).toBe(false);
    expect(fresh.items).toHaveLength(before);
  });
});
