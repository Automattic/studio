import { describe, it, expect } from 'vitest';
import { countBodyTags, isRouteDrift, isStackingArtifact } from './document-integrity.js';

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

describe('isRouteDrift', () => {
  it('is not drift when the captured URL exactly matches the intended one', () => {
    expect(isRouteDrift('https://example.com/Home', 'https://example.com/Home')).toBe(false);
  });

  it('flags drift when a control navigated to a genuinely different route (the base44 View All case)', () => {
    expect(isRouteDrift('https://example.com/Browse', 'https://example.com/Home')).toBe(true);
  });

  it('flags drift across different origins even when the path matches', () => {
    expect(isRouteDrift('https://evil.example/Home', 'https://example.com/Home')).toBe(true);
  });

  it('tolerates a trailing slash difference', () => {
    expect(isRouteDrift('https://example.com/Home/', 'https://example.com/Home')).toBe(false);
    expect(isRouteDrift('https://example.com/Home', 'https://example.com/Home/')).toBe(false);
  });

  it('tolerates a hash difference (an in-page anchor, or scroll restoration)', () => {
    expect(isRouteDrift('https://example.com/Home#section-2', 'https://example.com/Home')).toBe(false);
  });

  it('tolerates a query string difference (a tracking param a runtime appended)', () => {
    expect(isRouteDrift('https://example.com/Home?ref=abc', 'https://example.com/Home')).toBe(false);
  });

  it('tolerates the SPA\'s own initial replaceState to the same path plus a hash', () => {
    expect(isRouteDrift('https://example.com/Home#/Home', 'https://example.com/Home')).toBe(false);
  });

  it('treats an unparseable URL as drift rather than silently accepting it', () => {
    expect(isRouteDrift('not a url', 'https://example.com/Home')).toBe(true);
    expect(isRouteDrift('https://example.com/Home', 'not a url')).toBe(true);
  });
});
