import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';

export interface SquarespaceAdapterOpts extends Record<string, unknown> {
  cdpPort?: number;
  delay?: number;
  resume?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  limit?: number;
}

export interface SquarespaceInventory {
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
}

export interface SqsJsonResponse {
  collection?: {
    title?: string;
    urlId?: string;
    type?: number;
    typeName?: string;
    description?: string;
    mainContent?: string;
    enabled?: boolean;
  };
  item?: {
    title?: string;
    urlId?: string;
    body?: string;
    excerpt?: string;
    publishOn?: number;
    addedOn?: number;
    tags?: string[];
    categories?: string[];
    assetUrl?: string;
    systemDataId?: string;
    structuredContent?: Record<string, unknown>;
    author?: { displayName?: string };
    seoData?: {
      seoTitle?: string;
      seoDescription?: string;
    };
  };
  items?: Array<{
    title?: string;
    urlId?: string;
    fullUrl?: string;
    body?: string;
    excerpt?: string;
    publishOn?: number;
    addedOn?: number;
    tags?: string[];
    categories?: string[];
    assetUrl?: string;
  }>;
  website?: {
    siteTitle?: string;
    siteTagLine?: string;
    siteDescription?: string;
    language?: string;
  };
  websiteSettings?: {
    siteTitle?: string;
    siteTagLine?: string;
    siteDescription?: string;
  };
}

export interface AdminEntry {
  url: string;
  title: string;
  type: string;
  visibility: 'published' | 'draft' | 'unlinked' | 'password-protected';
  adminPageId: string | null;
}
