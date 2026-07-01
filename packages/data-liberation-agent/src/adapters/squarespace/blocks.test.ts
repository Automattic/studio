import { describe, it, expect } from 'vitest';
import { blocks } from './blocks.js';
import { squarespaceAdapter } from './index.js';

const toBlocks = (html: string) => blocks.htmlToBlocks!(html, { url: 'https://x.test/p' });

describe('squarespace blocks recipe (htmlToBlocks)', () => {
  it('returns null when no sqs-block markers present', () => {
    expect(toBlocks('<p>Just plain HTML.</p>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(toBlocks('')).toBeNull();
  });

  it('converts a single image-block, preferring data-image over src', () => {
    const html = `
      <div class="sqs-layout"><div class="row"><div class="col">
        <div class="sqs-block image-block">
          <div class="sqs-block-content">
            <img src="https://example.com/placeholder.svg"
                 data-image="https://images.squarespace-cdn.com/content/v1/real.jpg"
                 alt="A summit" />
          </div>
        </div>
      </div></div></div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:image');
    expect(out).toContain('images.squarespace-cdn.com/content/v1/real.jpg');
    expect(out).toContain('alt="A summit"');
    expect(out).not.toContain('placeholder.svg');
  });

  it('preserves image captions inside wp:image', () => {
    const html = `
      <div class="sqs-block image-block">
        <figure>
          <img src="https://example.com/x.jpg" alt="x"/>
          <figcaption>Late afternoon, north face.</figcaption>
        </figure>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('Late afternoon, north face.');
    expect(out).toContain('wp-element-caption');
  });

  it('converts gallery-block with multiple images and linkTo:media for lightbox', () => {
    const html = `
      <div class="sqs-block gallery-block">
        <div class="sqs-gallery">
          <img src="https://example.com/a.jpg" alt="A"/>
          <img src="https://example.com/b.jpg" alt="B"/>
          <img src="https://example.com/c.jpg" alt="C"/>
        </div>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:gallery {"linkTo":"media"} -->');
    // Each gallery item should be a wp:image with linkDestination:media (anchor wrapper).
    expect((out!.match(/<!-- wp:image/g) || []).length).toBe(3);
    expect(out).toContain('href="https://example.com/a.jpg"');
    expect(out).toContain('alt="C"');
  });

  it('converts an html-block heading + paragraph + list into three wp blocks', () => {
    const html = `
      <div class="sqs-block html-block">
        <div class="html-block-html">
          <h2>Section one</h2>
          <p>An opening paragraph with <em>emphasis</em>.</p>
          <ul>
            <li>Item A</li>
            <li>Item B</li>
          </ul>
        </div>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:heading {"level":2} -->');
    expect(out).toContain('<h2>Section one</h2>');
    expect(out).toContain('<!-- wp:paragraph -->');
    expect(out).toContain('<em>emphasis</em>');
    expect(out).toContain('<!-- wp:list -->');
    expect(out).toContain('<!-- wp:list-item -->');
    expect(out).toContain('<li>Item A</li>');
  });

  it('emits an ordered list with the ordered attribute', () => {
    const html = `
      <div class="sqs-block html-block">
        <div class="html-block-html">
          <ol><li>First</li><li>Second</li></ol>
        </div>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:list {"ordered":true} -->');
    expect(out).toContain('<ol>');
  });

  it('converts an embed-block YouTube iframe into wp:embed with provider slug', () => {
    const html = `
      <div class="sqs-block embed-block">
        <iframe src="https://www.youtube.com/embed/abc123"></iframe>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:embed');
    expect(out).toContain('"providerNameSlug":"youtube"');
    expect(out).toContain('wp-block-embed-youtube');
  });

  it('emits a rich (not video) embed for a Twitter/X embed-block', () => {
    const html = `
      <div class="sqs-block embed-block">
        <iframe src="https://twitter.com/a/status/1"></iframe>
      </div>`;
    const out = toBlocks(html);
    expect(out).toContain('"providerNameSlug":"twitter"');
    expect(out).toContain('"type":"rich"');
    expect(out).not.toContain('wp-embed-aspect');
  });

  it('drops spacer-block entirely', () => {
    const html = `
      <div class="sqs-block image-block">
        <img src="https://example.com/x.jpg" alt=""/>
      </div>
      <div class="sqs-block spacer-block"><div class="sqs-block-content"></div></div>
      <div class="sqs-block image-block">
        <img src="https://example.com/y.jpg" alt=""/>
      </div>`;
    const out = toBlocks(html);
    expect(out).not.toContain('spacer-block');
    expect((out!.match(/<!-- wp:image/g) || []).length).toBe(2);
  });

  it('emits a wp:separator for horizontal-rule-block', () => {
    const html = `<div class="sqs-block horizontal-rule-block"><hr/></div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:separator -->');
    expect(out).toContain('wp-block-separator');
  });

  it('falls back to core/html for an unrecognised sqs-block class', () => {
    const html = `<div class="sqs-block weird-future-block-2050">
      <div class="sqs-block-content"><p>preserved content</p></div>
    </div>`;
    const out = toBlocks(html);
    expect(out).toContain('<!-- wp:html {"metadata":{"name":"lib-coverage-island"}} -->');
    expect(out).toContain('preserved content');
  });

  it('preserves block order when multiple sqs-blocks appear', () => {
    const html = `
      <div class="sqs-layout">
        <div class="sqs-block image-block"><img src="https://example.com/a.jpg" alt="a"/></div>
        <div class="sqs-block html-block"><div class="html-block-html"><p>middle</p></div></div>
        <div class="sqs-block image-block"><img src="https://example.com/b.jpg" alt="b"/></div>
      </div>`;
    const out = toBlocks(html);
    const idxA = out!.indexOf('a.jpg');
    const idxMid = out!.indexOf('middle');
    const idxB = out!.indexOf('b.jpg');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxMid).toBeGreaterThan(idxA);
    expect(idxB).toBeGreaterThan(idxMid);
  });

  it('is attached to the adapter', () => {
    expect(squarespaceAdapter.blocks).toBe(blocks);
  });
});
