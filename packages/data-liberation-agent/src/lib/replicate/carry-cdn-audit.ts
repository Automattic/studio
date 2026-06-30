/**
 * Residual external-asset audit (carry-and-scope path).
 * =====================================================
 * A fully self-hosted replica must load NO assets from an external host — every
 * `<img src>`/`srcset` and CSS `url()` should resolve to the local site (relative,
 * `/wp-content/...`, or the localhost preview) or `data:`. This scans the assembled
 * islands + theme CSS/parts and returns any asset ref still pointing at an external
 * host, so the pipeline can ASSERT self-hosting instead of assuming it (and a human
 * never has to forensically grep for `wixstatic`/`parastorage`/etc).
 *
 * Scope is deliberately ASSET positions only — `<img src>`, `<img>/<source> srcset`,
 * CSS `url()`. It does NOT flag `<iframe src>` (intentional embeds: YouTube/Maps) or
 * `<a href>` (editorial links to external sites are content, not asset deps). Handles
 * protocol-relative `//host/…` (the form Wix uses for parastorage fonts).
 */

const IMG_SRC = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
const SRCSET = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
const CSS_URL = /url\(\s*['"]?([^'")]+?)['"]?\s*\)/gi;
const URL_IN_SRCSET = /(?:https?:)?\/\/[^\s"'<>\\]+/g;

function hostOf(url: string): string | null {
  const abs = url.startsWith('//') ? `https:${url}` : url;
  try {
    const parsed = new URL(abs);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export interface ExternalAssetRefs {
  /** Distinct external asset refs (absolute or protocol-relative, non-local). */
  refs: Array<{ url: string; host: string }>;
  /** Count per host. */
  byHost: Record<string, number>;
  /** Up to 10 sample URLs for the report. */
  samples: string[];
}

/** Find external asset refs (src/srcset/url) across the given HTML/CSS texts. */
export function findExternalAssetRefs(texts: string[]): ExternalAssetRefs {
  const seen = new Set<string>();
  const refs: Array<{ url: string; host: string }> = [];
  const add = (raw: string): void => {
    const url = raw.trim();
    if (!/^(?:https?:)?\/\//i.test(url)) return; // only absolute or protocol-relative
    const host = hostOf(url);
    if (!host || isLocalHost(host)) return;
    if (seen.has(url)) return;
    seen.add(url);
    refs.push({ url, host });
  };

  for (const text of texts) {
    if (!text) continue;
    let m: RegExpExecArray | null;
    IMG_SRC.lastIndex = 0;
    while ((m = IMG_SRC.exec(text)) !== null) add(m[1]);
    SRCSET.lastIndex = 0;
    while ((m = SRCSET.exec(text)) !== null) {
      const re = new RegExp(URL_IN_SRCSET.source, 'g');
      let u: RegExpExecArray | null;
      while ((u = re.exec(m[1])) !== null) add(u[0]);
    }
    CSS_URL.lastIndex = 0;
    while ((m = CSS_URL.exec(text)) !== null) add(m[1]);
  }

  const byHost: Record<string, number> = {};
  for (const r of refs) byHost[r.host] = (byHost[r.host] ?? 0) + 1;
  return { refs, byHost, samples: refs.slice(0, 10).map((r) => r.url) };
}
