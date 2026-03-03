/**
 * WordPress Contributor Toolkit addon — Main-process entry.
 *
 * Registers IPC handlers only. No React or renderer code here.
 * Renderer UI slots live in index.renderer.tsx.
 */
import * as handlers from './lib/ipc-handlers';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

const wpContributorToolkitMain: Pick<
	AddonDefinition,
	'manifest' | 'ipcHandlers' | 'onInitialize' | 'onTeardown'
> = {
	manifest: {
		id: 'studio-wp-contributor-toolkit',
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
	ipcHandlers: [
		{ channelName: 'wct:getState', handler: handlers.getStateHandler },
		{ channelName: 'wct:chooseRepoFolder', handler: handlers.chooseRepoFolderHandler },
		{ channelName: 'wct:addSite', handler: handlers.addSiteHandler },
		{ channelName: 'wct:removeSite', handler: handlers.removeSiteHandler },
		{ channelName: 'wct:setActiveSite', handler: handlers.setActiveSiteHandler },
		{ channelName: 'wct:createStudioSite', handler: handlers.createStudioSiteHandler },
		{ channelName: 'wct:startSite', handler: handlers.startSiteHandler },
		{ channelName: 'wct:openSiteInBrowser', handler: handlers.openSiteInBrowserHandler },
		{ channelName: 'wct:cloneRepo', handler: handlers.cloneRepoHandler },
		{ channelName: 'wct:runNpmInstall', handler: handlers.runNpmInstallHandler },
		{ channelName: 'wct:runBuild', handler: handlers.runBuildHandler },
		{ channelName: 'wct:startWatch', handler: handlers.startWatchHandler },
		{ channelName: 'wct:stopWatch', handler: handlers.stopWatchHandler },
		{ channelName: 'wct:getChangedFiles', handler: handlers.getChangedFilesHandler },
		{ channelName: 'wct:generatePatch', handler: handlers.generatePatchHandler },
		{ channelName: 'wct:openFolder', handler: handlers.openFolderHandler },
	],
	onInitialize: async ( { storage } ) => {
		const saved = ( await storage.read() ) as
			| {
					sites?: Array< {
						id: string;
						name: string;
						repoPath: string;
						siteId: string | null;
					} >;
					// Legacy single-site fields (v0 storage format)
					repoPath?: string | null;
			  }
			| undefined;

		let savedSites: Array< { id: string; name: string; repoPath: string; siteId: string | null } > =
			[];

		if ( saved?.sites ) {
			savedSites = saved.sites;
		} else if ( saved?.repoPath ) {
			// Migrate legacy single-site storage to new multi-site format
			savedSites = [
				{
					id: crypto.randomUUID(),
					name: 'wordpress-develop',
					repoPath: saved.repoPath,
					siteId: null,
				},
			];
		}

		handlers.initState( savedSites, ( data ) => storage.write( data ) );
	},
	onTeardown: async () => {
		handlers.teardown();
	},
};

export default wpContributorToolkitMain;
