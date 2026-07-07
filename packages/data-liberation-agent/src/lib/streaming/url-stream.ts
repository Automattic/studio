//
// URL stream
// ==========
// Async iterator over URLs an adapter discovers. Adapters that already
// produce a final array (most do today) wrap their result in fromArray() so
// streaming consumers can do `for await (const url of urlStream)`. Adapters
// that want true incremental discovery pass an AsyncIterable directly.
//
// Memory: arrays are not buffered into a separate structure — the iterator
// yields directly off the source.
//

export interface InventoryEntry {
  url: string;
  type: string;
}

/** Wrap a finite array of URLs into an async iterable. */
export async function* fromArray(items: InventoryEntry[]): AsyncIterable<InventoryEntry> {
  for (const item of items) {
    yield item;
  }
}

/** Wrap a Promise of an array (e.g. `adapter.discover(url)` result) into an async iterable. */
export async function* fromPromise(p: Promise<InventoryEntry[]>): AsyncIterable<InventoryEntry> {
  const items = await p;
  yield* fromArray(items);
}

/**
 * Take the first N entries from a stream. Useful for capping streaming runs
 * during tests or quick previews without burning the whole crawl.
 */
export async function* take<T>(source: AsyncIterable<T>, n: number): AsyncIterable<T> {
  if (n <= 0) return;
  let count = 0;
  for await (const item of source) {
    yield item;
    count += 1;
    if (count >= n) return;
  }
}

/**
 * Filter a stream by predicate. Same shape as Array.filter but lazy.
 */
export async function* filter<T>(
  source: AsyncIterable<T>,
  pred: (x: T) => boolean,
): AsyncIterable<T> {
  for await (const item of source) {
    if (pred(item)) yield item;
  }
}
