import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';

export type { HostingerAdapterOpts, HostingerInventory } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const hostingerAdapter: PlatformAdapter = { id: 'hostinger', detection, discover,
  liberation: { cleanupRules: [...providerCreditRules('hostinger', ['hostinger.com'], 'Hostinger'), ...providerCreditRules('zyro', ['zyro.com'], 'Zyro')] },
};
