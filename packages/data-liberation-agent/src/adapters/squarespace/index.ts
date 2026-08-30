import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';

export type { SquarespaceInventory, SquarespaceAdapterOpts } from './types.js';

function detect(url: string): boolean {
  return /squarespace\.com/i.test(url);
}

export const squarespaceAdapter: PlatformAdapter = { id: 'squarespace', detect, discover };
