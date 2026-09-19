import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const hubspotAdapter: PlatformAdapter = { id: 'hubspot', detection, discover,
  liberation: { cleanupRules: providerCreditRules('hubspot', ['hubspot.com'], 'HubSpot') },
};

export type { HubSpotAdapterOpts, HubSpotInventory } from './types.js';
