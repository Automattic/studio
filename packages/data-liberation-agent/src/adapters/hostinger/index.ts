import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';
import { extract } from './extract.js';

export type { HostingerAdapterOpts, HostingerInventory } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

function detect(_url: string): boolean {
  // Hostinger sites are on custom domains with no reliable URL pattern.
  // Detection relies entirely on HTTP fingerprinting (see detect-platform.ts
  // SOURCE_SIGNALS for zyrosite.com and Hostinger generator meta tag).
  return false;
}

export const hostingerAdapter: PlatformAdapter = { id: 'hostinger', detect, discover, extract };
