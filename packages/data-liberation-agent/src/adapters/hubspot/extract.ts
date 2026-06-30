import * as cheerio from 'cheerio';
import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, extractHeading } from '../../lib/html-extract/index.js';
import { WooProductCsvBuilder } from '../../lib/woo-csv/index.js';
import type { HubSpotInventory, HubSpotAdapterOpts } from './types.js';
import { MAX_HTML_BYTES } from './constants.js';
import { NON_IMAGE_EXTENSIONS, extractHubSpotMediaUrls } from './media.js';
import { extractHubSpotDate, extractHubSpotAuthor, extractHubSpotTags } from './metadata.js';
import {
  isHubSpotBlogPost,
  extractContent,
  finalizeContentHtml,
  stripDuplicateTitle,
} from './content.js';
import { looksLikeBlogPostPath, normalizeUrl, parseOrigin } from './url.js';
import { IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js'; // used for og:image filtering below

export async function extract(
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
  const inv = inventory as HubSpotInventory;
  const hsOpts = opts as HubSpotAdapterOpts;
  const delayMs = hsOpts.delay != null ? hsOpts.delay : 300;
  const outputDir = hsOpts.outputDir || '';

  const csvBuilder = new WooProductCsvBuilder();
  if (outputDir && !hsOpts.dryRun) {
    csvBuilder.openStream(outputDir);
  }

  const result = await runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!hsOpts.dryRun,
    resume: !!hsOpts.resume,
    verbose: hsOpts.verbose,
    limit: hsOpts.limit as number | undefined,
    server: context.server,
    csvBuilder,
    onPageExtracted: hsOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
      });
      if (!resp.ok) {
        await resp.body?.cancel();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }
      let html = await resp.text();
      if (html.length > MAX_HTML_BYTES) {
        html = html.slice(0, MAX_HTML_BYTES);
      }

      const $ = cheerio.load(html);

      // `hs-blog-post` class (on <body> or a body-wrapper div) is the
      // authoritative HubSpot signal. Fall back to URL path heuristic for
      // sites with heavily customized templates that don't emit it.
      const isPost = isHubSpotBlogPost($) || looksLikeBlogPostPath(url);

      const title = extractHeading(html) || slugify(url);

      // HubSpot blog metadata lives in `.blog-post__*` classes that
      // extractContent strips from the DOM. Capture them BEFORE content
      // extraction runs, then let stripWidgets remove them from the post body.
      const summaryText = $('.blog-post__summary').first().text().replace(/\s+/g, ' ').trim();
      const excerpt = summaryText
        || extractMeta(html, 'og:description')
        || extractMeta(html, 'description')
        || '';
      const date = isPost ? extractHubSpotDate($, html) : '';
      const author = isPost ? extractHubSpotAuthor($, html) : undefined;
      // HubSpot has a single flat taxonomy ("Topics") — no distinction
      // between categories and tags. We map them to WordPress categories
      // because most themes use category archives for primary navigation;
      // landing them as tags tends to leave category archives empty on the
      // imported site. Note: the WXR builder's streaming mode writes the
      // taxonomy section at open time, so late-registered <wp:category>
      // entries may not persist — a shared-code limitation.
      const topicCategories = isPost ? extractHubSpotTags($) : [];

      // Strip duplicate <h1> title before serializing, then extract content.
      stripDuplicateTitle($, title);
      const contentHtml = extractContent($);
      const content = finalizeContentHtml(contentHtml, url);

      const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
      const seoDescription = extractMeta(html, 'og:description') || extractMeta(html, 'description') || excerpt;

      const mediaUrls = extractHubSpotMediaUrls($, url);

      const ogImage = extractMeta(html, 'og:image');
      if (ogImage && !mediaUrls.includes(ogImage)) {
        const absolute = normalizeUrl(ogImage, parseOrigin(url));
        if (absolute) {
          try {
            const parsed = new URL(absolute);
            if (
              !NON_IMAGE_EXTENSIONS.test(parsed.pathname) &&
              (IMAGE_EXTENSIONS.test(parsed.pathname) ||
                /hubspotusercontent/i.test(parsed.hostname) ||
                /\/hubfs\//.test(parsed.pathname))
            ) {
              mediaUrls.push(absolute);
            }
          } catch { /* invalid URL */ }
        }
      }

      const textOnly = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      let qualityScore: 'high' | 'medium' | 'low' = 'low';
      if (textOnly.length > 200) qualityScore = 'high';
      else if (textOnly.length > 50) qualityScore = 'medium';

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
        categories: topicCategories,
        tags: [],
        author,
        // If body class confirms a blog post, signal 'post'. Otherwise leave
        // undefined so the shared loop falls back to inventory/URL classification
        // — some HubSpot sites use custom themes that strip the default
        // hs-blog-post body class, so absence of that class does NOT prove
        // a page isn't a blog post.
        detectedType: isPost ? 'post' : undefined,
      };
    },
  });

  if (result.productsExtracted > 0 && outputDir && !hsOpts.dryRun) {
    if (csvBuilder.isStreaming) {
      csvBuilder.closeStream();
    } else {
      csvBuilder.serialize(`${outputDir}/products.csv`);
    }
  }

  return result;
}
