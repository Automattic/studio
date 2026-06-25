import type { PlatformAdapter } from '../../types.js';
import { discoverWeebly } from './discover.js';
import { extractWeebly } from './extract.js';

export type { WeeblyInventory, WeeblyAdapterOpts } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

function detect(url: string): boolean {
  return /weebly\.com/i.test(url);
}

export const weeblyAdapter: PlatformAdapter = {
  id: 'weebly',
  detect,
  discover: discoverWeebly,
  extract: extractWeebly,
};
