import { dirname, join, basename } from 'path';
import { appendFileSync, writeFileSync } from 'fs';
import { readWxr } from '../wxr/index.js';
import { WxrBuilder } from '../wxr/index.js';
import { parseContent } from '../extraction/content-parser.js';
import { diffContent, type ContentDiff } from './content-differ.js';
import type { PageItem, PostItem, MenuItem } from '../wxr/index.js';

export interface QaOptions {
  wxrFile: string;
  fix?: boolean;
  onProgress?: (current: number, total: number, slug: string) => void;
}

export interface PageResult {
  slug: string;
  sourceUrl: string;
  grade: 'pass' | 'warn' | 'fail' | 'error';
  diff: ContentDiff;
  error?: string;
  fixed?: string;
}

export interface QaResult {
  pages: PageResult[];
  skipped: number;
  summary: { pass: number; warn: number; fail: number; error: number; fixed: number };
}

const emptyDiff: ContentDiff = {
  textSimilarity: 0,
  headingsMatch: { origin: 0, wxr: 0, missing: 0 },
  imagesMatch: { origin: 0, wxr: 0, missing: 0 },
  linksMatch: { origin: 0, wxr: 0, missing: 0 },
  missingHeadings: [],
  missingImages: [],
  missingLinks: [],
  grade: 'fail',
};

export async function runQa(opts: QaOptions): Promise<QaResult> {
  const wxrData = readWxr(opts.wxrFile);
  const logPath = join(dirname(opts.wxrFile), 'qa-log.jsonl');

  // Clear the log file
  writeFileSync(logPath, '', 'utf8');

  // Filter to pages and posts with sourceUrl
  const candidates = wxrData.items.filter(
    (item) => (item.type === 'page' || item.type === 'post') && 'sourceUrl' in item,
  ) as Array<{ type: 'page' | 'post'; slug: string; title: string; content: string; sourceUrl: string }>;

  const withUrl = candidates.filter((item) => item.sourceUrl);
  const skipped = candidates.length - withUrl.length;

  const pages: PageResult[] = [];
  const summary = { pass: 0, warn: 0, fail: 0, error: 0, fixed: 0 };

  for (let i = 0; i < withUrl.length; i++) {
    const item = withUrl[i];
    opts.onProgress?.(i + 1, withUrl.length, item.slug);

    let result: PageResult;

    try {
      // Retry with backoff on 429
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(item.sourceUrl);
        if (response.status === 429) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
      }
      const originHtml = await response.text();

      const originModel = parseContent(originHtml, true);
      const wxrModel = parseContent(item.content);
      const diff = diffContent(originModel, wxrModel, item.title);

      result = {
        slug: item.slug,
        sourceUrl: item.sourceUrl,
        grade: diff.grade,
        diff,
      };
    } catch (err) {
      result = {
        slug: item.slug,
        sourceUrl: item.sourceUrl,
        grade: 'error',
        diff: emptyDiff,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Small delay between requests to avoid rate limiting
    if (i < withUrl.length - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }

    pages.push(result);
    summary[result.grade]++;

    // Append to JSONL log
    appendFileSync(logPath, JSON.stringify(result) + '\n', 'utf8');
  }

  // Fix phase: patch WXR content for fixable issues
  if (opts.fix) {
    const fixablePages = pages.filter(
      (p) => p.grade === 'warn' || p.grade === 'fail',
    );

    if (fixablePages.length > 0) {
      // Re-read WXR for full data needed for re-serialization
      const freshWxr = readWxr(opts.wxrFile);

      for (const pageResult of fixablePages) {
        try {
          const response = await fetch(pageResult.sourceUrl);
          const originHtml = await response.text();
          const originModel = parseContent(originHtml, true);

          // Build a map of origin images: filename -> alt text
          const originAltMap = new Map<string, string>();
          for (const img of originModel.images) {
            if (img.alt) {
              const filename = basename(new URL(img.src, pageResult.sourceUrl).pathname);
              originAltMap.set(filename, img.alt);
            }
          }

          // Find the item in freshWxr and patch its content
          const wxrItem = freshWxr.items.find(
            (item) =>
              (item.type === 'page' || item.type === 'post') &&
              item.slug === pageResult.slug,
          ) as PageItem | PostItem | undefined;

          if (!wxrItem) continue;

          const fixes: string[] = [];

          // Fix missing image alt text
          const patchedContent = wxrItem.content.replace(
            /<img\s([^>]*?)>/gi,
            (fullMatch: string, attrs: string) => {
              // Skip if already has alt text
              if (/alt\s*=\s*(?:"[^"]+"|'[^']+')/i.test(attrs)) {
                return fullMatch;
              }

              // Extract src to match by filename
              const srcMatch = /src\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
              const src = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? '') : '';
              if (!src) return fullMatch;

              let filename: string;
              try {
                filename = basename(new URL(src, 'https://placeholder.com').pathname);
              } catch {
                return fullMatch;
              }

              const originAlt = originAltMap.get(filename);
              if (!originAlt) return fullMatch;

              const safeAlt = originAlt.replace(/"/g, '&quot;');
              fixes.push(`added alt text to ${filename}`);
              // Add alt attribute — replace empty alt or insert alt
              if (/alt\s*=\s*""/i.test(attrs)) {
                return `<img ${attrs.replace(/alt\s*=\s*""/i, `alt="${safeAlt}"`)}>`;
              }
              return `<img ${attrs} alt="${safeAlt}">`;
            },
          );

          if (fixes.length > 0) {
            wxrItem.content = patchedContent;
            pageResult.fixed = fixes.join('; ');
            summary.fixed++;

            // Log fix to qa-log.jsonl
            appendFileSync(
              logPath,
              JSON.stringify({ type: 'fix', slug: pageResult.slug, fixed: pageResult.fixed }) + '\n',
              'utf8',
            );
          }
        } catch {
          // Skip pages that fail to fetch during fix phase
        }
      }

      // Re-serialize the WXR if any fixes were applied
      if (summary.fixed > 0) {
        const builder = new WxrBuilder(freshWxr.site);

        for (const author of freshWxr.authors) {
          builder.addAuthor(author);
        }
        for (const category of freshWxr.categories) {
          builder.addCategory(category);
        }
        for (const tag of freshWxr.tags) {
          builder.addTag(tag);
        }
        for (const term of freshWxr.terms) {
          builder.addTerm(term);
        }
        for (const comment of freshWxr.comments) {
          builder.addComment({
            postId: comment.postId,
            author: comment.author,
            authorEmail: comment.authorEmail,
            authorUrl: comment.authorUrl,
            authorIp: comment.authorIp,
            date: comment.date,
            content: comment.content,
            approved: comment.approved === '1',
            type: comment.type,
            parent: comment.parent,
            userId: comment.userId,
          });
        }
        for (const redirect of freshWxr.redirects) {
          builder.addRedirect(redirect);
        }
        for (const item of freshWxr.items) {
          switch (item.type) {
            case 'attachment':
              builder.addMedia(item);
              break;
            case 'page':
              builder.addPage(item);
              break;
            case 'post':
              builder.addPost(item);
              break;
            case 'nav_menu_item':
              builder.addMenuItem({ ...item, order: item.menuOrder });
              break;
          }
        }

        builder.serialize(opts.wxrFile);
      }
    }
  }

  return { pages, skipped, summary };
}
