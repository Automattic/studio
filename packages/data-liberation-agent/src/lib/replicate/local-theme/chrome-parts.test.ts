// src/lib/replicate/local-theme/chrome-parts.test.ts
import { describe, expect, it } from 'vitest';
import { buildCarriedSidebarPart } from './chrome-parts.js';
import type { Section } from '../local-site/types.js';

function section(html: string): Section {
  return {
    id: 'sidebar',
    role: 'nav',
    classes: ['layout-rail'],
    html,
  };
}

describe('buildCarriedSidebarPart', () => {
  it('preserves source sidebar structure instead of converting it to blocks', () => {
    const html = buildCarriedSidebarPart(section(`
      <aside class="docs-rail">
        <nav class="sidebar-nav"><a href="docs.html">Docs</a></nav>
        <ol class="toc-list"><li><a href="#intro">Intro</a></li></ol>
      </aside>
    `));

    expect(html).toContain('<aside class="docs-rail">');
    expect(html).toContain('<nav class="sidebar-nav">');
    expect(html).toContain('<ol class="toc-list">');
    expect(html).not.toContain('<!-- wp:');
  });

  it('rewrites known internal sidebar hrefs to WordPress permalinks', () => {
    const html = buildCarriedSidebarPart(
      section(
        '<aside><nav>' +
          '<a href="docs.html">Docs</a>' +
          '<a href="index.html">Home</a>' +
          '<a href="https://example.com">External</a>' +
          '</nav></aside>',
      ),
      { pageSlugs: ['home', 'docs'] },
    );

    expect(html).toContain('href="/docs/"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('docs.html');
    expect(html).not.toContain('index.html');
  });

  it('trims carried sidebar markup without otherwise changing it', () => {
    expect(buildCarriedSidebarPart(section('  <aside class="rail">Links</aside>\n'))).toBe(
      '<aside class="rail">Links</aside>',
    );
  });
});
