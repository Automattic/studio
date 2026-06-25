import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WxrBuilder, type WxrBuilderOpts } from './index.js';

const SITE = 'https://example.com';
const TMP = join(process.cwd(), '.tmp-test');
mkdirSync(TMP, { recursive: true });

function buildXml(opts?: WxrBuilderOpts): string {
  const dir = mkdtempSync(join(TMP, 'wxr-status-'));
  try {
    const w = new WxrBuilder({ title: 'Example', url: SITE, language: 'en-US' }, opts);
    w.addPage({ title: 'About', slug: 'about', content: '<p>a</p>', sourceUrl: `${SITE}/about` });
    w.addPost({ title: 'Hello', slug: 'hello', content: '<p>h</p>', sourceUrl: `${SITE}/hello` });
    w.addMedia({ title: 'Img', slug: 'img', url: `${SITE}/img.jpg`, altText: '', caption: '' });
    w.addMenuItem({ title: 'Home', url: SITE, menuSlug: 'primary' });
    const out = join(dir, 'output.wxr');
    w.serialize(out);
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function statusNear(xml: string, postType: string): string | null {
  const idx = xml.indexOf(`<wp:post_type>${postType}</wp:post_type>`);
  if (idx === -1) return null;
  const m = xml.slice(idx - 700, idx + 60).match(/<wp:status>([^<]+)<\/wp:status>/g);
  return m ? m[m.length - 1] : null;
}

describe('WxrBuilder post status', () => {
  it('DEFAULTS pages/posts to draft (documented "import as drafts" convention)', () => {
    const xml = buildXml();
    expect(statusNear(xml, 'page')).toContain('draft');
    expect(statusNear(xml, 'post')).toContain('draft');
  });

  it('attachments always use WP inherit convention (regardless of contentStatus)', () => {
    expect(statusNear(buildXml(), 'attachment')).toContain('inherit');
    expect(statusNear(buildXml({ contentStatus: 'publish' }), 'attachment')).toContain('inherit');
  });

  it('publishes pages/posts when contentStatus="publish" (replica/preview flow)', () => {
    const xml = buildXml({ contentStatus: 'publish' });
    expect(statusNear(xml, 'page')).toContain('publish');
    expect(statusNear(xml, 'post')).toContain('publish');
    expect(xml).not.toContain('<wp:status>draft</wp:status>');
  });
});
