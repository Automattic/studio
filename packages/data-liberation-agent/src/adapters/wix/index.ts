import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';
import { extract } from './extract.js';

// Re-export shared types so existing consumers still work
export type { InventoryUrl } from '../shared.js';
export type { NavLink } from '../../lib/html-extract/index.js';

export type { WixAdapterOpts, Inventory, CapturedApiCall, PageMeta, PageData } from './types.js';
export { isExecutionContextDestroyed, ROUTE_PIN_INIT_SCRIPT } from './runtime.js';
export { extractGalleryFromHtml } from './gallery.js';

function detect(url: string): boolean {
  return /wixsite\.com|wix\.com/i.test(url);
}

export const wixAdapter: PlatformAdapter = { id: 'wix', detect, discover, extract };
