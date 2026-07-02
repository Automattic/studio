import { describe, it, expect } from 'vitest';
import { clusterPages } from './cluster-pages.js';
import type { PageSignature } from './page-signature.js';

const sig = (url: string, htmlBytes: number, types: string[]): PageSignature => ({
  url, htmlBytes, sections: types.map((type) => ({ type })),
});

describe('clusterPages', () => {
  it('groups identical signatures and picks the richest representative', () => {
    const result = clusterPages([
      sig('https://x/a', 100, ['cover-with-headline', 'cta']),
      sig('https://x/b', 300, ['cover-with-headline', 'cta']), // richest
      sig('https://x/c', 50, ['gallery']),
    ]);
    expect(result.clusters).toHaveLength(2);
    const ab = result.clusters.find((c) => c.members.length === 2)!;
    expect(ab.representative).toBe('https://x/b');
    expect(ab.members.sort()).toEqual(['https://x/a', 'https://x/b']);
  });

  it('treats structural attrs as part of the key (3-col != 2-col)', () => {
    const result = clusterPages([
      { url: 'https://x/a', htmlBytes: 1, sections: [{ type: 'columns', columns: 3 }] },
      { url: 'https://x/b', htmlBytes: 1, sections: [{ type: 'columns', columns: 2 }] },
    ]);
    expect(result.clusters).toHaveLength(2);
  });

  it('handles a single page as one cluster', () => {
    const result = clusterPages([sig('https://x/', 10, ['cover-with-headline'])]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].representative).toBe('https://x/');
  });

  it('returns empty clusters for empty input', () => {
    expect(clusterPages([]).clusters).toEqual([]);
  });
});
