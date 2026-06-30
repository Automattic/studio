import type { InventoryUrl } from '../shared.js';
import type { NavLink } from '../../lib/html-extract/index.js';

export interface DefaultAdapterOpts extends Record<string, unknown> {
  delay?: number;
  resume?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  outputDir?: string;
  limit?: number;
  /** Connect to an already-running Chrome over CDP instead of launching one. */
  cdpPort?: number;
  /** Render pages in a browser before extracting (default true). false = fetch only. */
  render?: boolean;
}

export interface DefaultInventory {
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
