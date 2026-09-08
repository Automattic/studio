import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discoverWeebly } from './discover.js';

export type { WeeblyInventory, WeeblyAdapterOpts } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const weeblyAdapter: PlatformAdapter = {
  id: 'weebly',
  detection,
  discover: discoverWeebly,
};
