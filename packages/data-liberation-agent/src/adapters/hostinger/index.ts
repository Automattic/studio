import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';

export type { HostingerAdapterOpts, HostingerInventory } from './types.js';

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const hostingerAdapter: PlatformAdapter = { id: 'hostinger', detection, discover };
