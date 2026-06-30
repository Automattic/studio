import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';
import { extract } from './extract.js';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { GoDaddyWmAdapterOpts, GoDaddyWmInventory } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const godaddyWmAdapter: PlatformAdapter = {
  id: 'godaddy-wm',

  // W+M sites run on custom domains — detection happens via HTTP source
  // signals in detect-platform.ts, not URL pattern matching.
  detect(_url: string): boolean {
    return false;
  },

  discover,
  extract,
};
