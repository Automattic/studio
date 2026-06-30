import { describe, it, expect } from 'vitest';
import { extractMainContent, parseJsonLd, detectTypeFromJsonLd, productLdJsonScript } from './content.js';

describe('extractMainContent', () => {
  it('prefers <main> over surrounding chrome', () => {
    const html = `
      <body>
        <header><h1>Acme Test</h1></header>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <main><p>The fictional widget improves morale by 40 percent.</p></main>
        <footer>Copyright Fictional Co</footer>
      </body>`;
    const out = extractMainContent(html);
    expect(out).toContain('improves morale by 40 percent');
    expect(out).not.toContain('About');
    expect(out).not.toContain('Copyright Fictional Co');
  });

  it('falls back to <article> when there is no <main>', () => {
    const html = `
      <body>
        <nav><a>Home</a></nav>
        <article><p>A short story about a brave little toaster.</p></article>
      </body>`;
    const out = extractMainContent(html);
    expect(out).toContain('brave little toaster');
    expect(out).not.toContain('Home');
  });

  it('falls back to [role="main"] when no <main> or <article>', () => {
    const html = `
      <body>
        <div role="main"><p>Region labelled main via ARIA role.</p></div>
      </body>`;
    expect(extractMainContent(html)).toContain('labelled main via ARIA role');
  });

  it('strips nav/footer/script nested inside the chosen region', () => {
    const html = `
      <main>
        <nav><a>skip me</a></nav>
        <p>Genuine body copy worth keeping.</p>
        <footer>site footer</footer>
        <script>window.tracker = 1;</script>
      </main>`;
    const out = extractMainContent(html);
    expect(out).toContain('Genuine body copy worth keeping');
    expect(out).not.toContain('skip me');
    expect(out).not.toContain('site footer');
    expect(out).not.toContain('window.tracker');
  });

  it('picks the densest text block when there is no landmark', () => {
    const html = `
      <body>
        <div class="rail"><a>Tags</a><a>Archive</a></div>
        <div class="post">
          <p>This is the main article. It has several sentences of real prose.</p>
          <p>Enough text that its density clearly beats the navigation rail.</p>
        </div>
      </body>`;
    const out = extractMainContent(html);
    expect(out).toContain('This is the main article');
    expect(out).not.toContain('Archive');
  });

  it('returns empty string when the body has no textual content', () => {
    expect(extractMainContent('<body><div></div></body>')).toBe('');
  });
});

describe('parseJsonLd', () => {
  it('returns [] when there is no ld+json', () => {
    expect(parseJsonLd('<p>no structured data</p>')).toEqual([]);
  });

  it('parses a single ld+json object', () => {
    const html = `<script type="application/ld+json">{"@type":"WebPage","name":"Home"}</script>`;
    expect(parseJsonLd(html)).toEqual([{ '@type': 'WebPage', name: 'Home' }]);
  });

  it('flattens multiple ld+json scripts in document order', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">{"@type":"WebSite","name":"Acme Site"}</script>`;
    const out = parseJsonLd(html);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ '@type': 'Organization', name: 'Acme' });
  });

  it('flattens a top-level array and unwraps @graph', () => {
    const html = `
      <script type="application/ld+json">[{"@type":"A"},{"@type":"B"}]</script>
      <script type="application/ld+json">{"@graph":[{"@type":"C"}]}</script>`;
    const types = parseJsonLd(html).map((o) => (o as Record<string, unknown>)['@type']);
    expect(types).toEqual(['A', 'B', 'C']);
  });

  it('skips malformed json without throwing', () => {
    const html = `
      <script type="application/ld+json">{ not valid json </script>
      <script type="application/ld+json">{"@type":"Valid"}</script>`;
    expect(parseJsonLd(html)).toEqual([{ '@type': 'Valid' }]);
  });
});

describe('detectTypeFromJsonLd', () => {
  it('detects a product', () => {
    expect(detectTypeFromJsonLd([{ '@type': 'Product', name: 'Gizmo' }])).toBe('product');
  });

  it('detects a blog post / article', () => {
    expect(detectTypeFromJsonLd([{ '@type': 'BlogPosting' }])).toBe('post');
    expect(detectTypeFromJsonLd([{ '@type': 'NewsArticle' }])).toBe('post');
  });

  it('handles @type given as an array', () => {
    expect(detectTypeFromJsonLd([{ '@type': ['Thing', 'Article'] }])).toBe('post');
  });

  it('returns undefined for non content-bearing types', () => {
    expect(detectTypeFromJsonLd([{ '@type': 'WebPage' }])).toBeUndefined();
    expect(detectTypeFromJsonLd([])).toBeUndefined();
  });

  it('prefers product when both product and article are present', () => {
    expect(detectTypeFromJsonLd([{ '@type': 'Article' }, { '@type': 'Product', name: 'X' }])).toBe('product');
  });
});

describe('productLdJsonScript', () => {
  it('returns a parseable ld+json script for the first Product node', () => {
    const script = productLdJsonScript([{ '@type': 'Product', name: 'Gizmo', offers: { price: '9.99' } }]);
    expect(script).toContain('application/ld+json');
    expect(script).toContain('"@type":"Product"');
    expect(script).toContain('Gizmo');
  });

  it('returns null when there is no product', () => {
    expect(productLdJsonScript([{ '@type': 'Article' }])).toBeNull();
  });
});
