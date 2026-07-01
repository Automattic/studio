import { describe, it, expect } from 'vitest';
import { verifyComposedOutput } from './output-verify.js';

describe('verifyComposedOutput', () => {
  it('passes when every text node appears in source plain text', () => {
    const source = '<article><h1>Welcome to Foo Industries</h1><p>We make widgets for the modern era.</p></article>';
    const blocks = `<!-- wp:heading -->
<h2 class="wp-block-heading">Welcome to Foo Industries</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>We make widgets for the modern era.</p>
<!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
    expect(result.hallucinated).toEqual([]);
  });

  it('fails when output substitutes a different brand name', () => {
    const source = '<article><h1>Foo Industries</h1><p>About us.</p></article>';
    const blocks = `<!-- wp:heading --><h2>Bar Inc</h2><!-- /wp:heading --><!-- wp:paragraph --><p>About us.</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(false);
    expect(result.hallucinated).toContain('Bar Inc');
  });

  it('treats wp: block comments as metadata, not text', () => {
    // Block names like `wp:cover` or attribute slugs like `accent-primary`
    // are NOT user-facing copy — they should be ignored even if they don't
    // appear in source plain text.
    const source = '<article><p>Hello</p></article>';
    const blocks = `<!-- wp:cover {"className":"is-style-accent-primary"} --><div><!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph --></div><!-- /wp:cover -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('is case-insensitive for substring matching', () => {
    const source = '<p>welcome to foo industries</p>';
    const blocks = `<!-- wp:paragraph --><p>Welcome to Foo Industries</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('normalizes whitespace before comparison', () => {
    const source = '<p>We   make\n\nwidgets.</p>';
    const blocks = `<!-- wp:paragraph --><p>We make widgets.</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('decodes HTML entities in both source and output before comparison', () => {
    const source = '<p>Tom &amp; Jerry</p>';
    const blocks = `<!-- wp:paragraph --><p>Tom &amp; Jerry</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('skips trivial text nodes (very short / pure punctuation)', () => {
    // The dash and emoji-like glyph aren't in source, but they're stylistic
    // and well below the alnum threshold, so they should not trip the check.
    const source = '<p>Real content here</p>';
    const blocks = `<!-- wp:paragraph --><p>›</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Real content here</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('reports multiple hallucinations independently', () => {
    const source = '<article><p>The original text only.</p></article>';
    const blocks = `<!-- wp:heading --><h2>Hallucinated heading</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Made-up paragraph copy.</p><!-- /wp:paragraph -->`;
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(false);
    expect(result.hallucinated.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts source as raw HTML — extracts plain text internally', () => {
    const source = '<article><h1>Hello</h1><p>World</p></article>';
    const blocks = `<!-- wp:paragraph --><p>Hello World</p><!-- /wp:paragraph -->`;
    // "Hello World" appears in the plain-text extraction even though
    // <h1>Hello</h1><p>World</p> separates the words by a tag.
    const result = verifyComposedOutput(blocks, source);
    expect(result.valid).toBe(true);
  });

  it('handles empty markup gracefully', () => {
    const result = verifyComposedOutput('', '<p>anything</p>');
    expect(result.valid).toBe(true);
    expect(result.hallucinated).toEqual([]);
  });
});
