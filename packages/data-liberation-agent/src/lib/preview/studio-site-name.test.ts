import { describe, it, expect } from 'vitest';
import { makeStudioSiteName } from './studio.js';

describe('makeStudioSiteName', () => {
  it('derives a sanitized name from the outputDir basename when no explicit name is given', () => {
    expect(makeStudioSiteName('/x/output/getsnooz.com')).toBe('getsnooz-com');
  });

  it('honors an explicit name (the replica naming convention) over the outputDir basename', () => {
    expect(makeStudioSiteName('/x/output/getsnooz.com', [], 'getsnooz-com-replica')).toBe(
      'getsnooz-com-replica',
    );
  });

  it('sanitizes an explicit name', () => {
    expect(makeStudioSiteName('/x/output/foo', [], 'My Site.Replica')).toBe('my-site-replica');
  });

  it('uniques an explicit name against existing sites', () => {
    expect(
      makeStudioSiteName('/x/output/foo', ['getsnooz-com-replica'], 'getsnooz-com-replica'),
    ).toBe('getsnooz-com-replica-2');
  });

  it('falls back to outputDir basename when explicit name is blank', () => {
    expect(makeStudioSiteName('/x/output/getsnooz.com', [], '   ')).toBe('getsnooz-com');
  });
});
