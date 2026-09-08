import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discover } from './discover.js';

export type { SquarespaceInventory, SquarespaceAdapterOpts } from './types.js';

export const squarespaceAdapter: PlatformAdapter = { id: 'squarespace', detection, discover };
