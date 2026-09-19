import type { PlatformAdapter } from '../../types.js';
import { discoverDefault } from '../default/discover.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';
import { detection } from './detection.js';

export const lovableAdapter: PlatformAdapter = {
	id: 'lovable',
	detection,
	discover: discoverDefault,
	liberation: {
		cleanupRules: [
			{ id: 'lovable-badge', category: 'source-attribution', selector: '#lovable-badge' },
			...providerCreditRules( 'lovable', [ 'lovable.dev', 'lovable.app' ], 'Lovable' ),
		],
	},
};
