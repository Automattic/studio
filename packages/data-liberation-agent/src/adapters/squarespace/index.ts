import type { PlatformAdapter } from '../../types.js';
import { discover } from './discover.js';
import { extract } from './extract.js';
import { blocks } from './blocks.js';

export type { SquarespaceInventory, SquarespaceAdapterOpts } from './types.js';

function detect(url: string): boolean {
  return /squarespace\.com/i.test(url);
}

export const squarespaceAdapter: PlatformAdapter = { id: 'squarespace', detect, discover, extract, blocks };
