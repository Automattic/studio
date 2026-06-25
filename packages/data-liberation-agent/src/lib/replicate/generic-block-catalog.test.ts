import { describe, it, expect } from 'vitest';
import { genericBlockCatalog } from './generic-block-catalog.js';
import { validateBlockMarkup } from './validate-block-markup.js';

const run = (html: string) => genericBlockCatalog.htmlToBlocks!(html, { url: 'https://x.test/p' });

describe('generic-block-catalog: guards', () => {
  it('returns null when no known wrapper is present (lets caller own it)', () => {
    expect(run('<p>just a paragraph</p><h2>and a heading</h2>')).toBeNull();
  });

  it('returns null on already-blockified input (idempotency guard)', () => {
    expect(run('<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->')).toBeNull();
  });

  it('emits valid block markup for a recognized wrapper', () => {
    const out = run('<details><summary>Q</summary><p>A</p></details>');
    expect(out).not.toBeNull();
    expect(validateBlockMarkup(out!)).toEqual([]);
  });
});

describe('generic-block-catalog: callout', () => {
  it('wraps a .callout in core/group, preserving the class and recursing inner', () => {
    const out = run('<div class="callout"><h3>Note</h3><p>body</p></div>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:group');
    expect(out!).toContain('wp-block-group');
    expect(out!).toContain('callout');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });
});

describe('generic-block-catalog: pullquote', () => {
  it('converts blockquote.pullquote to core/pullquote', () => {
    const out = run('<blockquote class="pullquote"><p>Big idea</p><cite>Me</cite></blockquote>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:pullquote -->');
    expect(out!).toContain('Big idea');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });
});

describe('generic-block-catalog: buttons', () => {
  it('converts a wrapper of button links to core/buttons', () => {
    const out = run('<div class="btn-group"><a class="button" href="/x">Go</a><a class="btn" href="/y">More</a></div>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:buttons -->');
    expect(out!).toContain('<!-- wp:button -->');
    expect(out!).toContain('href="/x"');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });

  it('converts a single standalone button link', () => {
    const out = run('<a class="button" href="/x">Go</a>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:buttons -->');
  });
});

describe('generic-block-catalog: media-text', () => {
  it('converts an image + adjacent text wrapper to core/media-text', () => {
    const out = run(
      '<div class="media-text"><figure><img src="https://cdn.test/a.jpg" alt="A"/></figure><div><h3>Title</h3><p>copy</p></div></div>',
    );
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:media-text');
    expect(out!).toContain('https://cdn.test/a.jpg');
    expect(out!).toContain('Title');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });

  it('rewrites the image src via ctx.mediaMap', () => {
    const out = genericBlockCatalog.htmlToBlocks!(
      '<div class="media-text"><img src="https://cdn.test/a.jpg" alt="A"/><div><p>copy</p></div></div>',
      { url: 'https://x.test/p', mediaMap: { 'https://cdn.test/a.jpg': '/wp-content/uploads/a.jpg' } },
    );
    expect(out!).toContain('/wp-content/uploads/a.jpg');
    expect(out!).not.toContain('cdn.test');
  });
});

describe('generic-block-catalog: lossless mixed content', () => {
  it('converts known wrappers and keeps unknown siblings as core/html islands', () => {
    const html =
      '<details><summary>Q</summary><p>A</p></details>' +
      '<div class="weird-widget" data-x="1"><span>keep me</span></div>';
    const out = run(html)!;
    expect(out).toContain('<!-- wp:details -->');
    expect(out).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->'); // the unknown widget survives losslessly
    expect(out).toContain('keep me');
    expect(validateBlockMarkup(out)).toEqual([]);
  });

  it('is idempotent: re-running over its own output is a no-op (null)', () => {
    const once = run('<details><summary>Q</summary><p>A</p></details>')!;
    expect(run(once)).toBeNull();
  });
});

describe('generic-block-catalog: embeds (iframe -> core/embed)', () => {
  it('converts a top-level provider iframe to core/embed', () => {
    const out = run('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:embed');
    expect(out!).toContain('"providerNameSlug":"youtube"');
    expect(out!).toContain('wp-block-embed-youtube');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });

  it('converts a figure wrapping a provider iframe to core/embed', () => {
    const out = run('<figure><iframe src="https://player.vimeo.com/video/1"></iframe></figure>');
    expect(out).not.toBeNull();
    expect(out!).toContain('<!-- wp:embed');
    expect(out!).toContain('"providerNameSlug":"vimeo"');
    expect(validateBlockMarkup(out!)).toEqual([]);
  });

  it('does not claim an unknown-provider iframe (leaves it for the caller)', () => {
    expect(run('<iframe src="https://maps.example.com/embed?pb=1"></iframe>')).toBeNull();
  });

  it('does not swallow a paragraph that contains an iframe alongside real text', () => {
    expect(run('<p>Watch <iframe src="https://www.youtube.com/embed/abc"></iframe> here</p>')).toBeNull();
  });

  it('is idempotent: skips input that already contains a wp:embed', () => {
    const embedded =
      '<!-- wp:embed {"url":"https://www.youtube.com/embed/abc","providerNameSlug":"youtube","responsive":true} -->\n' +
      '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://www.youtube.com/embed/abc</div></figure>\n' +
      '<!-- /wp:embed -->';
    expect(run(embedded)).toBeNull();
  });
});

describe('generic-block-catalog: structural media-text (BDC ladder)', () => {
  it('claims a layout-hinted two-child [image, text] wrapper without a media-text class', () => {
    const html = `<div class="split-row"><figure><img src="/walrus-spa.jpg" alt="Spa"></figure><div><h3>Soak first</h3><p>Warm saltwater opens the whiskers.</p></div></div>`;
    const out = run(html);
    expect(out).toContain('wp:media-text');
    expect(out).toContain('wp-block-media-text__media');
    expect(out).toContain('Soak first');
    expect(out).not.toContain('"mediaPosition":"right"');
  });

  it('text-first order emits mediaPosition right + the matching class', () => {
    const html = `<div class="two-col"><div><h3>Polish</h3><p>Tusk wax, two coats.</p></div><figure><img src="/tusk.jpg" alt="Tusk"></figure></div>`;
    const out = run(html);
    expect(out).toContain('"mediaPosition":"right"');
    expect(out).toContain('has-media-on-the-right');
  });

  it('inline flex style counts as layout evidence', () => {
    const html = `<div style="display:flex; gap:2rem"><img src="/kelp.jpg" alt="Kelp"><div><p>Kelp scrub basics.</p></div></div>`;
    const out = run(html);
    expect(out).toContain('wp:media-text');
  });

  it('a stacked two-child wrapper WITHOUT layout evidence is not claimed (no side-by-side guess)', () => {
    const html = `<div class="feature"><img src="/molt.jpg" alt="Molt"><div><p>Molt care.</p></div></div>`;
    expect(run(html)).toBeNull();
  });
});

describe('generic-block-catalog: structural details pairs (BDC ladder)', () => {
  it('converts heading + hidden-content pairs to one core/details each', () => {
    const html = `<div class="qa"><h3>Do walruses like baths?</h3><div hidden><p>They insist on them.</p></div><h3>How long is a session?</h3><div hidden><p>One tide, give or take.</p></div></div>`;
    const out = run(html);
    expect(out).toContain('wp:details');
    expect((out?.match(/<!-- wp:details -->/g) ?? []).length).toBe(2);
    expect(out).toContain('<summary>Do walruses like baths?</summary>');
    expect(out).toContain('One tide, give or take.');
  });

  it('heading pairs whose content is NOT hidden stay unclaimed (no disclosure evidence)', () => {
    const html = `<div class="qa"><h3>Visible heading</h3><div><p>Visible body.</p></div></div>`;
    expect(run(html)).toBeNull();
  });
});
