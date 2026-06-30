// src/lib/replicate/download-section-media.ts
// Bounded-concurrency fetch of the section-spec media that the content-extraction phase
// never saw (CSS background images, full-bleed/sibling heroes). The reconstruct handler
// used to fetch these one at a time — a serial network loop that dominated wall-clock on
// media-heavy sites. These are independent I/O-bound fetches, so a worker pool cuts the
// wall-clock to ~(slowest / concurrency). Dedup against already-downloaded media stays the
// caller's job (via `isAlreadyDone`), so nothing extraction already fetched is re-fetched.

export interface DownloadSectionMediaOpts {
  /** Candidate source URLs collected from the section specs (may contain dupes / non-http). */
  srcUrls: Iterable<string>;
  /** True when this URL was already downloaded (e.g. a media-stub success) — skip it. */
  isAlreadyDone: (url: string) => boolean;
  /** Fetch one URL; resolve to its local path, or null when nothing was written. */
  download: (url: string) => Promise<string | null>;
  /** Record a successful download (e.g. mark the media stub). */
  onSuccess: (url: string, localPath: string) => void;
  /** Max concurrent downloads. Default 8, clamped to [1, 16]. */
  concurrency?: number;
}

/** Worker-pool download. Returns the number of NEW files fetched. Best-effort: a single
 *  failed fetch is swallowed (it becomes a flagged placeholder downstream) and never
 *  aborts the others. */
export async function downloadSectionMedia(
  opts: DownloadSectionMediaOpts,
): Promise<{ downloaded: number }> {
  const cap = Math.max(1, Math.min(16, opts.concurrency ?? 8));

  // Dedup + filter to fetchable, not-already-done URLs, preserving first-seen order.
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const u of opts.srcUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    if (!/^https?:/i.test(u)) continue;
    if (opts.isAlreadyDone(u)) continue;
    queue.push(u);
  }

  let downloaded = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    // `next++` is synchronous, so workers never claim the same index (no race).
    while (next < queue.length) {
      const url = queue[next++];
      try {
        const localPath = await opts.download(url);
        if (localPath) {
          opts.onSuccess(url, localPath);
          downloaded += 1;
        }
      } catch {
        /* best-effort — a missing image becomes a flagged placeholder downstream */
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(cap, queue.length) }, () => worker()));
  return { downloaded };
}
