import { describe, it, expect } from 'vitest';
import { patchWxrTemplates } from './wxr-template-patch.js';

// Fictional WXR item builder (never real source content).
function item(f: { type: string; name: string; content?: string; meta?: [string, string][] }): string {
  const meta = (f.meta ?? []).map(([k, v]) =>
    `<wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value><![CDATA[${v}]]></wp:meta_value></wp:postmeta>`).join('');
  return `<item><wp:post_type>${f.type}</wp:post_type><wp:post_name>${f.name}</wp:post_name>`
    + `<content:encoded><![CDATA[${f.content ?? 'OLD'}]]></content:encoded>${meta}</item>`;
}
const wxr = (items: string[]) => `<rss><channel>${items.join('')}</channel></rss>`;

describe('patchWxrTemplates', () => {
  it('replaces content:encoded and upserts _wp_page_template for matched slugs', () => {
    const src = wxr([item({ type: 'page', name: 'about' }), item({ type: 'page', name: 'shop' })]);
    const { wxr: out, result } = patchWxrTemplates(src, [
      { slug: 'about', content: 'NEW-ABOUT', templateSlug: null },
      { slug: 'shop', content: 'NEW-SHOP', templateSlug: 'page-replica-full' },
    ]);
    expect(out).toContain('<![CDATA[NEW-ABOUT]]>');
    expect(out).toContain('<![CDATA[NEW-SHOP]]>');
    expect(out).toContain('<wp:meta_key>_wp_page_template</wp:meta_key><wp:meta_value><![CDATA[page-replica-full]]>');
    expect(result.contentPatched).toBe(2);
    expect(result.metaSet).toBe(1);
    expect(result.unmatched).toEqual([]);
  });

  it('is idempotent — re-running does not duplicate the meta', () => {
    const src = wxr([item({ type: 'page', name: 'shop' })]);
    const once = patchWxrTemplates(src, [{ slug: 'shop', content: 'X', templateSlug: 'page-replica-full' }]).wxr;
    const twice = patchWxrTemplates(once, [{ slug: 'shop', content: 'X', templateSlug: 'page-replica-full' }]).wxr;
    expect((twice.match(/_wp_page_template/g) || []).length).toBe(1);
    expect(twice).toBe(once);
  });

  it('clears a stale assignment when templateSlug is null', () => {
    const src = wxr([item({ type: 'page', name: 'shop', meta: [['_wp_page_template', 'page-replica-full']] })]);
    const { wxr: out, result } = patchWxrTemplates(src, [{ slug: 'shop', content: 'X', templateSlug: null }]);
    expect(out).not.toContain('_wp_page_template');
    expect(result.metaCleared).toBe(1);
  });

  it('CDATA-escapes ]]> in reconstructed content', () => {
    const src = wxr([item({ type: 'page', name: 'shop' })]);
    const { wxr: out } = patchWxrTemplates(src, [{ slug: 'shop', content: 'a]]>b', templateSlug: null }]);
    expect(out).toContain(']]]]><![CDATA[>');
    expect((out.match(/<!\[CDATA\[/g) || []).length).toBe((out.match(/]]>/g) || []).length);
  });

  it('inserts meta before the REAL closing tag even when content contains </item>', () => {
    const src = wxr([item({ type: 'page', name: 'shop' })]);
    const { wxr: out } = patchWxrTemplates(src, [{ slug: 'shop', content: 'a</item>b', templateSlug: 'page-replica-full' }]);
    // The meta must come AFTER the content's CDATA close, not inside it.
    const metaIdx = out.indexOf('<wp:meta_key>_wp_page_template');
    const cdataCloseIdx = out.indexOf(']]></content:encoded>');
    expect(metaIdx).toBeGreaterThan(cdataCloseIdx);
    // And exactly one real item close remains structurally valid.
    expect(out.endsWith('</item></channel></rss>')).toBe(true);
  });

  it('counts unmatched slugs and leaves siblings untouched', () => {
    const src = wxr([item({ type: 'page', name: 'about', content: 'KEEP' })]);
    const { wxr: out, result } = patchWxrTemplates(src, [{ slug: 'ghost', content: 'X', templateSlug: null }]);
    expect(result.unmatched).toEqual(['ghost']);
    expect(out).toContain('<![CDATA[KEEP]]>');
  });

  it('reports existing assignments (for the reconcile guard)', () => {
    const src = wxr([item({ type: 'page', name: 'a', meta: [['_wp_page_template', 'page-replica-overlay']] })]);
    const { result } = patchWxrTemplates(src, []);
    expect(result.existingAssignments.get('a')).toBe('page-replica-overlay');
  });
});
