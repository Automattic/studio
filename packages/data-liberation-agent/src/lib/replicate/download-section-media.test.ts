import { describe, it, expect } from 'vitest';
import { downloadSectionMedia } from './download-section-media.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('downloadSectionMedia', () => {
  it('downloads each http url, records success, and returns the count', async () => {
    const got: string[] = [];
    const succeeded: Array<[string, string]> = [];
    const { downloaded } = await downloadSectionMedia({
      srcUrls: ['https://cdn/a.png', 'https://cdn/b.png'],
      isAlreadyDone: () => false,
      download: async (u) => {
        got.push(u);
        return `/media/${u.split('/').pop()}`;
      },
      onSuccess: (u, lp) => succeeded.push([u, lp]),
    });
    expect(downloaded).toBe(2);
    expect(got.sort()).toEqual(['https://cdn/a.png', 'https://cdn/b.png']);
    expect(succeeded).toContainEqual(['https://cdn/a.png', '/media/a.png']);
  });

  it('skips urls already downloaded (stub dedup) and non-http urls', async () => {
    const got: string[] = [];
    const { downloaded } = await downloadSectionMedia({
      srcUrls: ['https://cdn/a.png', 'https://cdn/done.png', 'assets/local.png', 'data:image/png;base64,xx'],
      isAlreadyDone: (u) => u === 'https://cdn/done.png',
      download: async (u) => {
        got.push(u);
        return `/media/x.png`;
      },
      onSuccess: () => {},
    });
    expect(got).toEqual(['https://cdn/a.png']); // only the new http url
    expect(downloaded).toBe(1);
  });

  it('dedupes repeated source urls', async () => {
    const got: string[] = [];
    await downloadSectionMedia({
      srcUrls: ['https://cdn/a.png', 'https://cdn/a.png', 'https://cdn/a.png'],
      isAlreadyDone: () => false,
      download: async (u) => {
        got.push(u);
        return '/media/a.png';
      },
      onSuccess: () => {},
    });
    expect(got).toEqual(['https://cdn/a.png']); // fetched once
  });

  it('runs downloads with bounded concurrency', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const urls = Array.from({ length: 9 }, (_, i) => `https://cdn/${i}.png`);
    await downloadSectionMedia({
      srcUrls: urls,
      isAlreadyDone: () => false,
      concurrency: 3,
      download: async () => {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await tick(10);
        inflight -= 1;
        return '/media/x.png';
      },
      onSuccess: () => {},
    });
    expect(maxInflight).toBeGreaterThan(1); // actually parallel
    expect(maxInflight).toBeLessThanOrEqual(3); // bounded by the cap
  });

  it('is best-effort: one failing download does not abort the rest', async () => {
    let ok = 0;
    const { downloaded } = await downloadSectionMedia({
      srcUrls: ['https://cdn/a.png', 'https://cdn/boom.png', 'https://cdn/c.png'],
      isAlreadyDone: () => false,
      download: async (u) => {
        if (u.includes('boom')) throw new Error('network');
        return '/media/x.png';
      },
      onSuccess: () => {
        ok += 1;
      },
    });
    expect(downloaded).toBe(2);
    expect(ok).toBe(2);
  });
});
