import { describe, it, expect } from 'vitest';
import { resolveAdapter } from './resolve-adapter.js';
import type { PlatformAdapter } from '../types.js';

const stub = (id: string): PlatformAdapter => ({
  id,
  detect: () => false,
  discover: async () => ({}),
  extract: async () => ({}),
});

describe('resolveAdapter', () => {
  const shopify = stub('shopify');
  const dflt = stub('default');

  it('returns the adapter whose id matches the platform', () => {
    expect(resolveAdapter([shopify, dflt], 'shopify')).toBe(shopify);
  });

  it('falls back to the default adapter when no id matches', () => {
    expect(resolveAdapter([shopify, dflt], 'unknown')).toBe(dflt);
  });

  it('prefers an exact match over the default fallback', () => {
    expect(resolveAdapter([dflt, shopify], 'shopify')).toBe(shopify);
  });

  it('returns null when there is no match and no default is registered', () => {
    expect(resolveAdapter([shopify], 'unknown')).toBeNull();
  });
});
