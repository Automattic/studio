import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { XMLBuilder } from 'fast-xml-parser';

export interface SiteMetaInput {
  title?: string;
  url?: string;
  description?: string;
  language?: string;
}

export interface SiteMeta {
  title: string;
  url: string;
  description: string;
  language: string;
}

export interface AuthorInput {
  login: string;
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface Author {
  id: number;
  login: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
}

export interface CategoryInput {
  slug: string;
  name: string;
  parent?: string;
  description?: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  parent: string;
  description: string;
}

export interface TagInput {
  slug: string;
  name: string;
  description?: string;
}

export interface Tag {
  id: number;
  slug: string;
  name: string;
  description: string;
}

export interface MediaInput {
  url: string;
  localPath?: string;
  title?: string;
  slug?: string;
  altText?: string;
  caption?: string;
}

export interface MediaItem {
  id: number;
  type: 'attachment';
  title: string;
  slug: string;
  url: string;
  localPath?: string;
  altText: string;
  caption: string;
}

export interface PageInput {
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  date?: string;
  parent?: number;
  menuOrder?: number;
  author?: string;
  seoTitle?: string;
  seoDescription?: string;
  sourceUrl?: string;
}

export interface PageItem {
  id: number;
  type: 'page';
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  date: string;
  parent: number;
  menuOrder: number;
  author: string;
  seoTitle: string;
  seoDescription: string;
  sourceUrl: string;
}

export interface PostInput {
  title: string;
  slug: string;
  content?: string;
  excerpt?: string;
  date?: string;
  categories?: string[];
  tags?: string[];
  featuredMediaId?: number;
  author?: string;
  seoTitle?: string;
  seoDescription?: string;
  sourceUrl?: string;
  customTerms?: Array<{ taxonomy: string; slug: string }>;
}

export interface PostItem {
  id: number;
  type: 'post';
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  date: string;
  categories: string[];
  tags: string[];
  featuredMediaId: number;
  author: string;
  seoTitle: string;
  seoDescription: string;
  sourceUrl: string;
  customTerms: Array<{ taxonomy: string; slug: string }>;
}

export interface MenuItemInput {
  title: string;
  url: string;
  menuSlug: string;
  parent?: number;
  order?: number;
}

export interface MenuItem {
  id: number;
  type: 'nav_menu_item';
  title: string;
  slug: string;
  url: string;
  menuSlug: string;
  parent: number;
  menuOrder: number;
}

export interface RedirectInput {
  from: string;
  to: string;
}

export interface Redirect {
  from: string;
  to: string;
}

export interface CommentInput {
  postId: number;
  author?: string;
  authorEmail?: string;
  authorUrl?: string;
  authorIp?: string;
  date?: string;
  content: string;
  approved?: boolean;
  type?: string;
  parent?: number;
  userId?: number;
}

export interface Comment {
  id: number;
  postId: number;
  author: string;
  authorEmail: string;
  authorUrl: string;
  authorIp: string;
  date: string;
  content: string;
  approved: string;
  type: string;
  parent: number;
  userId: number;
}

export interface TermInput {
  taxonomy: string;
  slug: string;
  name: string;
  parent?: string;
  description?: string;
}

export interface Term {
  id: number;
  taxonomy: string;
  slug: string;
  name: string;
  parent: string;
  description: string;
}

export type WxrItem = MediaItem | PageItem | PostItem | MenuItem;

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
  processEntities: true,
});

/** Escape ]]> inside CDATA content (fast-xml-parser doesn't handle this). */
function safeCdata(str: string): string {
  if (!str) return str;
  return str.replace(/]]>/g, ']]]]><![CDATA[>');
}

/**
 * Collapse whitespace that fast-xml-parser inserts around CDATA sections.
 *
 * fast-xml-parser with format:true produces:
 *   <tag>\n    <![CDATA[value]]>\n  </tag>
 *
 * WordPress's importer reads the text content including that whitespace,
 * which corrupts values. This collapses it to:
 *   <tag><![CDATA[value]]></tag>
 */
function collapseCdataWhitespace(xml: string): string {
  return xml.replace(/>\s*(<!\[CDATA\[[\s\S]*?\]\]>)\s*</g, '>$1<');
}

/** Wrap a value for XMLBuilder CDATA output with ]]> escaping. */
function cd(value: string): { __cdata: string } {
  return { __cdata: safeCdata(value) };
}

function formatWpDate(isoDate: string): string {
  if (!isoDate) return '0000-00-00 00:00:00';
  const d = new Date(isoDate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function toRFC822(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

/** Optional WxrBuilder configuration. */
export interface WxrBuilderOpts {
  /**
   * Status for extracted pages/posts. Default `'draft'` — honors the documented
   * "all content imported as drafts; the user reviews and publishes manually"
   * convention for the WXR a user imports into their production WordPress. The
   * replica/preview flow passes `'publish'` so its nav targets resolve.
   * Attachments always use WP's `'inherit'` convention regardless.
   */
  contentStatus?: 'draft' | 'publish';
}

export class WxrBuilder {
  siteMeta: SiteMeta;
  contentStatus: 'draft' | 'publish';
  _nextId: number;
  authors: Author[];
  categories: Category[];
  tags: Tag[];
  items: WxrItem[];
  redirects: Redirect[];
  comments: Comment[];
  terms: Term[];
  private _streamPath: string | null = null;
  private _streaming = false;
  /**
   * Fallback ISO date used for any item (attachments, nav menu items, or
   * pages/posts whose adapter didn't populate a date) that would otherwise
   * serialize as `0000-00-00 00:00:00`. A zero date causes WordPress's WXR
   * importer to route attachment uploads into `wp-content/uploads/0000/00/`,
   * which breaks Studio blueprint application.
   */
  private readonly _fallbackDate: string = new Date().toISOString();

  get isStreaming(): boolean {
    return this._streaming;
  }

  constructor(siteMeta: SiteMetaInput, opts: WxrBuilderOpts = {}) {
    this.contentStatus = opts.contentStatus ?? 'draft';
    this.siteMeta = {
      title: siteMeta.title || 'Untitled',
      url: (siteMeta.url || '').replace(/\/+$/, ''),
      description: siteMeta.description || '',
      language: siteMeta.language || 'en-US',
    };
    this._nextId = 1;
    this.authors = [];
    this.categories = [];
    this.tags = [];
    this.items = [];
    this.redirects = [];
    this.comments = [];
    this.terms = [];
    this._streamPath = null;
    this._streaming = false;
  }

  _id(): number {
    return this._nextId++;
  }

  addAuthor(author: AuthorInput): number {
    const id = this._id();
    this.authors.push({
      id,
      login: author.login,
      email: author.email || '',
      displayName: author.displayName || author.login,
      firstName: author.firstName || '',
      lastName: author.lastName || '',
    });
    return id;
  }

  addCategory(cat: CategoryInput): number {
    const id = this._id();
    this.categories.push({
      id,
      slug: cat.slug,
      name: cat.name,
      parent: cat.parent || '',
      description: cat.description || '',
    });
    return id;
  }

  addTag(tag: TagInput): number {
    const id = this._id();
    this.tags.push({
      id,
      slug: tag.slug,
      name: tag.name,
      description: tag.description || '',
    });
    return id;
  }

  addMedia(media: MediaInput): number {
    const id = this._id();
    this.items.push({
      id,
      type: 'attachment',
      title: media.title || '',
      slug: media.slug || '',
      url: media.url,
      localPath: media.localPath,
      altText: media.altText || '',
      caption: media.caption || '',
    });
    return id;
  }

  addPage(page: PageInput): number {
    const id = this._id();
    this.items.push({
      id,
      type: 'page',
      title: page.title,
      slug: page.slug,
      content: page.content || '',
      excerpt: page.excerpt || '',
      date: page.date || '',
      parent: page.parent || 0,
      menuOrder: page.menuOrder || 0,
      author: page.author || '',
      seoTitle: page.seoTitle || '',
      seoDescription: page.seoDescription || '',
      sourceUrl: page.sourceUrl || '',
    });
    return id;
  }

  addPost(post: PostInput): number {
    const id = this._id();
    this.items.push({
      id,
      type: 'post',
      title: post.title,
      slug: post.slug,
      content: post.content || '',
      excerpt: post.excerpt || '',
      date: post.date || '',
      categories: post.categories || [],
      tags: post.tags || [],
      featuredMediaId: post.featuredMediaId || 0,
      author: post.author || '',
      seoTitle: post.seoTitle || '',
      seoDescription: post.seoDescription || '',
      sourceUrl: post.sourceUrl || '',
      customTerms: post.customTerms || [],
    });
    return id;
  }

  addMenuItem(item: MenuItemInput): void {
    this.items.push({
      id: this._id(),
      type: 'nav_menu_item',
      title: item.title,
      slug: '',
      url: item.url,
      menuSlug: item.menuSlug,
      parent: item.parent || 0,
      menuOrder: item.order || 0,
    });
  }

  addRedirect(redirect: RedirectInput): void {
    this.redirects.push({ from: redirect.from, to: redirect.to });
  }

  addComment(comment: CommentInput): number {
    const id = this._id();
    this.comments.push({
      id,
      postId: comment.postId,
      author: comment.author || '',
      authorEmail: comment.authorEmail || '',
      authorUrl: comment.authorUrl || '',
      authorIp: comment.authorIp || '',
      date: comment.date || '',
      content: comment.content,
      approved: comment.approved === false ? '0' : '1',
      type: comment.type || 'comment',
      parent: comment.parent || 0,
      userId: comment.userId || 0,
    });
    return id;
  }

  addTerm(term: TermInput): number {
    const id = this._id();
    this.terms.push({
      id,
      taxonomy: term.taxonomy,
      slug: term.slug,
      name: term.name,
      parent: term.parent || '',
      description: term.description || '',
    });
    return id;
  }

  /**
   * Backfill channel-header term declarations for any category/tag referenced
   * inline on a post but never explicitly registered via {@link addCategory} /
   * {@link addTag}.
   *
   * Some adapters (e.g. Squarespace) attach terms directly to posts as inline
   * `<category domain="category|post_tag" nicename="…">` refs without declaring
   * them in the channel header. A spec-compliant WXR 1.2 also declares each term
   * once in the header; absent declarations trip validators ("references unknown
   * category/tag slug …") even though WordPress can still create the terms from
   * the inline refs.
   *
   * The inline `nicename` emitted by {@link _serializeItem} is the raw slug
   * string from `post.categories` / `post.tags`, so the backfilled declaration's
   * resolvable key (`wp:category_nicename` / `wp:tag_slug`) MUST equal that raw
   * string verbatim for references to resolve. We therefore use the inline value
   * as both the declared slug and the human-readable name (Squarespace term refs
   * already carry display-shaped values like "The New York Times").
   *
   * Idempotent and order-independent: only terms missing from `this.categories`
   * / `this.tags` are appended, so it is safe to call from both `serialize()`
   * and `openStream()` and safe to call more than once.
   */
  private _backfillInlineTerms(): void {
    const knownCategorySlugs = new Set(this.categories.map((c) => c.slug));
    const knownTagSlugs = new Set(this.tags.map((t) => t.slug));
    const seenCategorySlugs = new Set<string>();
    const seenTagSlugs = new Set<string>();

    for (const item of this.items) {
      if (item.type !== 'post') continue;
      for (const slug of item.categories) {
        if (!slug || knownCategorySlugs.has(slug) || seenCategorySlugs.has(slug)) continue;
        seenCategorySlugs.add(slug);
        this.addCategory({ slug, name: slug });
      }
      for (const slug of item.tags) {
        if (!slug || knownTagSlugs.has(slug) || seenTagSlugs.has(slug)) continue;
        seenTagSlugs.add(slug);
        this.addTag({ slug, name: slug });
      }
    }
  }

  validate(): ValidationResult {
    const warnings: string[] = [];
    const attachmentIds = new Set(
      this.items.filter((i): i is MediaItem => i.type === 'attachment').map((i) => i.id)
    );
    const categorySlugs = new Set(this.categories.map((c) => c.slug));
    const tagSlugs = new Set(this.tags.map((t) => t.slug));

    const termKeys = new Set(this.terms.map((t) => `${t.taxonomy}:${t.slug}`));
    const itemIds = new Set(this.items.map((i) => i.id));

    for (const item of this.items) {
      if (item.type === 'post' || item.type === 'page') {
        if (!item.content || item.content.trim() === '') {
          warnings.push(`"${item.title}" (${item.type}) has empty content`);
        }
      }
      if (item.type === 'post') {
        if (item.featuredMediaId && !attachmentIds.has(item.featuredMediaId)) {
          warnings.push(
            `Post "${item.title}" references featuredMediaId ${item.featuredMediaId} which does not exist`
          );
        }
        for (const slug of item.categories) {
          if (!categorySlugs.has(slug)) {
            warnings.push(`Post "${item.title}" references unknown category slug "${slug}"`);
          }
        }
        for (const slug of item.tags) {
          if (!tagSlugs.has(slug)) {
            warnings.push(`Post "${item.title}" references unknown tag slug "${slug}"`);
          }
        }
        for (const ct of item.customTerms) {
          if (!termKeys.has(`${ct.taxonomy}:${ct.slug}`)) {
            warnings.push(
              `Post "${item.title}" references unregistered custom term "${ct.taxonomy}:${ct.slug}"`
            );
          }
        }
      }
    }

    for (const comment of this.comments) {
      if (!itemIds.has(comment.postId)) {
        warnings.push(`Comment ${comment.id} references non-existent postId ${comment.postId}`);
      }
    }

    return { valid: true, warnings };
  }

  private _serializeHeader(): string {
    const now = new Date();
    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      rss: {
        '@_version': '2.0',
        '@_xmlns:excerpt': 'http://wordpress.org/export/1.2/excerpt/',
        '@_xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
        '@_xmlns:wfw': 'http://wellformedweb.org/CommentAPI/',
        '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        '@_xmlns:wp': 'http://wordpress.org/export/1.2/',
        channel: {
          title: this.siteMeta.title,
          link: this.siteMeta.url,
          description: this.siteMeta.description,
          pubDate: toRFC822(now.toISOString()),
          language: this.siteMeta.language,
          'wp:wxr_version': '1.2',
          'wp:base_site_url': this.siteMeta.url,
          'wp:base_blog_url': this.siteMeta.url,
        },
      },
    };
    let xml = collapseCdataWhitespace(xmlBuilder.build(obj) as string);
    // Strip closing tags — items and taxonomies are appended after
    xml = xml.replace(/\s*<\/channel>\s*\n?\s*<\/rss>\s*$/, '');
    return xml;
  }

  private _serializeTaxonomies(): string {
    const fragments: string[] = [];

    for (const author of this.authors) {
      fragments.push(xmlBuilder.build({
        'wp:author': {
          'wp:author_id': author.id,
          'wp:author_login': cd(author.login),
          'wp:author_email': cd(author.email),
          'wp:author_display_name': cd(author.displayName),
          'wp:author_first_name': cd(author.firstName),
          'wp:author_last_name': cd(author.lastName),
        },
      }));
    }

    for (const cat of this.categories) {
      const catObj: Record<string, unknown> = {
        'wp:term_id': cat.id,
        'wp:category_nicename': cd(cat.slug),
        'wp:category_parent': cd(cat.parent),
        'wp:cat_name': cd(cat.name),
      };
      if (cat.description) {
        catObj['wp:category_description'] = cd(cat.description);
      }
      fragments.push(xmlBuilder.build({ 'wp:category': catObj }));
    }

    for (const tag of this.tags) {
      const tagObj: Record<string, unknown> = {
        'wp:term_id': tag.id,
        'wp:tag_slug': cd(tag.slug),
        'wp:tag_name': cd(tag.name),
      };
      if (tag.description) {
        tagObj['wp:tag_description'] = cd(tag.description);
      }
      fragments.push(xmlBuilder.build({ 'wp:tag': tagObj }));
    }

    for (const term of this.terms) {
      const termObj: Record<string, unknown> = {
        'wp:term_id': term.id,
        'wp:term_taxonomy': cd(term.taxonomy),
        'wp:term_slug': cd(term.slug),
        'wp:term_parent': cd(term.parent),
        'wp:term_name': cd(term.name),
      };
      if (term.description) {
        termObj['wp:term_description'] = cd(term.description);
      }
      fragments.push(xmlBuilder.build({ 'wp:term': termObj }));
    }

    return collapseCdataWhitespace(fragments.join(''));
  }

  private _serializeItem(item: WxrItem): string {
    const slug = item.slug || '';
    const originalDate = (item.type === 'post' || item.type === 'page') ? item.date : '';
    const date = originalDate || this._fallbackDate;
    const content = (item.type === 'post' || item.type === 'page') ? item.content : '';
    const excerpt = (item.type === 'post' || item.type === 'page') ? item.excerpt : '';
    const author = (item.type === 'post' || item.type === 'page') ? (item.author || '') : '';
    const parent = (item.type === 'page') ? item.parent : ((item.type === 'nav_menu_item') ? item.parent : 0);
    const menuOrder = (item.type === 'page') ? item.menuOrder : ((item.type === 'nav_menu_item') ? item.menuOrder : 0);
    // Per-type post status. Attachments use WP's `inherit` convention; pages/
    // posts/nav use `contentStatus` — default 'draft' per the documented
    // "import as drafts; the user reviews and publishes manually" convention,
    // which the replica/preview flow overrides to 'publish' so its imported nav
    // targets resolve instead of 404ing.
    const status =
      item.type === 'attachment' ? 'inherit'
      : this.contentStatus;

    const obj: Record<string, unknown> = {
      title: item.title,
      link: this.siteMeta.url + '/' + slug,
      pubDate: date ? toRFC822(date) : '',
      'dc:creator': cd(author),
      guid: { '@_isPermaLink': 'false', '#text': this.siteMeta.url + '/?p=' + item.id },
      description: '',
      'content:encoded': cd(content),
      'excerpt:encoded': cd(excerpt),
      'wp:post_id': item.id,
      'wp:post_date': formatWpDate(date),
      'wp:post_date_gmt': formatWpDate(date),
      'wp:comment_status': 'closed',
      'wp:ping_status': 'closed',
      'wp:post_name': slug,
      'wp:status': status,
      'wp:post_parent': parent,
      'wp:menu_order': menuOrder,
      'wp:post_type': item.type,
      'wp:post_password': '',
      'wp:is_sticky': 0,
    };

    // Categories, tags, custom terms (posts only)
    if (item.type === 'post' || item.type === 'page') {
      if (item.type === 'post') {
        const categories: Array<Record<string, unknown>> = [];
        for (const catSlug of item.categories) {
          const cat = this.categories.find((c) => c.slug === catSlug);
          categories.push({ '@_domain': 'category', '@_nicename': catSlug, __cdata: safeCdata(cat ? cat.name : catSlug) });
        }
        for (const tagSlug of item.tags) {
          const tag = this.tags.find((t) => t.slug === tagSlug);
          categories.push({ '@_domain': 'post_tag', '@_nicename': tagSlug, __cdata: safeCdata(tag ? tag.name : tagSlug) });
        }
        for (const ct of item.customTerms) {
          const term = this.terms.find((t) => t.taxonomy === ct.taxonomy && t.slug === ct.slug);
          categories.push({ '@_domain': ct.taxonomy, '@_nicename': ct.slug, __cdata: safeCdata(term ? term.name : ct.slug) });
        }
        if (categories.length > 0) obj.category = categories;

        if (item.featuredMediaId) {
          this._addPostmeta(obj, '_thumbnail_id', String(item.featuredMediaId));
        }
      }

      if (item.seoTitle) this._addPostmeta(obj, '_seo_title', item.seoTitle);
      if (item.seoDescription) this._addPostmeta(obj, '_seo_description', item.seoDescription);
      if (item.sourceUrl) this._addPostmeta(obj, '_source_url', item.sourceUrl);
    }

    if (item.type === 'attachment') {
      obj['wp:attachment_url'] = cd(item.url);
      if (item.altText) {
        this._addPostmeta(obj, '_wp_attachment_image_alt', item.altText);
      }
    }

    if (item.type === 'nav_menu_item') {
      this._addPostmeta(obj, '_menu_item_url', item.url);
      this._addPostmeta(obj, '_menu_item_type', 'custom');
      this._addPostmeta(obj, '_menu_slug', item.menuSlug);
    }

    // Comments
    const itemComments = this.comments.filter((c) => c.postId === item.id);
    if (itemComments.length > 0) {
      obj['wp:comment'] = itemComments.map((comment) => ({
        'wp:comment_id': comment.id,
        'wp:comment_author': cd(comment.author),
        'wp:comment_author_email': comment.authorEmail,
        'wp:comment_author_url': comment.authorUrl,
        'wp:comment_author_IP': comment.authorIp,
        'wp:comment_date': formatWpDate(comment.date),
        'wp:comment_date_gmt': formatWpDate(comment.date),
        'wp:comment_content': cd(comment.content),
        'wp:comment_approved': comment.approved,
        'wp:comment_type': comment.type,
        'wp:comment_parent': comment.parent,
        'wp:comment_user_id': comment.userId,
      }));
    }

    return collapseCdataWhitespace(xmlBuilder.build({ item: obj }) as string);
  }

  /** Append a wp:postmeta entry to an item object. */
  private _addPostmeta(obj: Record<string, unknown>, key: string, value: string): void {
    const meta = { 'wp:meta_key': key, 'wp:meta_value': cd(value) };
    if (!obj['wp:postmeta']) {
      obj['wp:postmeta'] = [meta];
    } else {
      (obj['wp:postmeta'] as Array<unknown>).push(meta);
    }
  }

  serialize(outputPath: string): { validation: ValidationResult; wxrPath: string } {
    this._backfillInlineTerms();
    const validation = this.validate();

    mkdirSync(dirname(outputPath), { recursive: true });

    const parts: string[] = [];
    parts.push(this._serializeHeader());

    const taxonomies = this._serializeTaxonomies();
    if (taxonomies) {
      parts.push(taxonomies);
    }

    for (const item of this.items) {
      parts.push(this._serializeItem(item));
    }

    parts.push('</channel>');
    parts.push('</rss>');

    writeFileSync(outputPath, parts.join('\n'), 'utf8');

    if (this.redirects.length > 0) {
      const redirectPath = join(dirname(outputPath), 'redirect-map.json');
      writeFileSync(redirectPath, JSON.stringify(this.redirects, null, 2), 'utf8');
    }

    return { validation, wxrPath: outputPath };
  }

  openStream(outputPath: string): void {
    mkdirSync(dirname(outputPath), { recursive: true });

    this._backfillInlineTerms();
    const header = this._serializeHeader();
    const taxonomies = this._serializeTaxonomies();

    let content = header;
    if (taxonomies) {
      content += '\n' + taxonomies;
    }

    writeFileSync(outputPath, content, 'utf8');

    this._streamPath = outputPath;
    this._streaming = true;
  }

  flushItem(item: WxrItem): void {
    if (!this._streaming || !this._streamPath) {
      throw new Error('Cannot flushItem: streaming is not active. Call openStream() first.');
    }

    const itemXml = this._serializeItem(item);
    appendFileSync(this._streamPath, '\n' + itemXml, 'utf8');
  }

  closeStream(): { validation: ValidationResult; wxrPath: string } {
    if (!this._streaming || !this._streamPath) {
      throw new Error('Cannot closeStream: streaming is not active.');
    }

    appendFileSync(this._streamPath, '\n</channel>\n</rss>', 'utf8');

    if (this.redirects.length > 0) {
      const redirectPath = join(dirname(this._streamPath), 'redirect-map.json');
      writeFileSync(redirectPath, JSON.stringify(this.redirects, null, 2), 'utf8');
    }

    const validation = this.validate();
    const wxrPath = this._streamPath;

    this._streaming = false;

    return { validation, wxrPath };
  }
}
