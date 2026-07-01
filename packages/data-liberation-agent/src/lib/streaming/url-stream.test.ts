import { describe, it, expect } from 'vitest';
import { fromArray, fromPromise, take, filter, type InventoryEntry } from './url-stream.js';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe('url-stream', () => {
  const items: InventoryEntry[] = [
    { url: 'https://example.com/', type: 'homepage' },
    { url: 'https://example.com/about', type: 'page' },
    { url: 'https://example.com/blog/post-1', type: 'post' },
  ];

  it('fromArray yields each entry in order', async () => {
    const out = await collect(fromArray(items));
    expect(out).toEqual(items);
  });

  it('fromPromise resolves and yields', async () => {
    const out = await collect(fromPromise(Promise.resolve(items)));
    expect(out).toEqual(items);
  });

  it('take caps at N', async () => {
    const out = await collect(take(fromArray(items), 2));
    expect(out).toEqual(items.slice(0, 2));
  });

  it('take(0) yields nothing', async () => {
    const out = await collect(take(fromArray(items), 0));
    expect(out).toEqual([]);
  });

  it('filter applies predicate lazily', async () => {
    const out = await collect(filter(fromArray(items), (i) => i.type === 'page'));
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://example.com/about');
  });

  it('take + filter compose', async () => {
    const out = await collect(take(filter(fromArray(items), (i) => i.type !== 'homepage'), 1));
    expect(out).toEqual([{ url: 'https://example.com/about', type: 'page' }]);
  });
});
