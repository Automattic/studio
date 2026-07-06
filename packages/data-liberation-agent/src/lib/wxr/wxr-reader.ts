import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import type {
  SiteMeta,
  Author,
  Category,
  Tag,
  Term,
  MediaItem,
  PageItem,
  PostItem,
  MenuItem,
  Comment,
  Redirect,
  WxrItem,
} from './wxr-builder.js';

export interface WxrData {
  site: SiteMeta;
  authors: Author[];
  categories: Category[];
  tags: Tag[];
  terms: Term[];
  items: WxrItem[];
  comments: Comment[];
  redirects: Redirect[];
}

/**
 * Convert WP date format (YYYY-MM-DD HH:MM:SS) to ISO 8601.
 * Returns empty string for zero dates.
 */
function wpDateToIso(wpDate: string): string {
  if (!wpDate || wpDate === '0000-00-00 00:00:00') return '';
  // wpDate is "YYYY-MM-DD HH:MM:SS" in UTC
  const date = new Date(wpDate.replace(' ', 'T') + 'Z');
  if (isNaN(date.getTime())) return '';
  return date.toISOString();
}

/** Elements that should always be parsed as arrays even when only one is present. */
const arrayElements = new Set([
  'item',
  'wp:author',
  'wp:category',
  'wp:tag',
  'wp:term',
  'wp:comment',
  'wp:postmeta',
  'category',
]);

function ensureArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Extract a string from a parsed XML node.
 * Handles plain strings, numbers, and objects with __cdata or #text properties.
 */
function str(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>;
    if ('__cdata' in obj) return String(obj['__cdata'] ?? '');
    if ('#text' in obj) return String(obj['#text']);
  }
  return String(node);
}

function numOf(node: unknown): number {
  const t = str(node);
  const n = parseInt(t, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Read a WXR file and parse it into structured typed objects.
 */
export function readWxr(wxrPath: string): WxrData {
  const xml = readFileSync(wxrPath, 'utf8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '__cdata',
    processEntities: true,
    trimValues: true,
    isArray: (name) => arrayElements.has(name),
  });

  const doc = parser.parse(xml);
  const channel = doc.rss?.channel;
  if (!channel) {
    throw new Error('Invalid WXR: missing rss > channel');
  }

  const site = parseSiteMeta(channel);
  const authors = parseAuthors(channel);
  const categories = parseCategories(channel);
  const tags = parseTags(channel);
  const terms = parseTerms(channel);

  const items: WxrItem[] = [];
  const comments: Comment[] = [];

  for (const rawItem of ensureArray(channel.item) as Record<string, unknown>[]) {
    const postType = str(rawItem['wp:post_type']);

    switch (postType) {
      case 'attachment':
        items.push(parseMediaItem(rawItem));
        break;
      case 'page':
        items.push(parsePageItem(rawItem));
        break;
      case 'post':
        items.push(parsePostItem(rawItem));
        break;
      case 'nav_menu_item':
        items.push(parseMenuItem(rawItem));
        break;
    }

    // Parse comments within this item
    for (const rawComment of ensureArray(rawItem['wp:comment']) as Record<string, unknown>[]) {
      comments.push(parseComment(rawComment, numOf(rawItem['wp:post_id'])));
    }
  }

  // Load redirects from sibling file
  const redirects = loadRedirects(wxrPath);

  return { site, authors, categories, tags, terms, items, comments, redirects };
}

function parseSiteMeta(channel: Record<string, unknown>): SiteMeta {
  return {
    title: str(channel.title),
    url: str(channel['wp:base_blog_url']) || str(channel.link),
    description: str(channel.description),
    language: str(channel.language),
  };
}

function parseAuthors(channel: Record<string, unknown>): Author[] {
  return (ensureArray(channel['wp:author']) as Record<string, unknown>[]).map((a) => ({
    id: numOf(a['wp:author_id']),
    login: str(a['wp:author_login']),
    email: str(a['wp:author_email']),
    displayName: str(a['wp:author_display_name']),
    firstName: str(a['wp:author_first_name']),
    lastName: str(a['wp:author_last_name']),
  }));
}

function parseCategories(channel: Record<string, unknown>): Category[] {
  return (ensureArray(channel['wp:category']) as Record<string, unknown>[]).map((c) => ({
    id: numOf(c['wp:term_id']),
    slug: str(c['wp:category_nicename']),
    name: str(c['wp:cat_name']),
    parent: str(c['wp:category_parent']),
    description: str(c['wp:category_description']),
  }));
}

function parseTags(channel: Record<string, unknown>): Tag[] {
  return (ensureArray(channel['wp:tag']) as Record<string, unknown>[]).map((t) => ({
    id: numOf(t['wp:term_id']),
    slug: str(t['wp:tag_slug']),
    name: str(t['wp:tag_name']),
    description: str(t['wp:tag_description']),
  }));
}

function parseTerms(channel: Record<string, unknown>): Term[] {
  return (ensureArray(channel['wp:term']) as Record<string, unknown>[]).map((t) => ({
    id: numOf(t['wp:term_id']),
    taxonomy: str(t['wp:term_taxonomy']),
    slug: str(t['wp:term_slug']),
    name: str(t['wp:term_name']),
    parent: str(t['wp:term_parent']),
    description: str(t['wp:term_description']),
  }));
}

function getPostmeta(item: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  for (const meta of ensureArray(item['wp:postmeta']) as Record<string, unknown>[]) {
    const key = str(meta['wp:meta_key']);
    const value = str(meta['wp:meta_value']);
    if (key) map.set(key, value);
  }
  return map;
}

function getItemCategories(item: Record<string, unknown>): {
  categories: string[];
  tags: string[];
  customTerms: Array<{ taxonomy: string; slug: string }>;
} {
  const categories: string[] = [];
  const tags: string[] = [];
  const customTerms: Array<{ taxonomy: string; slug: string }> = [];

  for (const cat of ensureArray(item.category) as Record<string, unknown>[]) {
    const domain = String(cat['@_domain'] || '');
    const nicename = String(cat['@_nicename'] || '');

    if (domain === 'category') {
      categories.push(nicename);
    } else if (domain === 'post_tag') {
      tags.push(nicename);
    } else if (domain && nicename) {
      customTerms.push({ taxonomy: domain, slug: nicename });
    }
  }

  return { categories, tags, customTerms };
}

function parseMediaItem(item: Record<string, unknown>): MediaItem {
  const meta = getPostmeta(item);
  return {
    id: numOf(item['wp:post_id']),
    type: 'attachment',
    title: str(item.title),
    slug: str(item['wp:post_name']),
    url: str(item['wp:attachment_url']),
    altText: meta.get('_wp_attachment_image_alt') || '',
    // Caption is read here but doesn't round-trip: WxrBuilder doesn't
    // serialize caption for attachment items.
    caption: str(item['excerpt:encoded']),
  };
}

function parsePageItem(item: Record<string, unknown>): PageItem {
  const meta = getPostmeta(item);
  const wpDate = str(item['wp:post_date']);
  return {
    id: numOf(item['wp:post_id']),
    type: 'page',
    title: str(item.title),
    slug: str(item['wp:post_name']),
    content: str(item['content:encoded']),
    excerpt: str(item['excerpt:encoded']),
    date: wpDateToIso(wpDate),
    parent: numOf(item['wp:post_parent']),
    menuOrder: numOf(item['wp:menu_order']),
    author: str(item['dc:creator']),
    seoTitle: meta.get('_seo_title') || '',
    seoDescription: meta.get('_seo_description') || '',
    sourceUrl: meta.get('_source_url') || '',
  };
}

function parsePostItem(item: Record<string, unknown>): PostItem {
  const meta = getPostmeta(item);
  const wpDate = str(item['wp:post_date']);
  const { categories, tags, customTerms } = getItemCategories(item);

  return {
    id: numOf(item['wp:post_id']),
    type: 'post',
    title: str(item.title),
    slug: str(item['wp:post_name']),
    content: str(item['content:encoded']),
    excerpt: str(item['excerpt:encoded']),
    date: wpDateToIso(wpDate),
    categories,
    tags,
    featuredMediaId: parseInt(meta.get('_thumbnail_id') || '0', 10) || 0,
    author: str(item['dc:creator']),
    seoTitle: meta.get('_seo_title') || '',
    seoDescription: meta.get('_seo_description') || '',
    sourceUrl: meta.get('_source_url') || '',
    customTerms,
  };
}

function parseMenuItem(item: Record<string, unknown>): MenuItem {
  const meta = getPostmeta(item);
  return {
    id: numOf(item['wp:post_id']),
    type: 'nav_menu_item',
    title: str(item.title),
    slug: str(item['wp:post_name']),
    url: meta.get('_menu_item_url') || '',
    menuSlug: meta.get('_menu_slug') || '',
    parent: numOf(item['wp:post_parent']),
    menuOrder: numOf(item['wp:menu_order']),
  };
}

function parseComment(raw: Record<string, unknown>, postId: number): Comment {
  const wpDate = str(raw['wp:comment_date']);
  return {
    id: numOf(raw['wp:comment_id']),
    postId,
    author: str(raw['wp:comment_author']),
    authorEmail: str(raw['wp:comment_author_email']),
    authorUrl: str(raw['wp:comment_author_url']),
    authorIp: str(raw['wp:comment_author_IP']),
    date: wpDateToIso(wpDate),
    content: str(raw['wp:comment_content']),
    approved: str(raw['wp:comment_approved']),
    type: str(raw['wp:comment_type']),
    parent: numOf(raw['wp:comment_parent']),
    userId: numOf(raw['wp:comment_user_id']),
  };
}

function loadRedirects(wxrPath: string): Redirect[] {
  const redirectPath = join(dirname(wxrPath), 'redirect-map.json');
  if (!existsSync(redirectPath)) return [];
  try {
    return JSON.parse(readFileSync(redirectPath, 'utf8'));
  } catch {
    return [];
  }
}
