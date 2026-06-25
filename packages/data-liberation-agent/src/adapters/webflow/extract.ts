import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { WebflowInventory, WebflowAdapterOpts } from './discover.js';

// ---------------------------------------------------------------------------
// HTML helpers (regex-based, no DOM parser dependency)
// ---------------------------------------------------------------------------

/**
 * Extract content from Webflow's .w-richtext container.
 * Falls back to <main>, <article>, or common content selectors.
 */
function extractContent(html: string): string {
  // Strategy 1: Webflow rich text container (w-richtext class)
  // Use a greedy approach — find the opening tag, then match balanced divs
  const richTextStart = html.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>/i);
  if (richTextStart) {
    const startIdx = html.indexOf(richTextStart[0]);
    const afterTag = startIdx + richTextStart[0].length;
    // Find the matching closing </div> by tracking nesting
    let depth = 1;
    let i = afterTag;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i);
      const nextClose = html.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          return html.slice(afterTag, nextClose).trim();
        }
        i = nextClose + 6;
      }
    }
  }

  // Strategy 2: <article> tag
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1]?.trim()) return articleMatch[1].trim();

  // Strategy 3: <main> tag
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]?.trim()) return mainMatch[1].trim();

  return '';
}

/**
 * Extract heading from the page — tries h1, then h2, then <title>.
 */
function extractHeading(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g, '').trim();
  if (h1) return h1;

  const h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]*>/g, '').trim();
  if (h2) return h2;

  return extractTitle(html);
}

/**
 * Extract media URLs from Webflow content.
 * Looks for cdn.prod.website-files.com, website-files.com, and <img> src attributes.
 */
function extractWebflowMediaUrls(html: string): string[] {
  const urls = new Set<string>();

  // Webflow CDN URLs
  const cdnPattern = /https?:\/\/cdn\.prod\.website-files\.com\/[^\s"'<>)]+/g;
  const cdnMatches = html.match(cdnPattern) || [];
  for (const m of cdnMatches) urls.add(m);

  // Broader website-files.com pattern
  const wfPattern = /https?:\/\/[^\s"'<>)]*website-files\.com\/[^\s"'<>)]+/g;
  const wfMatches = html.match(wfPattern) || [];
  for (const m of wfMatches) urls.add(m);

  // Standard <img> tags
  const imgSrcMatches = html.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
  for (const match of imgSrcMatches) {
    const src = match.match(/src=["']([^"']+)["']/i);
    if (src?.[1] && src[1].startsWith('http')) {
      urls.add(src[1]);
    }
  }

  // Filter to actual image URLs (not CSS, JS, or other assets)
  const imageExtensions = IMAGE_EXTENSIONS;
  const nonImageExtensions = /\.(css|js|json|xml|txt|map|woff2?|ttf|eot|pdf)$/i;
  return [...urls].filter((u) => {
    try {
      const parsed = new URL(u);
      if (nonImageExtensions.test(parsed.pathname)) return false;
      return imageExtensions.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

export async function extractWebflow(
  inventory: unknown,
  wxr: WxrBuilder,
  opts: Record<string, unknown>,
  context: { log: ExtractionLog; server: Server }
): Promise<{
  pagesExtracted: number;
  postsExtracted: number;
  productsExtracted: number;
  failed: number;
  mediaCollected: number;
}> {
  const inv = inventory as WebflowInventory;
  const wfOpts = opts as WebflowAdapterOpts;
  const delayMs = wfOpts.delay != null ? wfOpts.delay : 300;
  const outputDir = wfOpts.outputDir || '';

  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !wfOpts.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  const result = await runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!wfOpts.dryRun,
    resume: !!wfOpts.resume,
    verbose: wfOpts.verbose,
    limit: wfOpts.limit,
    server: context.server,
    csvBuilder,
    onPageExtracted: wfOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      // Fetch the page HTML
      let html = '';
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)',
          },
        });
        if (resp.ok) {
          html = await resp.text();
        } else {
          await resp.body?.cancel();
        }
      } catch {
        // Network error
      }

      // Extract content
      const content = extractContent(html);
      const title = extractHeading(html) || slugify(url);
      const excerpt = extractMeta(html, 'og:description') || extractMeta(html, 'description') || '';
      const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
      const seoDescription = excerpt;

      // Extract date from meta tags or time elements
      const articleDate = extractMeta(html, 'article:published_time');
      const timeElement = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
      const date = articleDate || timeElement || '';

      // Extract media
      const mediaUrls = extractWebflowMediaUrls(html);

      // Extract OG image (apply same image-extension filter)
      const ogImage = extractMeta(html, 'og:image');
      if (ogImage && ogImage.startsWith('http') && !mediaUrls.includes(ogImage)) {
        const imageExtensions = IMAGE_EXTENSIONS;
        try {
          if (imageExtensions.test(new URL(ogImage).pathname)) {
            mediaUrls.push(ogImage);
          }
        } catch { /* invalid URL */ }
      }

      // Extract author from meta tag or JSON-LD
      let author: string | undefined = extractMeta(html, 'article:author') || undefined;
      if (!author) {
        const ldMatch = html.match(/"author"\s*:\s*\{\s*"@type"\s*:\s*"Person"\s*,\s*"name"\s*:\s*"([^"]+)"/);
        if (ldMatch) author = ldMatch[1];
      }
      if (!author) {
        const ldAuthorStr = html.match(/"author"\s*:\s*"([^"]+)"/);
        if (ldAuthorStr) author = ldAuthorStr[1];
      }

      // Quality score
      let qualityScore: 'high' | 'medium' | 'low' = 'low';
      if (content.length > 200) qualityScore = 'high';
      else if (content.length > 50) qualityScore = 'medium';

      return {
        title,
        slug: slugify(url),
        content,
        excerpt,
        date,
        seoTitle,
        seoDescription,
        mediaUrls,
        qualityScore,
        categories: [],
        tags: [],
        author,
      };
    },
  });

  if (result.productsExtracted > 0 && outputDir && !wfOpts.dryRun) {
    if (csvBuilder.isStreaming) {
      csvBuilder.closeStream();
    } else {
      csvBuilder.serialize(`${outputDir}/products.csv`);
    }
  }

  return result;
}
