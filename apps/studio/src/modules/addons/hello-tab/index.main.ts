/**
 * Hello Tab addon — Main process entry.
 * This addon adds no IPC handlers; it exists only as a renderer tab.
 */
import type { AddonDefinition } from 'src/modules/addons/addon-api';

const helloTabMain: Pick< AddonDefinition, 'manifest' > = {
	manifest: {
		id: 'studio-hello-tab',
		name: 'Hello Tab',
		version: '0.1.0',
		author: 'Automattic',
		description: 'Test addon — adds a Hello tab to every Studio site.',
		studioVersionRange: '>=3.0.0',
		permissions: [ 'ui:content-tabs' ],
	},
};

export default helloTabMain;
