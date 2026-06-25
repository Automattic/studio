import { readFileSync, existsSync, appendFileSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { readWxr } from '../wxr/index.js';
import { deriveFilenameFromUrl, extensionFromContentType } from '../media-fetch/index.js';
import { WpRestClient } from './wp-rest-client.js';
import { WooCommerceClient } from './woo-rest-client.js';
import { readProductsCsv } from './woo-csv-reader.js';
import type { WxrData } from '../wxr/index.js';
import type {
  Category,
  Tag,
  Term,
  MediaItem,
  PageItem,
  PostItem,
  MenuItem,
  Comment,
} from '../wxr/index.js';

export interface ImportOptions {
  site: string;
  username: string;
  token: string;
  wxrFile: string;
  mediaDir?: string;
  dryRun?: boolean;
  delay?: number;
  verbose?: boolean;
  only?: string;
  /**
   * @deprecated Import is always idempotent — the import log is always consulted.
   * This option is accepted for backwards compatibility but has no effect.
   */
  resume?: boolean;
  /** When true, create WP users for each author in the WXR. When false, all content is owned by the authenticated user. */
  importAuthors?: boolean;
  onProgress?: (stage: string, current: number, total: number, label: string) => void;
  woocommerceKey?: string;
  woocommerceSecret?: string;
}

interface StageResult {
  total: number;
  created: number;
  failed: number;
}

export interface ImportResult {
  media: StageResult;
  categories: StageResult;
  tags: StageResult;
  terms: StageResult;
  pages: StageResult;
  posts: StageResult;
  comments: StageResult;
  menus: StageResult;
  products: StageResult;
  redirectMap: Array<{ from: string; to: string }>;
}

function emptyStage(): StageResult {
  return { total: 0, created: 0, failed: 0 };
}

/**
 * Topological sort for string-keyed parent relationships (categories, terms).
 * Items with no parent (empty string) come first.
 */
function topoSortByParent<T extends { slug: string; parent: string }>(items: T[]): T[] {
  const bySlug = new Map<string, T>();
  for (const item of items) bySlug.set(item.slug, item);

  const sorted: T[] = [];
  const visited = new Set<string>();

  function visit(item: T) {
    if (visited.has(item.slug)) return;
    visited.add(item.slug);
    if (item.parent && bySlug.has(item.parent)) {
      visit(bySlug.get(item.parent)!);
    }
    sorted.push(item);
  }

  for (const item of items) visit(item);
  return sorted;
}

/**
 * Topological sort for number-keyed parent relationships (pages, menu items).
 * Items with parent=0 come first.
 */
function topoSortById<T extends { id: number; parent: number }>(items: T[]): T[] {
  const byId = new Map<number, T>();
  for (const item of items) byId.set(item.id, item);

  const sorted: T[] = [];
  const visited = new Set<number>();

  function visit(item: T) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    if (item.parent && byId.has(item.parent)) {
      visit(byId.get(item.parent)!);
    }
    sorted.push(item);
  }

  for (const item of items) visit(item);
  return sorted;
}

/**
 * Try to find a local file for a media item.
 * Checks localPath first, then media/ subdirectory by filename,
 * then falls back to downloading from the source URL.
 */
async function resolveMediaFile(media: MediaItem, mediaDir: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  // Try localPath first
  if (media.localPath && existsSync(media.localPath)) {
    return { buffer: readFileSync(media.localPath) };
  }

  // Try media/ subdirectory by filename from URL.
  // Use deriveFilenameFromUrl to handle CDN URLs with transform suffixes
  // (e.g. GoDaddy W+M's /:/rs=w:4000,cg:true) the same way downloadMedia does.
  let urlObj: URL;
  try {
    urlObj = new URL(media.url);
  } catch {
    return null; // Invalid URL — can't resolve
  }
  const filename = deriveFilenameFromUrl(urlObj);
  if (filename) {
    const mediaSubdir = join(mediaDir, 'media', filename);
    if (existsSync(mediaSubdir)) {
      return { buffer: readFileSync(mediaSubdir) };
    }
  }

  // Fall back to downloading from source URL
  try {
    const response = await fetch(media.url);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  } catch {
    return null;
  }
}

function logEntry(logPath: string, entry: Record<string, unknown>) {
  appendFileSync(logPath, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
}

export async function importToWordPress(opts: ImportOptions): Promise<ImportResult> {
  const wxr: WxrData = readWxr(opts.wxrFile);
  const mediaDir = opts.mediaDir ?? dirname(opts.wxrFile);
  const logPath = join(dirname(opts.wxrFile), 'import-log.jsonl');
  const dryRun = opts.dryRun ?? false;
  const delay = opts.delay ?? 500;
  const progress = opts.onProgress;

  const validStages = ['categories', 'tags', 'terms', 'media', 'pages', 'posts', 'comments', 'menus', 'products'];
  if (opts.only && !validStages.includes(opts.only)) {
    throw new Error(`Invalid --only value "${opts.only}". Valid: ${validStages.join(', ')}`);
  }

  const client = new WpRestClient({
    site: opts.site,
    username: opts.username,
    token: opts.token,
    delay: opts.delay ?? 500,
  });

  function shouldRun(stage: string): boolean {
    if (!opts.only) return true;
    return opts.only === stage;
  }

  // Resolve the authenticated user — used as the default/fallback author for
  // all imported content so nothing ends up unowned. When importAuthors is
  // false, every post/page is assigned to this user. When importAuthors is
  // true, this is the fallback for any source author that fails to map to a
  // WP user.
  let defaultAuthorId: number | undefined;
  if (!dryRun) {
    try {
      const me = await client.getCurrentUser();
      defaultAuthorId = me.id;
    } catch {
      // Non-fatal — posts will fall back to whatever WP assigns.
    }
  }

  // ID maps
  const mediaIdMap = new Map<number, number>();
  const mediaUrlMap = new Map<string, string>();
  const categoryIdMap = new Map<string, number>();
  const tagIdMap = new Map<string, number>();
  const termIdMap = new Map<string, number>();
  const pageIdMap = new Map<number, number>();
  const postIdMap = new Map<number, number>();
  const menuIdMap = new Map<string, number>();
  const productNameToId = new Map<string, number>();

  // Always read import log to find already-created items and rebuild ID maps.
  // This makes every import idempotent — running it twice never creates duplicates.
  const createdKeys = new Set<string>();
  if (existsSync(logPath)) {
    const logLines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    for (const line of logLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'created') continue;
        switch (entry.stage) {
          case 'categories':
            createdKeys.add(`categories:${entry.slug}`);
            if (entry.wpId) categoryIdMap.set(entry.slug, entry.wpId);
            break;
          case 'tags':
            createdKeys.add(`tags:${entry.slug}`);
            if (entry.wpId) tagIdMap.set(entry.slug, entry.wpId);
            break;
          case 'terms':
            createdKeys.add(`terms:${entry.slug}`);
            if (entry.wpId) termIdMap.set(entry.slug, entry.wpId);
            break;
          case 'media':
            createdKeys.add(`media:${entry.id}`);
            if (entry.wpId) mediaIdMap.set(entry.id, entry.wpId);
            break;
          case 'pages':
            createdKeys.add(`pages:${entry.slug}`);
            if (entry.wpId) pageIdMap.set(entry.wxrId ?? 0, entry.wpId);
            break;
          case 'posts':
            createdKeys.add(`posts:${entry.slug}`);
            if (entry.wpId) postIdMap.set(entry.wxrId ?? 0, entry.wpId);
            break;
          case 'comments':
            createdKeys.add(`comments:${entry.id}`);
            break;
          case 'menus':
            createdKeys.add(`menus:${entry.slug}`);
            if (entry.wpId) menuIdMap.set(entry.slug, entry.wpId);
            break;
          case 'menu-items':
            createdKeys.add(`menu-items:${entry.slug}`);
            break;
          case 'products':
            createdKeys.add(`products:${entry.name}`);
            if (entry.wcId) productNameToId.set(entry.name, entry.wcId);
            break;
          case 'variations':
            createdKeys.add(`variations:${entry.sku}`);
            break;
        }
      } catch { /* skip malformed lines */ }
    }
    if (createdKeys.size > 0) {
      progress?.('resume', createdKeys.size, 0, `${createdKeys.size} items already imported, retrying failures`);
    }
  }

  const result: ImportResult = {
    categories: emptyStage(),
    tags: emptyStage(),
    terms: emptyStage(),
    media: emptyStage(),
    pages: emptyStage(),
    posts: emptyStage(),
    comments: emptyStage(),
    menus: emptyStage(),
    products: emptyStage(),
    redirectMap: [],
  };

  // Extract items by type
  const mediaItems = wxr.items.filter((i): i is MediaItem => i.type === 'attachment');
  const pageItems = wxr.items.filter((i): i is PageItem => i.type === 'page');
  const postItems = wxr.items.filter((i): i is PostItem => i.type === 'post');
  const menuItems = wxr.items.filter((i): i is MenuItem => i.type === 'nav_menu_item');

  // --- 1. Categories ---
  if (shouldRun('categories')) {
    const sorted = topoSortByParent(wxr.categories);
    result.categories.total = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      const cat = sorted[i];
      progress?.('categories', i + 1, sorted.length, cat.slug);
      if (dryRun) continue;
      if (createdKeys.has(`categories:${cat.slug}`)) { result.categories.created++; continue; }
      try {
        const parentWpId = cat.parent ? categoryIdMap.get(cat.parent) : undefined;
        const res = await client.createCategory({
          name: cat.name,
          slug: cat.slug,
          description: cat.description,
          parent: parentWpId,
        });
        categoryIdMap.set(cat.slug, res.id);
        result.categories.created++;
        logEntry(logPath, { type: 'created', stage: 'categories', slug: cat.slug, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.categories.failed++;
        logEntry(logPath, { type: 'failed', stage: 'categories', slug: cat.slug, error: String(err) });
      }
    }
  }

  // --- 2. Tags ---
  if (shouldRun('tags')) {
    result.tags.total = wxr.tags.length;
    for (let i = 0; i < wxr.tags.length; i++) {
      const tag = wxr.tags[i];
      progress?.('tags', i + 1, wxr.tags.length, tag.slug);
      if (dryRun) continue;
      if (createdKeys.has(`tags:${tag.slug}`)) { result.tags.created++; continue; }
      try {
        const res = await client.createTag({
          name: tag.name,
          slug: tag.slug,
          description: tag.description,
        });
        tagIdMap.set(tag.slug, res.id);
        result.tags.created++;
        logEntry(logPath, { type: 'created', stage: 'tags', slug: tag.slug, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.tags.failed++;
        logEntry(logPath, { type: 'failed', stage: 'tags', slug: tag.slug, error: String(err) });
      }
    }
  }

  // --- 3. Custom terms ---
  if (shouldRun('terms')) {
    const sorted = topoSortByParent(wxr.terms);
    result.terms.total = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      const term = sorted[i];
      progress?.('terms', i + 1, sorted.length, term.slug);
      if (dryRun) continue;
      if (createdKeys.has(`terms:${term.slug}`)) { result.terms.created++; continue; }
      try {
        const parentKey = term.parent ? `${term.taxonomy}:${term.parent}` : undefined;
        const parentWpId = parentKey ? termIdMap.get(parentKey) : undefined;
        const res = await client.createTerm(term.taxonomy, {
          name: term.name,
          slug: term.slug,
          description: term.description,
          parent: parentWpId,
        });
        termIdMap.set(`${term.taxonomy}:${term.slug}`, res.id);
        result.terms.created++;
        logEntry(logPath, { type: 'created', stage: 'terms', slug: term.slug, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.terms.failed++;
        logEntry(logPath, { type: 'failed', stage: 'terms', slug: term.slug, error: String(err) });
      }
    }
  }

  // --- 4. Media ---
  if (shouldRun('media')) {
    result.media.total = mediaItems.length;
    for (let i = 0; i < mediaItems.length; i++) {
      const media = mediaItems[i];
      progress?.('media', i + 1, mediaItems.length, media.slug);
      if (dryRun) continue;
      if (createdKeys.has(`media:${media.id}`)) { result.media.created++; continue; }

      const resolved = await resolveMediaFile(media, mediaDir);
      if (!resolved) {
        // No local file and download from source URL failed
        result.media.failed++;
        logEntry(logPath, { type: 'failed', stage: 'media', id: media.id, error: 'File not found locally' });
        continue;
      }

      try {
        let uploadFilename: string;
        try {
          uploadFilename = deriveFilenameFromUrl(new URL(media.url));
        } catch {
          uploadFilename = media.slug || 'file';
        }
        // Ensure the filename has an extension WordPress can recognize.
        // Files from CDNs (e.g. GoDaddy's /getty/<numeric-id>) may lack one.
        if (!extname(uploadFilename)) {
          const ext = resolved.contentType
            ? extensionFromContentType(resolved.contentType)
            : '';
          if (ext) {
            uploadFilename = `${uploadFilename}${ext}`;
          } else {
            uploadFilename = `${uploadFilename}.jpg`;
          }
        }
        const res = await client.createMedia(resolved.buffer, uploadFilename, {
          altText: media.altText,
          caption: media.caption,
          title: media.title,
        });
        mediaIdMap.set(media.id, res.id);
        mediaUrlMap.set(media.url, res.url);
        result.media.created++;
        logEntry(logPath, { type: 'created', stage: 'media', id: media.id, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.media.failed++;
        logEntry(logPath, { type: 'failed', stage: 'media', id: media.id, error: String(err) });
      }
    }
  }

  /** Replace all old media URLs with new WP URLs in content. */
  function rewriteMediaUrls(content: string): string {
    let result = content;
    for (const [oldUrl, newUrl] of mediaUrlMap) {
      result = result.replaceAll(oldUrl, newUrl);
    }
    return result;
  }

  // --- Author mapping ---
  const authorIdMap = new Map<string, number>();
  if (opts.importAuthors && wxr.authors.length > 0 && !dryRun) {
    progress?.('authors', 0, wxr.authors.length, 'Creating authors...');
    for (let i = 0; i < wxr.authors.length; i++) {
      const author = wxr.authors[i];
      progress?.('authors', i + 1, wxr.authors.length, author.login);
      if (createdKeys.has(`authors:${author.login}`)) continue;
      try {
        const res = await client.createUser({
          username: author.login,
          email: author.email || undefined,
          name: author.displayName || author.login,
        });
        authorIdMap.set(author.login, res.id);
        logEntry(logPath, { type: 'created', stage: 'authors', slug: author.login, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch {
        // Author creation may fail (e.g. user already exists) — try to find existing
        try {
          const users = await client.listUsers();
          const existing = users.find((u) => u.slug === author.login);
          if (existing) {
            authorIdMap.set(author.login, existing.id);
          }
        } catch {
          // Can't list users — skip author mapping for this author
        }
      }
    }
  }

  // --- 5. Pages ---
  if (shouldRun('pages')) {
    const sorted = topoSortById(pageItems);
    result.pages.total = sorted.length;
    for (let i = 0; i < sorted.length; i++) {
      const page = sorted[i];
      progress?.('pages', i + 1, sorted.length, page.slug);
      if (dryRun) continue;
      if (createdKeys.has(`pages:${page.slug}`)) { result.pages.created++; continue; }
      try {
        const parentWpId = page.parent ? pageIdMap.get(page.parent) : undefined;
        const content = rewriteMediaUrls(page.content);
        const pageAuthorId =
          (opts.importAuthors && page.author ? authorIdMap.get(page.author) : undefined)
          ?? defaultAuthorId;
        const res = await client.createPage({
          title: page.title,
          slug: page.slug,
          content,
          excerpt: page.excerpt || undefined,
          date: page.date || undefined,
          parent: parentWpId,
          menuOrder: page.menuOrder || undefined,
          author: pageAuthorId,
          status: 'draft',
        });
        pageIdMap.set(page.id, res.id);
        result.pages.created++;
        if (res.url) {
          result.redirectMap.push({ from: `/${page.slug}`, to: res.url });
        }
        logEntry(logPath, { type: 'created', stage: 'pages', slug: page.slug, wxrId: page.id, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.pages.failed++;
        logEntry(logPath, { type: 'failed', stage: 'pages', slug: page.slug, error: String(err) });
      }
    }
  }

  // --- 6. Posts ---
  if (shouldRun('posts')) {
    result.posts.total = postItems.length;
    for (let i = 0; i < postItems.length; i++) {
      const post = postItems[i];
      progress?.('posts', i + 1, postItems.length, post.slug);
      if (dryRun) continue;
      if (createdKeys.has(`posts:${post.slug}`)) { result.posts.created++; continue; }
      try {
        const content = rewriteMediaUrls(post.content);
        const categoryIds = post.categories
          .map((slug) => categoryIdMap.get(slug))
          .filter((id): id is number => id !== undefined);
        const tagIds = post.tags
          .map((slug) => tagIdMap.get(slug))
          .filter((id): id is number => id !== undefined);
        const featuredMedia = post.featuredMediaId
          ? mediaIdMap.get(post.featuredMediaId)
          : undefined;

        const authorWpId =
          (opts.importAuthors && post.author ? authorIdMap.get(post.author) : undefined)
          ?? defaultAuthorId;

        const res = await client.createPost({
          title: post.title,
          slug: post.slug,
          content,
          excerpt: post.excerpt || undefined,
          date: post.date || undefined,
          categories: categoryIds.length ? categoryIds : undefined,
          tags: tagIds.length ? tagIds : undefined,
          featuredMedia,
          author: authorWpId,
          status: 'draft',
        });
        postIdMap.set(post.id, res.id);
        result.posts.created++;
        if (res.url) {
          result.redirectMap.push({ from: `/${post.slug}`, to: res.url });
        }
        logEntry(logPath, { type: 'created', stage: 'posts', slug: post.slug, wxrId: post.id, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.posts.failed++;
        logEntry(logPath, { type: 'failed', stage: 'posts', slug: post.slug, error: String(err) });
      }
    }
  }

  // --- 7. Comments ---
  if (shouldRun('comments')) {
    result.comments.total = wxr.comments.length;
    for (let i = 0; i < wxr.comments.length; i++) {
      const comment = wxr.comments[i];
      progress?.('comments', i + 1, wxr.comments.length, `comment-${comment.id}`);
      if (dryRun) continue;
      if (createdKeys.has(`comments:${comment.id}`)) { result.comments.created++; continue; }

      // Map the WXR postId to a WP post/page ID
      const wpPostId = postIdMap.get(comment.postId) ?? pageIdMap.get(comment.postId);
      if (!wpPostId) {
        result.comments.failed++;
        logEntry(logPath, { type: 'failed', stage: 'comments', id: comment.id, error: 'Parent post/page not found' });
        continue;
      }

      try {
        const res = await client.createComment(wpPostId, {
          author: comment.author,
          content: comment.content,
          date: comment.date,
          status: comment.approved === '1' ? 'approved' : 'hold',
        });
        result.comments.created++;
        logEntry(logPath, { type: 'created', stage: 'comments', id: comment.id, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.comments.failed++;
        logEntry(logPath, { type: 'failed', stage: 'comments', id: comment.id, error: String(err) });
      }
    }
  }

  // --- 8. Nav menus ---
  if (shouldRun('menus')) {
    // Collect unique menu slugs from menu items
    const menuSlugs = [...new Set(menuItems.map((mi) => mi.menuSlug).filter(Boolean))];
    const menuItemsBySlug = new Map<string, MenuItem[]>();
    for (const mi of menuItems) {
      if (!mi.menuSlug) continue;
      if (!menuItemsBySlug.has(mi.menuSlug)) menuItemsBySlug.set(mi.menuSlug, []);
      menuItemsBySlug.get(mi.menuSlug)!.push(mi);
    }

    // Create menu containers
    result.menus.total = menuSlugs.length + menuItems.length;
    for (const slug of menuSlugs) {
      if (dryRun) continue;
      if (createdKeys.has(`menus:${slug}`)) { result.menus.created++; continue; }
      try {
        const res = await client.createMenu({ name: slug, slug });
        menuIdMap.set(slug, res.id);
        result.menus.created++;
        logEntry(logPath, { type: 'created', stage: 'menus', slug, wpId: res.id });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      } catch (err) {
        result.menus.failed++;
        logEntry(logPath, { type: 'failed', stage: 'menus', slug, error: String(err) });
      }
    }

    // Create menu items in topological order within each menu
    const menuItemIdMap = new Map<number, number>();
    for (const [slug, items] of menuItemsBySlug) {
      const wpMenuId = menuIdMap.get(slug);
      if (!wpMenuId) continue;

      const sorted = topoSortById(items);
      for (let i = 0; i < sorted.length; i++) {
        const mi = sorted[i];
        progress?.('menus', i + 1, sorted.length, mi.slug);
        if (dryRun) continue;
        if (createdKeys.has(`menu-items:${mi.slug}`)) { result.menus.created++; continue; }
        try {
          const parentWpId = mi.parent ? menuItemIdMap.get(mi.parent) : undefined;
          const res = await client.createMenuItem({
            title: mi.title,
            url: mi.url,
            menuId: wpMenuId,
            parent: parentWpId,
            menuOrder: mi.menuOrder || undefined,
          });
          menuItemIdMap.set(mi.id, res.id);
          result.menus.created++;
          logEntry(logPath, { type: 'created', stage: 'menu-items', slug: mi.slug, wpId: res.id });
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
        } catch (err) {
          result.menus.failed++;
          logEntry(logPath, { type: 'failed', stage: 'menu-items', slug: mi.slug, error: String(err) });
        }
      }
    }
  }

  // --- 9. WooCommerce products ---
  const hasWcAuth = (opts.woocommerceKey && opts.woocommerceSecret) || (opts.username && opts.token);
  if (shouldRun('products') && hasWcAuth) {
    const wcClient = new WooCommerceClient({
      site: opts.site,
      consumerKey: opts.woocommerceKey,
      consumerSecret: opts.woocommerceSecret,
      wpUsername: opts.username,
      wpToken: opts.token,
    });

    const csvPath = join(dirname(opts.wxrFile), 'products.csv');
    const csvProducts = readProductsCsv(csvPath);

    result.products.total = csvProducts.length;
    const productSkuToId = new Map<string, number>();
    // Track the last created variable product so variations without parentSku
    // can be matched to their parent by CSV ordering
    let lastVariableProductId: number | undefined;

    for (let i = 0; i < csvProducts.length; i++) {
      const p = csvProducts[i];

      if (p.type === 'variation') {
        // --- Variation ---
        progress?.('variations', i + 1, csvProducts.length, p.sku || p.name);
        if (dryRun) continue;
        if (createdKeys.has(`variations:${p.sku}`)) { result.products.created++; continue; }

        const parentWcId = p.parentSku
          ? productSkuToId.get(p.parentSku)
          : lastVariableProductId;
        if (!parentWcId) {
          result.products.failed++;
          logEntry(logPath, { type: 'failed', stage: 'variations', sku: p.sku, error: 'Parent not found' });
          continue;
        }

        try {
          const variationData: Record<string, unknown> = {
            regular_price: p.regularPrice || '',
            sale_price: p.salePrice || '',
            sku: p.sku || '',
            manage_stock: p.stock != null,
            stock_quantity: p.stock,
            attributes: (p.attributes || []).map((a) => ({
              id: 0,
              name: a.name,
              option: a.values[0] || '',
            })),
          };
          if (p.images?.length) {
            variationData.image = { src: p.images[0] };
          }
          await wcClient.createVariation(parentWcId, variationData);
          result.products.created++;
          logEntry(logPath, { type: 'created', stage: 'variations', sku: p.sku, parentWcId });
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        } catch (err) {
          result.products.failed++;
          logEntry(logPath, { type: 'failed', stage: 'variations', sku: p.sku, error: String(err) });
        }
      } else {
        // --- Parent product (simple, variable, grouped, external) ---
        progress?.('products', i + 1, csvProducts.length, p.name);
        if (dryRun) continue;
        if (createdKeys.has(`products:${p.name}`)) {
          result.products.created++;
          // Restore ID for subsequent variations
          const existingId = productNameToId.get(p.name);
          if (p.sku && existingId) productSkuToId.set(p.sku, existingId);
          if (p.type === 'variable' && existingId) lastVariableProductId = existingId;
          continue;
        }

        try {
          const categoryIds: number[] = [];
          for (const catName of p.categories || []) {
            try {
              categoryIds.push(await wcClient.ensureCategory(catName));
            } catch { /* skip */ }
          }

          const wcProduct: Record<string, unknown> = {
            name: p.name,
            type: p.type || 'simple',
            sku: p.sku || '',
            description: p.description || '',
            short_description: p.shortDescription || '',
            regular_price: p.type === 'variable' ? '' : (p.regularPrice || ''),
            sale_price: p.salePrice || '',
            categories: categoryIds.map((id) => ({ id })),
            tags: (p.tags || []).map((t) => ({ name: t })),
            images: (p.images || []).map((src) => ({ src })),
            manage_stock: p.stock != null,
            stock_quantity: p.stock,
            status: p.published === false ? 'draft' : 'publish',
          };

          if (p.attributes) {
            wcProduct.attributes = p.attributes.map((a, idx) => ({
              id: 0,
              name: a.name,
              position: idx,
              visible: a.visible !== false,
              variation: p.type === 'variable',
              options: a.values,
            }));
          }

          const res = await wcClient.createProduct(wcProduct);
          if (p.sku) productSkuToId.set(p.sku, res.id);
          if (p.type === 'variable') lastVariableProductId = res.id;
          result.products.created++;
          logEntry(logPath, { type: 'created', stage: 'products', name: p.name, wcId: res.id });
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        } catch (err) {
          result.products.failed++;
          if (p.type === 'variable') lastVariableProductId = undefined;
          logEntry(logPath, { type: 'failed', stage: 'products', name: p.name, error: String(err) });
        }
      }
    }
  }

  // Include redirects from the WXR data
  for (const redirect of wxr.redirects) {
    result.redirectMap.push({ from: redirect.from, to: redirect.to });
  }

  // --- 10. Set static front page if a homepage was imported ---
  if (!dryRun) {
    const homepagePage = pageItems.find((p) => p.slug === 'homepage');
    const homepageWpId = homepagePage ? pageIdMap.get(homepagePage.id) : undefined;
    if (homepageWpId) {
      try {
        await client.updateSettings({
          show_on_front: 'page',
          page_on_front: homepageWpId,
        });
      } catch {
        // Setting front page failed — non-fatal
      }
    }
  }

  return result;
}
