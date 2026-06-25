import type { PlatformAdapter } from '../../types.js';
import { discoverWebflow } from './discover.js';
import { extractWebflow } from './extract.js';

export type { WebflowInventory, WebflowAdapterOpts } from './discover.js';

function detect(url: string): boolean {
  return /webflow\.io|webflow\.com/i.test(url);
}

export const webflowAdapter: PlatformAdapter = {
  id: 'webflow',
  detect,
  discover: discoverWebflow,
  extract: extractWebflow,
};
