import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const hubspotAdapter: PlatformAdapter = { id: 'hubspot', detection, discover };

export type { HubSpotAdapterOpts, HubSpotInventory } from './types.js';
