import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { GoDaddyWmAdapterOpts, GoDaddyWmInventory } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const godaddyWmAdapter: PlatformAdapter = {
  id: 'godaddy-wm',
  detection,
  discover,
  liberation: { cleanupRules: providerCreditRules('godaddy', ['godaddy.com'], 'GoDaddy') },
};
