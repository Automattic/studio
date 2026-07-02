import { describe, it, expect } from 'vitest';
import { startPreview } from './studio.js';

describe('startPreview (Studio-only)', () => {
  it('returns a failed result with an install URL when Studio is unavailable', async () => {
    const r = await startPreview({ outputDir: '/tmp/whatever' }, () => false);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/developer\.wordpress\.com\/studio/);
  });
});
