import { describe, it, expect } from 'vitest';
import { isSemanticHtml } from './semantic-html.js';

describe('isSemanticHtml', () => {
  it('is true for a flat list of semantic blocks (wrapped in layout containers)', () => {
    const html = '<main><div class="wp-block-group">' +
      '<div class="wp-block-spacer" style="height:40px"></div>' +
      '<h1 class="wp-block-post-title">Fictional Title</h1>' +
      '<p>Body copy about nothing in particular.</p>' +
      '<figure class="wp-block-table"><table><tr><td>x</td></tr></table></figure>' +
      '</div></main>';
    expect(isSemanticHtml(html)).toBe(true);
  });

  it('is true for a heading + figure hero (spacers ignored)', () => {
    const html = '<div class="wp-block-spacer" style="height:30px"></div>' +
      '<h1>Stacked Hero</h1>' +
      '<div class="wp-block-spacer" style="height:30px"></div>' +
      '<figure class="wp-block-image"><img src="hero.jpg"/></figure>';
    expect(isSemanticHtml(html)).toBe(true);
  });

  it('is false for positioned div-soup with no semantic structure', () => {
    const html = '<div class="comp-abc"><div class="comp-def"><div class="comp-ghi">' +
      '<span>Label</span></div></div><div class="comp-jkl"><span>Other</span></div></div>';
    expect(isSemanticHtml(html)).toBe(false);
  });

  it('is false for empty input', () => {
    expect(isSemanticHtml('')).toBe(false);
  });

  it('is false at ratio 0.5 (2 semantic + 2 non-semantic, below floor)', () => {
    const html =
      '<p>First paragraph.</p>' +
      '<p>Second paragraph.</p>' +
      '<div class="box"><span>x</span></div>' +
      '<div class="box"><span>y</span></div>';
    expect(isSemanticHtml(html)).toBe(false);
  });

  it('is true at ratio 0.6 (3 semantic + 2 non-semantic, at floor)', () => {
    const html =
      '<h2>Heading</h2>' +
      '<p>First paragraph.</p>' +
      '<p>Second paragraph.</p>' +
      '<div class="box"><span>x</span></div>' +
      '<div class="box"><span>y</span></div>';
    expect(isSemanticHtml(html)).toBe(true);
  });

  it('unwraps nested layout wrappers (while-loop iterates more than once)', () => {
    const html =
      '<main><div class="wp-block-group"><div class="wp-block-post-content">' +
      '<h1>Title</h1><p>copy</p>' +
      '</div></div></main>';
    expect(isSemanticHtml(html)).toBe(true);
  });
});
