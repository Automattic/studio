/**
 * VIP Local Development Environment addon — Main-process entry.
 *
 * Registers IPC handlers only. No React or renderer code here.
 * Renderer UI slots live in index.renderer.tsx.
 */
import * as handlers from './lib/ipc-handlers';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

const vipEnvironmentMain: Pick<
	AddonDefinition,
	'manifest' | 'ipcHandlers' | 'onInitialize' | 'onTeardown'
> = {
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
	ipcHandlers: [
		{ channelName: 'vip:isCliAvailable', handler: handlers.isVipCliAvailableHandler },
		{ channelName: 'vip:getEnvironments', handler: handlers.getVipEnvironmentsHandler },
		{
			channelName: 'vip:getEnvironmentDetails',
			handler: handlers.getVipEnvironmentDetailsHandler,
		},
		{ channelName: 'vip:startEnvironment', handler: handlers.startVipEnvHandler },
		{ channelName: 'vip:stopEnvironment', handler: handlers.stopVipEnvHandler },
		{ channelName: 'vip:executeVipCliCommand', handler: handlers.executeVipCliCommandHandler },
		{ channelName: 'vip:openEnvironmentFolder', handler: handlers.openVipEnvFolderHandler },
		{ channelName: 'vip:openAppCodeFolder', handler: handlers.openVipAppCodeFolderHandler },
		{
			channelName: 'vip:openEnvironmentInBrowser',
			handler: handlers.openVipEnvInBrowserHandler,
		},
		{ channelName: 'vip:getVipDataPath', handler: handlers.getVipDataPathHandler },
		{ channelName: 'vip:createEnvironment', handler: handlers.createVipEnvHandler },
	],
};

export default vipEnvironmentMain;
