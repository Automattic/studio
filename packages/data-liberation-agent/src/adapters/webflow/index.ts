import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discoverWebflow } from './discover.js';

export type { WebflowInventory, WebflowAdapterOpts } from './discover.js';

export const webflowAdapter: PlatformAdapter = {
  id: 'webflow',
  detection,
  discover: discoverWebflow,
};
