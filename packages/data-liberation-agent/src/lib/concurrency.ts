/**
 * Concurrency-bounded worker pool.
 *
 * Runs `fn` over `items` with at most `concurrency` in flight at once, pulling from a
 * shared cursor — NOT per-batch barriers. A slow item therefore never stalls the others:
 * every worker keeps pulling the next item until the queue drains. Results are returned
 * in INPUT order regardless of completion order, so callers that need determinism get it
 * for free. `concurrency` is floored at 1 (and capped at the item count).
 *
 * This is the single engine behind the parallel captures (carry replica-shots, block-path
 * verify, …). Per-item retry/backoff and any side-effects belong in `fn`, not here — the
 * pool only governs how many run at once.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    // `cursor++` reads-then-increments synchronously (no await in between), so two
    // workers can never claim the same index.
    for (let i = cursor++; i < items.length; i = cursor++) {
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
