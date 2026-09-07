import type { PlatformAdapter } from '../../types.js';
import { capture } from './capture.js';
import { detection } from './detection.js';
import { discover } from './discover.js';

// Re-export shared types so existing consumers still work
export type { InventoryUrl } from '../shared.js';
export type { NavLink } from '../../lib/html-extract/index.js';

export type { WixAdapterOpts, Inventory, CapturedApiCall, PageMeta, PageData } from './types.js';
export { isExecutionContextDestroyed, ROUTE_PIN_INIT_SCRIPT } from './runtime.js';
export { extractGalleryFromHtml } from './gallery.js';

export { wixMediaVariant } from './capture.js';

export const wixAdapter: PlatformAdapter = { id: 'wix', detection, discover, liberation: capture };
