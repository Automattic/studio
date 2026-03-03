/**
 * Hello Tab addon — Renderer entry.
 * Demonstrates the contentTabs slot: adds a "Hello" tab to every Studio site.
 */
import { HelloTab } from './renderer/hello-tab';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

const helloTabAddon: AddonDefinition = {
	manifest: {
		id: 'studio-hello-tab',
		name: 'Hello Tab',
		version: '0.1.0',
		author: 'Automattic',
		description: 'Test addon — adds a Hello tab to every Studio site.',
		studioVersionRange: '>=3.0.0',
		permissions: [ 'ui:content-tabs' ],
	},

	contentTabs: [
		{
			name: 'hello',
			title: 'Hello There',
			order: 100,
			component: HelloTab,
		},
	],
};

export default helloTabAddon;
