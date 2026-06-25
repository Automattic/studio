import { describe, it, expect } from 'vitest';
import { countBodyTags, isStackingArtifact } from './document-integrity.js';

describe('document-integrity', () => {
  it('counts a clean single-document page as one body', () => {
    const html = '<!doctype html><html><head></head><body><main>hi</main></body></html>';
    expect(countBodyTags(html)).toBe(1);
    expect(isStackingArtifact(html)).toBe(false);
  });

  it('detects a document nested into itself (the 11× capture artifact)', () => {
    const inner = '<body><main>page</main></body>';
    const html = `<!doctype html><html><head></head>${inner.repeat(11)}</html>`;
    expect(countBodyTags(html)).toBe(11);
    expect(isStackingArtifact(html)).toBe(true);
  });

  it('matches <body> with attributes and is case-insensitive', () => {
    const html = '<HTML><BODY class="x"><div></div></BODY></HTML>';
    expect(countBodyTags(html)).toBe(1);
    expect(isStackingArtifact(html)).toBe(false);
  });

  it('does not count a literal "<body" inside text/attribute strings without a tag delimiter', () => {
    // "<bodyguard" must not be mistaken for a <body> tag.
    const html = '<html><body><p>&lt;bodyguard&gt; and <bodyguard></p></body></html>';
    expect(countBodyTags(html)).toBe(1);
  });
});
