import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';
import { extract } from './extract.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

// URL-based adapter detection is not currently called anywhere in the
// codebase (platform routing goes through `detect-platform.ts`). HubSpot
// CMS sites use custom domains with no URL signal, so a URL-only detector
// cannot produce a reliable signal — we intentionally return false and
// rely on the HubSpot generator meta tag registered in `detect-platform.ts`.
function detect(_url: string): boolean {
  return false;
}

export const hubspotAdapter: PlatformAdapter = { id: 'hubspot', detect, discover, extract };

export type { HubSpotAdapterOpts, HubSpotInventory } from './types.js';
