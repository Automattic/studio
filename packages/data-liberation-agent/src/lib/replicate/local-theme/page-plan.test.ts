// src/lib/replicate/local-theme/page-plan.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildPagePlan } from './page-plan.js';
import type { LocalSite } from '../local-site/types.js';

const FIXTURE_TMP = join(process.cwd(), '.tmp-test');

function makeSidecars(slugs: string[]): string {
  mkdirSync(FIXTURE_TMP, { recursive: true });
  const out = mkdtempSync(join(FIXTURE_TMP, 'plan-'));
  mkdirSync(join(out, 'composed'), { recursive: true });
  for (const slug of slugs) {
    writeFileSync(join(out, 'composed', `${slug}.blocks.html`), `<!-- wp:paragraph -->\n<p>${slug}</p>\n<!-- /wp:paragraph -->`);
  }
  return out;
}

const site: LocalSite = {
  root: '/site',
  pages: [
    { relPath: 'index.html', slug: 'home', html: '', title: 'Home' },
    { relPath: 'about.html', slug: 'about', html: '', title: 'About Us' },
  ],
};

describe('buildPagePlan', () => {
  it('builds one PageItem per page with sidecar content and synthetic sourceUrl', () => {
    const out = makeSidecars(['home', 'about']);
    try {
      const plan = buildPagePlan(site, out);
      expect(plan.items).toHaveLength(2);
      const about = plan.items.find((i) => i.slug === 'about');
      expect(about?.type).toBe('page');
      expect(about?.title).toBe('About Us');
      expect(about?.content).toContain('<p>about</p>');
      expect(about?.sourceUrl).toBe('local-site:/site#about');
      expect(plan.homeSlug).toBe('home');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('reports pages whose sidecar is missing instead of throwing', () => {
    const out = makeSidecars(['home']); // no about sidecar
    try {
      const plan = buildPagePlan(site, out);
      expect(plan.items.map((i) => i.slug)).toEqual(['home']);
      expect(plan.missingSidecars).toEqual(['about']);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('sets homeSlug null and includes home in missingSidecars when home sidecar is missing', () => {
    const out = makeSidecars(['about']); // no home sidecar
    try {
      const plan = buildPagePlan(site, out);
      expect(plan.homeSlug).toBeNull();
      expect(plan.missingSidecars).toContain('home');
      expect(plan.items.map((i) => i.slug)).toEqual(['about']);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('uses the slug as title when the page <title> is empty', () => {
    const out = makeSidecars(['home', 'about']);
    const untitled: LocalSite = { ...site, pages: site.pages.map((p) => ({ ...p, title: '' })) };
    try {
      const plan = buildPagePlan(untitled, out);
      expect(plan.items.find((i) => i.slug === 'about')?.title).toBe('about');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
