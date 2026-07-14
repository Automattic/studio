import { describe, it, expect } from 'vitest';
import { analyzeIsland, emitEditableBlock, serializeFrame, serializeFrameJsSource } from './island-bindings.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';

describe('analyzeIsland', () => {
  it('marks heading + paragraph text and an image as bindings, keeps svg verbatim', () => {
    const html =
      '<div class="card"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>' +
      '<h3 class="t">Title <em>here</em></h3><p>Body text</p>' +
      '<img src="a.png" alt="A"/></div>';
    const res = analyzeIsland(html);
    expect(res.bindingCount).toBe(3); // h3, p, img
    // Canonical input round-trips to the same HTML. Non-canonical entity attrs
    // are decoded then re-escaped, which is browser-equivalent but not
    // byte-identical.
    expect(serializeFrame(res.frame)).toBe(html);
  });

  it('returns zero bindings for an svg-only / textless island', () => {
    const html = '<span class="icon"><svg><path d="M0 0"/></svg></span>';
    const res = analyzeIsland(html);
    expect(res.bindingCount).toBe(0);
  });

  it('does not bind an element that contains a nested block element', () => {
    // The outer div has block children → recurse; only the inner <p> binds.
    const res = analyzeIsland('<div class="wrap"><p>x</p><p>y</p></div>');
    expect(res.bindingCount).toBe(2);
  });

  it('keeps inline markup verbatim inside a text binding', () => {
    const res = analyzeIsland('<p>see <a href="/x/">it</a> now</p>');
    expect(res.bindingCount).toBe(1);
    expect(serializeFrame(res.frame)).toBe('<p>see <a href="/x/">it</a> now</p>');
  });

  it('round-trips existing entities in attribute values without double-escaping them', () => {
    const html = '<img src="a.png" alt="A &amp; B"/>';
    const res = analyzeIsland(html);
    expect(serializeFrame(res.frame)).toBe(html);
  });

  it('round-trips HTML void tags inside text bindings', () => {
    const html = '<p>Hi<br>there</p>';
    const res = analyzeIsland(html);
    expect(res.bindingCount).toBe(1);
    expect(serializeFrame(res.frame)).toBe(html);
  });

  it('keeps script, style, and noscript subtrees raw instead of bindable', () => {
    const html = '<div><p>hi</p><script>var a=b---c;</script><style>.x{color:red}</style><noscript>fallback</noscript></div>';
    const res = analyzeIsland(html);
    expect(res.bindingCount).toBe(1);
    expect(serializeFrame(res.frame)).toBe(html);
  });

  it('exposes the same frame serializer as JS function source', () => {
    const jsSerialize = eval(`(${serializeFrameJsSource()})`) as typeof serializeFrame;
    const { frame } = analyzeIsland('<div class="card"><p>Body <a href="/x/">l</a></p><img src="a.png" alt="A"/></div>');
    expect(jsSerialize(frame)).toBe(serializeFrame(frame));
  });
});

describe('emitEditableBlock', () => {
  it('emits a dla/editable-html block whose saved HTML is the reconstructed frame and round-trips', () => {
    const island = analyzeIsland('<div class="card"><p>Body text</p></div>');
    const markup = emitEditableBlock(island);
    expect(markup).toContain('<!-- wp:dla/editable-html ');
    expect(markup).toContain('<div class="card"><p>Body text</p></div>');
    expect(markup).toContain('<!-- /wp:dla/editable-html -->');
    expect(blockMarkupRoundtrips(markup).ok).toBe(true);
  });

  it('escapes -- inside the frame JSON for block-comment safety', () => {
    const island = analyzeIsland('<p>a--b</p>');
    expect(emitEditableBlock(island)).toContain('\\u002d\\u002d');
  });
});
