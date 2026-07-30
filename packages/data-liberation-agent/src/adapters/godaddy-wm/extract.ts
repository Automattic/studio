import type { WxrBuilder } from '../../lib/wxr/index.js';
import type { ExtractionLog } from '../../lib/resume-state/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { runExtractionLoop } from '../shared.js';
import { slugify } from '../../lib/url/index.js';
import { extractMeta, extractTitle, IMAGE_EXTENSIONS } from '../../lib/html-extract/index.js';
import type { GoDaddyWmInventory, GoDaddyWmAdapterOpts, DraftContentState } from './types.js';
import { extractContent, extractHeading, escapeHtml, parseBlogData } from './content.js';
import { draftToHtml } from './draft.js';
import { upgradeIsteamUrl, extractWmMediaUrls } from './media.js';

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
  const inv = inventory as GoDaddyWmInventory;
  const wmOpts = opts as GoDaddyWmAdapterOpts;
  const delayMs = wmOpts.delay != null ? wmOpts.delay : 300;
  const outputDir = wmOpts.outputDir || '';

  return runExtractionLoop({
    urls: inv.urls,
    navigation: inv.navigation,
    wxr,
    log: context.log,
    outputDir,
    delay: delayMs,
    dryRun: !!wmOpts.dryRun,
    resume: !!wmOpts.resume,
    verbose: wmOpts.verbose,
    limit: wmOpts.limit,
    server: context.server,
    onPageExtracted: wmOpts.onPageExtracted as never,
    extractPage: async (url: string) => {
      let html = '';
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataLiberation/1.0)' },
        });
        if (resp.ok) {
          html = await resp.text();
        } else {
          await resp.body?.cancel();
        }
      } catch {
        // Network error
      }

      // W+M blog posts hydrate from window._BLOG_DATA — prefer JSON-sourced
      // title/date/content/categories/media over DOM-scraped values. Pages
      // and other URL types fall through to DOM extraction.
      const blogData = parseBlogData(html);
      const blogPost = blogData?.post;

      let content: string;
      let title: string;
      let date: string;
      let categories: string[] = [];
      let detectedType: 'post' | undefined;

      if (blogPost && typeof blogPost.fullContent === 'string') {
        try {
          const draft = JSON.parse(blogPost.fullContent) as DraftContentState;
          // Drop the first block if it's an atomic image matching the
          // post's featuredImage — otherwise the post body leads with the
          // same image that's already attached via mediaUrls.
          const featured = blogPost.featuredImage || '';
          if (featured && draft.blocks?.length) {
            const first = draft.blocks[0];
            if (first.type === 'atomic' && (first.entityRanges?.length ?? 0) > 0) {
              const ent = draft.entityMap?.[String(first.entityRanges![0].key)];
              if (ent?.type === 'IMAGE') {
                let src = String(ent.data?.src || '');
                if (src.startsWith('//')) src = `https:${src}`;
                // Normalize: strip protocol + trailing query
                const norm = (u: string) => u.replace(/^https?:/, '').split('?')[0];
                if (norm(src) === norm(featured)) {
                  draft.blocks = draft.blocks.slice(1);
                }
              }
            }
          }
          content = draftToHtml(draft);
        } catch {
          // Malformed Draft.js payload — fall back to the plain-text excerpt
          content = blogPost.content ? `<p>${escapeHtml(blogPost.content)}</p>` : '';
        }
        title = blogPost.title || extractHeading(html) || slugify(url);
        date = blogPost.publishedDate || blogPost.date || '';
        categories = Array.isArray(blogPost.categories) ? blogPost.categories : [];
        detectedType = 'post';
      } else {
        content = extractContent(html);
        title = extractHeading(html) || slugify(url);
        const articleDate = extractMeta(html, 'article:published_time');
        const timeElement = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
        date = articleDate || timeElement || '';
      }

      const excerpt =
        (blogPost?.content && blogPost.content.replace(/\.{3}$/, '').trim()) ||
        extractMeta(html, 'og:description') ||
        extractMeta(html, 'description') ||
        '';
      const seoTitle = extractMeta(html, 'og:title') || extractTitle(html) || title;
      const seoDescription = excerpt;

      const author = extractMeta(html, 'author') || undefined;

      const mediaUrls = extractWmMediaUrls(html);
      // Also harvest media referenced from inside the Draft.js content we just built.
      // The Draft.js renderer already upgraded URLs via upgradeIsteamUrl, so these
      // match what was embedded in the body HTML.
      if (content) {
        const contentImgs = content.match(/https?:\/\/img1\.wsimg\.com\/isteam\/[^\s"'<>)]+/g) || [];
        for (const u of contentImgs) if (!mediaUrls.includes(u)) mediaUrls.push(u);
      }
      // And the W+M featuredImage field (upgrade to match body references)
      if (blogPost?.featuredImage) {
        const upgraded = upgradeIsteamUrl(blogPost.featuredImage);
        if (!mediaUrls.includes(upgraded)) mediaUrls.push(upgraded);
      }

      const ogImage = extractMeta(html, 'og:image');
      if (ogImage && ogImage.startsWith('http')) {
        const upgraded = upgradeIsteamUrl(ogImage);
        if (!mediaUrls.includes(upgraded)) {
          try {
            const p = new URL(upgraded);
            // Accept isteam URLs even without an extension
            if (/^img1\.wsimg\.com$/i.test(p.hostname) || IMAGE_EXTENSIONS.test(p.pathname)) {
              mediaUrls.push(upgraded);
            }
          } catch { /* invalid URL */ }
        }
      }

      let qualityScore: 'high' | 'medium' | 'low' = 'low';
      if (content.length > 500) qualityScore = 'high';
      else if (content.length > 100) qualityScore = 'medium';

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
        categories,
        tags: [],
        author,
        detectedType,
      };
    },
  });
}
