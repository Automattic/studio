/**
 * WordPress Contributor Toolkit addon — Renderer entry.
 *
 * Defines UI slots and appProviders. IPC handlers are registered by the
 * Main process via index.main.ts / registry-main.ts.
 */
import { __ } from '@wordpress/i18n';
import { ContributorProvider } from './renderer/contributor-context';
import { ContributorWorkspace } from './renderer/contributor-main-content';
import { ContributorSiteMenu } from './renderer/contributor-site-menu';
import { CreateWctSite } from './renderer/create-wct-site';
import type { AddonDefinition, MainContentContext } from 'src/modules/addons/addon-api';

export const WCT_ADDON_ID = 'studio-wp-contributor-toolkit';

const WctIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
		fill="none"
		stroke="#3858E9"
		strokeWidth="1.5"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="10" />
		<path d="M12 8v4l3 3" />
	</svg>
);

function ContributorMainContent( context: MainContentContext ) {
	if ( context.focusedAddonId !== WCT_ADDON_ID ) {
		return null;
	}
	return <ContributorWorkspace />;
}

const wpContributorToolkitAddon: AddonDefinition = {
	manifest: {
		id: WCT_ADDON_ID,
		name: 'WordPress Contributor Toolkit',
		version: '0.1.0',
		author: 'Automattic',
		description: 'Clone wordpress-develop, build it, run it, and generate patches.',
		studioVersionRange: '>=1.0.0',
		permissions: [
			'ipc:wct',
			'ui:sidebar-content',
			'ui:main-content',
			'ui:add-site-flow',
			'ui:app-providers',
			'storage:addon-data',
		],
	},
	// IPC handlers are registered by the Main process via registry-main.ts / addon-loader.ts.
	ipcHandlers: [],
	appProviders: [ ContributorProvider ],
	sidebarContent: ContributorSiteMenu,
	mainContentRenderer: ContributorMainContent,
	addSiteFlows: [
		{
			type: 'wp-contribution',
			label: __( 'WP Contribution' ),
			description: __( 'Contribute to WordPress core with a local wordpress-develop checkout.' ),
			icon: <WctIcon />,
			component: CreateWctSite,
		},
	],
};

export default wpContributorToolkitAddon;
