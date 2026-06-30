import { describe, it, expect } from 'vitest';
import { registrableDomain, isFirstParty } from './first-party.js';

describe('registrableDomain', () => {
  it('reduces host to eTLD+1', () => {
    expect(registrableDomain('www.swiftlumber.com')).toBe('swiftlumber.com');
    expect(registrableDomain('assets.swiftlumber.com')).toBe('swiftlumber.com');
    expect(registrableDomain('swiftlumber.com')).toBe('swiftlumber.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
  });
});

describe('isFirstParty', () => {
  it('treats subdomains of the base registrable domain as first-party', () => {
    const base = 'https://www.swiftlumber.com/';
    expect(isFirstParty('https://assets.swiftlumber.com/app.js', base)).toBe(true);
    expect(isFirstParty('https://www.swiftlumber.com/x.js', base)).toBe(true);
    expect(isFirstParty('https://cdn.jsdelivr.net/lib.js', base)).toBe(false);
    expect(isFirstParty('/relative/path.js', base)).toBe(true);
  });
});
