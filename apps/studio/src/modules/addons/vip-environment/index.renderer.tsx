/**
 * VIP Local Development Environment addon — Renderer entry.
 *
 * Defines UI slots and preloadApi (invoked from the preload bundle context).
 * IPC handlers are registered by the Main process via index.main.ts / registry-main.ts.
 */
import { __ } from '@wordpress/i18n';
import { useContext } from 'react';
import { CreateVipSite } from './renderer/create-vip-site';
import { VipContentArea } from './renderer/vip-content-area';
import { VipContext, VipProvider } from './renderer/vip-context';
import { VipSiteMenu } from './renderer/vip-site-menu';
import type { AddonDefinition, MainContentContext } from 'src/modules/addons/addon-api';

const VIP_ADDON_ID = 'studio-vip-environment';

// Reads selectedEnvironment directly from context — no module-level variable, no lag.
function VipMainContent( context: MainContentContext ) {
	const ctx = useContext( VipContext );
	// Another addon has explicit focus — yield
	if ( context.focusedAddonId !== null && context.focusedAddonId !== VIP_ADDON_ID ) {
		return null;
	}
	if ( ! ctx?.selectedEnvironment ) {
		return null;
	}
	return <VipContentArea />;
}

const VipIcon = () => (
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
		<rect x="2" y="3" width="20" height="14" rx="2" />
		<path d="M8 21h8M12 17v4" />
	</svg>
);

const vipEnvironmentAddon: AddonDefinition = {
	manifest: {
		id: 'studio-vip-environment',
		name: 'VIP Local Development Environment',
		version: '0.1.0',
		author: 'Automattic',
		description: 'Manage VIP Local Development Environments from Studio.',
		studioVersionRange: '>=1.0.0',
		permissions: [
			'ipc:vip',
			'ui:sidebar-content',
			'ui:main-content',
			'ui:add-site-flow',
			'ui:app-providers',
		],
	},
	// IPC handlers are registered by the Main process via registry-main.ts / addon-loader.ts.
	ipcHandlers: [],
	// preloadApi is defined in index.preload.ts and merged by addon-preload-api.ts.
	// It must NOT be defined here because this file is bundled into the renderer,
	// where ipcRenderer is not available.
	appProviders: [ VipProvider ],
	sidebarContent: VipSiteMenu,
	mainContentRenderer: VipMainContent,
	addSiteFlows: [
		{
			type: 'vip',
			label: __( 'Create a VIP site' ),
			description: __( 'Create a VIP Local Development Environment' ),
			icon: <VipIcon />,
			component: CreateVipSite,
		},
	],
};

export default vipEnvironmentAddon;
