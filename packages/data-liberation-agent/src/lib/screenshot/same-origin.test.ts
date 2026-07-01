import { describe, it, expect } from 'vitest';
import { enforceSameOrigin, SameOriginViolation } from './same-origin.js';

describe('enforceSameOrigin', () => {
  it('accepts URLs that share origin with the primary', () => {
    expect(() =>
      enforceSameOrigin('https://example.com', ['https://example.com/a', 'https://example.com/b']),
    ).not.toThrow();
  });

  it('rejects URLs from a different origin', () => {
    expect(() =>
      enforceSameOrigin('https://example.com', ['https://example.com/a', 'https://evil.com/x']),
    ).toThrow(SameOriginViolation);
  });

  it('accepts URLs when primaryUrl is null and urls[] all share origin', () => {
    expect(() =>
      enforceSameOrigin(null, ['https://example.com/a', 'https://example.com/b']),
    ).not.toThrow();
  });

  it('rejects mixed-origin URLs when primaryUrl is null', () => {
    expect(() =>
      enforceSameOrigin(null, ['https://a.com/x', 'https://b.com/y']),
    ).toThrow(SameOriginViolation);
  });

  it('no-op on empty URL list', () => {
    expect(() => enforceSameOrigin('https://example.com', [])).not.toThrow();
    expect(() => enforceSameOrigin(null, [])).not.toThrow();
  });

  it('rejects malformed URLs loudly', () => {
    expect(() => enforceSameOrigin('not a url', ['https://a.com/'])).toThrow();
  });

  it('treats http and https as different origins', () => {
    expect(() =>
      enforceSameOrigin('https://example.com', ['http://example.com/']),
    ).toThrow(SameOriginViolation);
  });

  it('treats different ports as different origins', () => {
    expect(() =>
      enforceSameOrigin('https://example.com:8080', ['https://example.com:9090']),
    ).toThrow(SameOriginViolation);
  });

  it('treats a leading www. as origin-equivalent: apex primary + www urls', () => {
    expect(() =>
      enforceSameOrigin('https://example.com', [
        'https://www.example.com/a',
        'https://www.example.com/b',
      ]),
    ).not.toThrow();
  });

  it('treats a leading www. as origin-equivalent: www primary + apex urls', () => {
    expect(() =>
      enforceSameOrigin('https://www.example.com', [
        'https://example.com/a',
        'https://example.com/b',
      ]),
    ).not.toThrow();
  });

  it('accepts a www/apex mix within the same urls[] list', () => {
    expect(() =>
      enforceSameOrigin(null, ['https://example.com/a', 'https://www.example.com/b']),
    ).not.toThrow();
  });

  it('still rejects a genuinely different host even with www stripping', () => {
    expect(() =>
      enforceSameOrigin('https://www.example.com', ['https://www.evil.com/x']),
    ).toThrow(SameOriginViolation);
  });

  it('does not collapse www onto a different bare host (www.example vs example2)', () => {
    expect(() =>
      enforceSameOrigin('https://www.example.com', ['https://example2.com/x']),
    ).toThrow(SameOriginViolation);
  });

  it('still distinguishes protocol when only www differs', () => {
    expect(() =>
      enforceSameOrigin('https://example.com', ['http://www.example.com/a']),
    ).toThrow(SameOriginViolation);
  });

  it('SameOriginViolation exposes violations and expected fields', () => {
    try {
      enforceSameOrigin('https://example.com', ['https://evil.com/x', 'https://evil2.com/y']);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SameOriginViolation);
      const v = err as SameOriginViolation;
      expect(v.violations).toEqual(['https://evil.com/x', 'https://evil2.com/y']);
      expect(v.expected).toBe('https://example.com');
    }
  });
});
