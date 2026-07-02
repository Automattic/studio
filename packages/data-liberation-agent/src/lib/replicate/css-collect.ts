import * as cheerio from 'cheerio';

export interface CollectOpts {
  html: string;
  inlineStyleText: string;
  baseUrl: string;
  /** Override for tests; defaults to global fetch -> text. */
  fetcher?: (url: string) => Promise<string>;
  /** Called for each sheet that fails to fetch (non-breaking; caller decides logging). */
  onError?: (url: string, err: unknown) => void;
}

const defaultFetcher = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct && !/css|text\/plain/i.test(ct)) throw new Error(`non-CSS content-type (${ct}) for ${url}`);
  return res.text();
};

export async function collectCss(opts: CollectOpts): Promise<string> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const $ = cheerio.load(opts.html);
  const seen = new Set<string>();
  const hrefs: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      try {
        const resolved = new URL(href, opts.baseUrl).toString();
        if (!seen.has(resolved)) {
          seen.add(resolved);
          hrefs.push(resolved);
        }
      } catch { /* skip unparseable hrefs */ }
    }
  });
  const sheets: string[] = [];
  if (opts.inlineStyleText.trim()) sheets.push(opts.inlineStyleText);
  // Fetch in parallel; preserve source order via the deduped hrefs index. Keep-going on failure.
  const results = await Promise.allSettled(hrefs.map((url) => fetcher(url)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') sheets.push(r.value);
    else opts.onError?.(hrefs[i], r.reason);
  });
  return sheets.join('\n\n');
}
