import { describe, it, expect } from 'vitest';
import { makeIslandsEditable } from './make-islands-editable.js';
import { blockMarkupRoundtrips } from '../../streaming/block-markup-validate.js';

describe('makeIslandsEditable', () => {
  it('converts a core/html island with text into dla/editable-html', () => {
    const input =
      '<!-- wp:group -->\n<div class="wp-block-group ticket-footer"><!-- wp:html -->\n<p>Body text</p>\n<!-- /wp:html --></div>\n<!-- /wp:group -->';
    const { content, converted } = makeIslandsEditable(input);
    expect(converted).toBe(1);
    expect(content).toContain('<!-- wp:dla/editable-html ');
    expect(content).not.toContain('<!-- wp:html -->');
    // siblings/structure preserved
    expect(content).toContain('class="wp-block-group ticket-footer"');
    expect(blockMarkupRoundtrips(content).ok).toBe(true);
  });

  it('converts a textless (svg-only, zero-binding) core/html island — editable-html is the default island', () => {
    // Even with no bindable leaves, a core/html island renders unstyled in the editor's
    // SandBox; converting to the in-canvas block is the whole point, so it must convert too.
    const input = '<!-- wp:html -->\n<span class="icon"><svg><path d="M0 0"/></svg></span>\n<!-- /wp:html -->';
    const { content, converted } = makeIslandsEditable(input);
    expect(converted).toBe(1);
    expect(content).toContain('<!-- wp:dla/editable-html ');
    expect(content).not.toContain('<!-- wp:html -->');
    expect(content).toContain('<span class="icon"><svg><path d="M0 0"/></svg></span>');
    expect(blockMarkupRoundtrips(content).ok).toBe(true);
  });

  it('leaves a core/html island that wraps nested block delimiters untouched (safety guard)', () => {
    const input = '<!-- wp:html -->\n<div><!-- wp:paragraph --><p>x</p><!-- /wp:paragraph --></div>\n<!-- /wp:html -->';
    const { content, converted } = makeIslandsEditable(input);
    expect(converted).toBe(0);
    expect(content).toBe(input);
  });

  it('does not touch non-html blocks', () => {
    const input = '<!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph -->';
    expect(makeIslandsEditable(input).content).toBe(input);
  });

  it('converts an ATTRIBUTED core/html island (the carry path names islands via metadata)', () => {
    // The carry path emits `<!-- wp:html {"metadata":{"name":"…"}} -->`; a bare-delimiter
    // reconstruction never matched, so converted stayed 0 (the carried bodies wouldn't
    // become editable). originalHtmlBlock must reconstruct the attrs to match.
    const input = '<!-- wp:html {"metadata":{"name":"Hero"}} -->\n<p>Body text</p>\n<!-- /wp:html -->';
    const { content, converted } = makeIslandsEditable(input);
    expect(converted).toBe(1);
    expect(content).toContain('<!-- wp:dla/editable-html ');
    expect(content).not.toContain('<!-- wp:html ');
    expect(content).toContain('<p>Body text</p>');
    // the island's metadata.name (editor label) is carried onto the editable block
    expect(content).toContain('"metadata":{"name":"Hero"}');
    expect(blockMarkupRoundtrips(content).ok).toBe(true);
  });

  it('preserves literal dollar replacement tokens in converted core/html islands', () => {
    const input = '<!-- wp:html -->\n<p>Literal $$, $&amp;, $`, and $&#39; tokens</p>\n<!-- /wp:html -->';
    const { content, converted } = makeIslandsEditable(input);

    expect(converted).toBe(1);
    expect(content).toContain('"html":"Literal $$, $&amp;, $`, and $&#39; tokens"');
    expect(content).toContain('<p>Literal $$, $&amp;, $`, and $&#39; tokens</p>');
    expect(content).not.toContain('<!-- wp:html -->');
    expect(blockMarkupRoundtrips(content).ok).toBe(true);
  });
});
