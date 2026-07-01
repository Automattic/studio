import { describe, it, expect } from 'vitest';
import { heuristicBlocks } from './heuristic-blocks.js';

describe('heuristicBlocks', () => {
  it('handles pure paragraphs', () => {
    const html = '<p>First paragraph.</p><p>Second paragraph.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<!-- wp:paragraph -->');
    expect(result.blocks).toContain('First paragraph.');
    expect(result.blocks).toContain('Second paragraph.');
  });

  it('handles paragraphs interleaved with h2/h3 headings', () => {
    const html = '<h2>Section</h2><p>Some prose.</p><h3>Subsection</h3><p>More prose.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<!-- wp:heading -->');
    expect(result.blocks).toContain('<!-- wp:heading {"level":3} -->');
    expect(result.blocks).toContain('Section');
    expect(result.blocks).toContain('Subsection');
  });

  it('handles a single image followed by paragraphs', () => {
    const html = '<img src="https://example.com/hero.jpg" alt="Hero"><p>Caption-like text.</p><p>More body.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<!-- wp:image -->');
    expect(result.blocks).toContain('src="https://example.com/hero.jpg"');
    expect(result.blocks).toContain('alt="Hero"');
    expect(result.blocks).toContain('<!-- wp:paragraph -->');
  });

  it('handles a <figure><img></figure> followed by paragraphs', () => {
    const html = '<figure><img src="https://example.com/h.jpg" alt="H"><figcaption>Cap</figcaption></figure><p>Body.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<!-- wp:image -->');
    expect(result.blocks).toContain('src="https://example.com/h.jpg"');
  });

  it('handles a single <section> with heading + paragraphs as a wp:group', () => {
    const html = '<section><h2>About</h2><p>We make things.</p></section>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<!-- wp:group -->');
    expect(result.blocks).toContain('<!-- wp:heading -->');
    expect(result.blocks).toContain('About');
    expect(result.blocks).toContain('We make things.');
  });

  it('refuses complex page with multiple <section> blocks', () => {
    const html = '<section><h2>One</h2></section><section><h2>Two</h2></section>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(false);
  });

  it('refuses pages with lists, tables, or unfamiliar elements', () => {
    expect(heuristicBlocks('<ul><li>a</li><li>b</li></ul>').handled).toBe(false);
    expect(heuristicBlocks('<table><tr><td>x</td></tr></table>').handled).toBe(false);
    expect(heuristicBlocks('<div class="hero">stuff</div>').handled).toBe(false);
  });

  it('refuses an empty or whitespace-only input', () => {
    expect(heuristicBlocks('').handled).toBe(false);
    expect(heuristicBlocks('   \n  ').handled).toBe(false);
  });

  it('refuses pages where a paragraph is followed by an image (out-of-order)', () => {
    // Image-then-paragraphs is fine; paragraph-then-image is not in our
    // shape set — fall through to the AI path.
    const html = '<p>Lead.</p><img src="x.jpg">';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(false);
  });

  it('refuses h1 (since post_content should not duplicate post title)', () => {
    const html = '<h1>Title</h1><p>Body.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(false);
  });

  it('refuses a section that mixes images with text', () => {
    const html = '<section><h2>Hi</h2><img src="x.jpg"></section>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(false);
  });

  it('preserves inline markup inside paragraphs (e.g. <strong>, <a>)', () => {
    const html = '<p>Click <a href="/x"><strong>here</strong></a> now.</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(true);
    expect(result.blocks).toContain('<a href="/x">');
    expect(result.blocks).toContain('<strong>here</strong>');
  });

  it('rejects pages with stray top-level text (not inside any element)', () => {
    const html = 'stray text<p>then a paragraph</p>';
    const result = heuristicBlocks(html);
    expect(result.handled).toBe(false);
  });
});
