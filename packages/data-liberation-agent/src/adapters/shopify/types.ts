import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';

export interface ShopifyAdapterOpts extends Record<string, unknown> {
  delay?: number;
  resume?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  cdpPort?: number;
  /** Shopify shop domain, e.g. `my-store.myshopify.com` — required for GraphQL */
  shopDomain?: string;
  /** Shopify Admin API access token. When present, products are fetched via GraphQL. */
  adminToken?: string;
  limit?: number;
}

export interface ShopifyInventory {
  siteUrl: string;
  discoveredAt: string;
  siteMeta: {
    title: string;
    tagline: string;
    language: string;
  };
  navigation: NavLink[];
  counts: Record<string, number>;
  urls: InventoryUrl[];
  jsonApiAvailable: boolean;
  /**
   * The `*.myshopify.com` hostname, auto-detected from storefront HTML.
   * Populated even when the site is served on a custom domain — every
   * Shopify storefront exposes this via a `Shopify.shop = "..."` global.
   * Used for Admin GraphQL calls when `adminToken` is supplied.
   */
  shopDomain?: string;
}

export interface ShopifyPage {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  published_at?: string;
  author?: string;
}

export interface ShopifyBlog {
  id: number;
  title: string;
  handle: string;
}

export interface ShopifyArticle {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  summary_html?: string;
  author?: string;
  tags?: string;
  published_at?: string;
  blog_id?: number;
  image?: { src: string };
}

export interface ShopifyProductVariant {
  id?: number;
  title: string;
  price: string;
  compare_at_price?: string | null;
  sku: string;
  option1?: string;
  option2?: string;
  option3?: string;
  weight?: number;
  weight_unit?: string;
  inventory_quantity?: number;
  available?: boolean;
  image_id?: number | null;
  featured_image?: { src: string } | null;
}

export interface ShopifyProductOption {
  name: string;
  values: string[];
}

export interface ShopifyProductImage {
  id?: number;
  src: string;
  variant_ids?: number[];
}

export interface ShopifyProductJson {
  title: string;
  body_html: string;
  handle: string;
  product_type?: string;
  tags?: string;
  vendor?: string;
  image?: { src: string };
  variants?: ShopifyProductVariant[];
  options?: ShopifyProductOption[];
  images?: ShopifyProductImage[];
}

// Narrow stockable-variant shape shared by `computeStock`.
export type ShopifyGqlVariantLike = {
  inventoryPolicy: 'DENY' | 'CONTINUE';
  inventoryQuantity: number | null;
  inventoryItem?: { tracked: boolean } | null | undefined;
};
