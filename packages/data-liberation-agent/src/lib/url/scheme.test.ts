import { describe, it, expect } from 'vitest';
import { ensureUrlScheme } from './index.js';

describe('ensureUrlScheme', () => {
  it('adds https:// to a scheme-less host (the Wix discover bug)', () => {
    expect(ensureUrlScheme('www.swiftlumber.com')).toBe('https://www.swiftlumber.com');
    expect(ensureUrlScheme('swiftlumber.com/path')).toBe('https://swiftlumber.com/path');
  });
  it('leaves an already-schemed URL unchanged (idempotent)', () => {
    expect(ensureUrlScheme('https://www.swiftlumber.com')).toBe('https://www.swiftlumber.com');
    expect(ensureUrlScheme('http://localhost:8881/x')).toBe('http://localhost:8881/x');
  });
  it('produces a value new URL() accepts for scheme-less input', () => {
    // This is the exact failure that crashed wixAdapter.discover (new URL threw).
    expect(() => new URL(ensureUrlScheme('www.swiftlumber.com'))).not.toThrow();
    expect(new URL(ensureUrlScheme('www.swiftlumber.com')).origin).toBe('https://www.swiftlumber.com');
  });
});
