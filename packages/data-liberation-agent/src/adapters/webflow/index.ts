import type { PlatformAdapter } from '../../types.js';
import { detection } from './detection.js';
import { discoverWebflow } from './discover.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';

export type { WebflowInventory, WebflowAdapterOpts } from './discover.js';

export const webflowAdapter: PlatformAdapter = {
  id: 'webflow',
  detection,
  discover: discoverWebflow,
  liberation: { cleanupRules: [
    { id: 'webflow-badge', category: 'source-attribution', selector: '.w-webflow-badge' },
    ...providerCreditRules('webflow', ['webflow.com'], 'Webflow'),
  ] },
};
