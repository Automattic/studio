// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WixAdapterOpts extends Record<string, unknown> {
  cdpPort?: number;
  token?: string;
  delay?: number;
  resume?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  limit?: number;
}

export interface Inventory {
  siteUrl: string;
  discoveredAt: string;
  siteMeta: {
    title: string;
    tagline: string;
    language: string;
  };
  navigation: import('../../lib/html-extract/index.js').NavLink[];
  counts: Record<string, number>;
  urls: import('../shared.js').InventoryUrl[];
}

export interface CapturedApiCall {
  url: string;
  data: unknown;
}

export interface PageMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonical: string;
}

export interface PageData {
  sourceUrl: string;
  slug: string;
  extractedAt: string;
  apiCalls: CapturedApiCall[];
  globals: Record<string, unknown>;
  jsonLd: unknown[];
  meta: PageMeta;
  accessibility: Array<{ role: string; name: string; description?: string }> | null;
  mediaUrls: string[];
  content: string;
  qualityScore: 'high' | 'medium' | 'low';
  // Raw page HTML, kept for DOM-selector fallbacks (e.g. Wix product
  // pages expose stable [data-hook] attributes that survive even when
  // JSON-LD is malformed and the products API call wasn't captured).
  pageHtml?: string;
  // Classification when DLA can identify the page as a Wix-platform widget
  // shell rather than a general-purpose page. Currently set only to
  // "blog_archive" when the Wix typed-blog feed widget is detected (the
  // listing page that shows multiple posts as cards). Absent when there's
  // no strong signal — consumers should treat absence as "general page"
  // and not infer extra meaning. Open enum so future widget classifications
  // (product listings, forums, bookings) don't require breaking consumers.
  pageType?: 'blog_archive' | string;
  // Author-set cover image for blog posts, recovered from the page's
  // BlogPosting JSON-LD (a Wix-platform standard regardless of theme).
  // Set only on Article/BlogPosting/NewsArticle pages where JSON-LD
  // exposes an `image` field; absent otherwise. Lets consumers wire the
  // post's hero image to a featured-image field without having to parse
  // it out of body content (or invent inference from leading <img> tags).
  featuredImage?: string;
}
