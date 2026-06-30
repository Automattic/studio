import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import type { SqsJsonResponse } from './types.js';

/**
 * Fetch a Squarespace URL with `?format=json` appended. Pure fetch, no Playwright.
 */
export async function fetchSqsJson(url: string): Promise<SqsJsonResponse | null> {
  try {
    const separator = url.includes('?') ? '&' : '?';
    const jsonUrl = `${url}${separator}format=json`;
    const resp = await fetch(jsonUrl, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)',
      },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as SqsJsonResponse;
  } catch {
    return null;
  }
}

/**
 * Extract media URLs from Squarespace content. Looks for images.squarespace-cdn.com
 * and other common Squarespace image patterns.
 */
export function extractSquarespaceMediaUrls(html: string, assetUrl?: string): string[] {
  const urls = new Set<string>();

  if (assetUrl) urls.add(assetUrl);

  // Squarespace CDN image URLs
  const cdnPattern = /https?:\/\/images\.squarespace-cdn\.com\/content\/[^\s"'<>)]+/g;
  const cdnMatches = html.match(cdnPattern) || [];
  for (const m of cdnMatches) urls.add(m);

  // Static Squarespace assets
  const staticPattern = /https?:\/\/static1?\.squarespace\.com\/static\/[^\s"'<>)]+/g;
  const staticMatches = html.match(staticPattern) || [];
  for (const m of staticMatches) urls.add(m);

  // Standard <img> tags
  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (const match of imgSrcMatches) {
    const src = match.match(/src=["']([^"']+)["']/i);
    if (src?.[1] && src[1].startsWith('http')) {
      urls.add(src[1]);
    }
  }

  // Filter to image-like URLs
  const imageExtensions = IMAGE_EXTENSIONS;
  const imageCdns = /squarespace-cdn\.com|squarespace\.com\/static/i;
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      return imageExtensions.test(parsed.pathname) || imageCdns.test(parsed.hostname + parsed.pathname);
    } catch {
      return false;
    }
  });
}

/**
 * Format a Squarespace timestamp (ms since epoch) to ISO string.
 */
export function sqsTimestampToIso(ts?: number): string {
  if (!ts) return new Date().toISOString();
  return new Date(ts).toISOString();
}

// ---------------------------------------------------------------------------
// Playwright DOM fallback — used when ?format=json returns empty mainContent
// (Squarespace 7.1 fluid engine sites render content client-side)
// Inspired by scripts/squarespace/extract.js: getDomSections / extractPublicDomRecord
// ---------------------------------------------------------------------------

export async function extractDomContent(
  page: unknown,
  url: string
): Promise<{ content: string; mediaUrls: string[]; title: string }> {
  const p = page as {
    goto(url: string, opts: Record<string, unknown>): Promise<unknown>;
    evaluate(fn: () => unknown): Promise<unknown>;
    waitForLoadState(state: string, opts: Record<string, unknown>): Promise<void>;
    title(): Promise<string>;
    context(): {
      newCDPSession(page: unknown): Promise<{
        send(method: string, params: Record<string, unknown>): Promise<unknown>;
        detach(): Promise<void>;
      }>;
    };
  };

  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await p.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* timeout ok */ }

  const title = await p.title().catch(() => '');

  // Extract content from rendered DOM — mirrors legacy getDomSections()
  const domResult = (await p.evaluate(() => {
    const container = document.querySelector('main')
      || document.querySelector('[role="main"]')
      || document.body;

    const elements = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, img, blockquote, figcaption')];
    const blocks: string[] = [];
    const mediaUrls: string[] = [];
    const seen = new Set<string>();

    for (const el of elements.slice(0, 250)) {
      if (el.tagName === 'IMG') {
        const src = (el as HTMLImageElement).src;
        const alt = (el as HTMLImageElement).alt || '';
        if (src && src.startsWith('http')) {
          mediaUrls.push(src);
          if (!seen.has(src)) {
            seen.add(src);
            blocks.push(`<img src="${src}" alt="${alt}" />`);
          }
        }
        continue;
      }

      const text = (el as HTMLElement).innerText?.trim();
      if (!text || seen.has(text)) continue;

      // Skip navigation chrome
      if (['Skip to Content', 'SKIP TO CONTENT'].includes(text)) continue;

      seen.add(text);
      const tag = el.tagName.toLowerCase();
      if (tag.startsWith('h')) {
        blocks.push(`<${tag}>${text}</${tag}>`);
      } else if (tag === 'li') {
        blocks.push(`<li>${text}</li>`);
      } else if (tag === 'blockquote') {
        blocks.push(`<blockquote>${text}</blockquote>`);
      } else if (tag === 'figcaption') {
        blocks.push(`<figcaption>${text}</figcaption>`);
      } else {
        blocks.push(`<p>${text}</p>`);
      }
    }

    return { blocks, mediaUrls };
  })) as { blocks: string[]; mediaUrls: string[] };

  // Accessibility tree fallback if DOM produced nothing
  let content = domResult.blocks.join('\n');
  if (!content) {
    try {
      const session = await p.context().newCDPSession(page);
      const ax = (await session.send('Accessibility.getFullAXTree', { depth: 10 })) as {
        nodes?: Array<{ role?: { value: string }; name?: { value: string } }>;
      };
      const parts: string[] = [];
      for (const node of ax.nodes || []) {
        const role = node.role?.value || '';
        const name = node.name?.value || '';
        if (!name) continue;
        if (role === 'heading') parts.push(`<h2>${name}</h2>`);
        else if (['paragraph', 'StaticText'].includes(role)) parts.push(`<p>${name}</p>`);
      }
      content = parts.join('\n');
      await session.detach();
    } catch { /* CDP failed — non-fatal */ }
  }

  return {
    content,
    mediaUrls: domResult.mediaUrls,
    title,
  };
}
