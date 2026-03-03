/**
 * IPC handlers for the WordPress Contributor Toolkit addon.
 */
import { dialog, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { SiteServer } from 'src/site-server';
import * as buildOps from './build-operations';
import * as gitOps from './git-operations';
import type { ContributorToolkitState, PatchResult, WctSite } from '../types';

// Module-level state
let sites: WctSite[] = [];
let activeSiteId: string | null = null;
let logLines: string[] = [];
let changedFiles: string[] = [];

// Persist callback — set by onInitialize
let persistFn:
	| ( ( data: {
			sites: Array< { id: string; name: string; repoPath: string; siteId: string | null } >;
	  } ) => Promise< void > )
	| null = null;

async function persistSites(): Promise< void > {
	if ( ! persistFn ) {
		return;
	}
	await persistFn( {
		sites: sites.map( ( s ) => ( {
			id: s.id,
			name: s.name,
			repoPath: s.repoPath,
			siteId: s.siteId,
		} ) ),
	} );
}

function makeSite(
	overrides: Partial< WctSite > & { id: string; name: string; repoPath: string }
): WctSite {
	return {
		siteId: null,
		repoStatus: 'ready',
		installStatus: 'idle',
		buildStatus: 'idle',
		watchStatus: 'idle',
		...overrides,
	};
}

export function initState(
	savedSites: Array< { id: string; name: string; repoPath: string; siteId: string | null } >,
	persist: ( data: {
		sites: Array< { id: string; name: string; repoPath: string; siteId: string | null } >;
	} ) => Promise< void >
): void {
	persistFn = persist;
	sites = savedSites.map( ( s ) =>
		makeSite( {
			id: s.id,
			name: s.name,
			repoPath: s.repoPath,
			siteId: s.siteId,
			repoStatus: 'ready',
		} )
	);
	activeSiteId = sites.length > 0 ? sites[ 0 ].id : null;

	// Auto-create Studio sites for any migrated/existing sites that lack one
	void ( async () => {
		let didPersist = false;
		for ( const site of sites ) {
			if ( site.siteId ) {
				continue;
			}
			try {
				const buildPath = path.join( site.repoPath, 'build' );
				const { server } = await SiteServer.create(
					{ path: buildPath, name: site.name, phpVersion: '8.2', noStart: true },
					{}
				);
				site.siteId = server.details.id;
				didPersist = true;
			} catch ( err ) {
				console.error( '[WCT] Auto-create Studio site failed for', site.name, err );
			}
		}
		if ( didPersist ) {
			await persistSites();
		}
	} )();
}

export function teardown(): void {
	buildOps.stopAllWatches();
	sites = [];
	activeSiteId = null;
	logLines = [];
	changedFiles = [];
	persistFn = null;
}

export async function getStateHandler( _event: unknown ): Promise< ContributorToolkitState > {
	return {
		sites,
		activeSiteId,
		cloneProgress: null,
		logLines,
		changedFiles,
	};
}

export async function addSiteHandler(
	_event: unknown,
	name: unknown,
	repoPath: unknown
): Promise< WctSite > {
	const site = makeSite( {
		id: crypto.randomUUID(),
		name: name as string,
		repoPath: repoPath as string,
		repoStatus: 'ready',
	} );
	sites = [ ...sites, site ];
	activeSiteId = site.id;

	// Auto-create the linked Studio site at repoPath/build/
	try {
		const buildPath = path.join( site.repoPath, 'build' );
		const { server } = await SiteServer.create(
			{ path: buildPath, name: site.name, phpVersion: '8.2', noStart: true },
			{}
		);
		site.siteId = server.details.id;
	} catch ( err ) {
		console.error( '[WCT] Auto-create Studio site failed:', err );
	}

	await persistSites();
	return site;
}

export async function removeSiteHandler( _event: unknown, siteId: unknown ): Promise< void > {
	const id = siteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( site ) {
		buildOps.stopWatch( id );
		// Delete the linked Studio site (registration only, keep files on disk)
		if ( site.siteId ) {
			const server = SiteServer.get( site.siteId );
			if ( server ) {
				await server.delete( false );
			}
		}
	}
	sites = sites.filter( ( s ) => s.id !== id );
	if ( activeSiteId === id ) {
		activeSiteId = sites.length > 0 ? sites[ 0 ].id : null;
	}
	await persistSites();
}

export async function setActiveSiteHandler( _event: unknown, siteId: unknown ): Promise< void > {
	activeSiteId = siteId as string | null;
}

export async function createStudioSiteHandler(
	event: unknown,
	wctSiteId: unknown
): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	const buildPath = path.join( site.repoPath, 'build' );
	const { server } = await SiteServer.create(
		{ path: buildPath, name: site.name, phpVersion: '8.2', noStart: true },
		{}
	);
	site.siteId = server.details.id;
	await persistSites();

	const ipcEvent = event as IpcMainInvokeEvent;
	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
	}
}

export async function startSiteHandler( event: unknown, wctSiteId: unknown ): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site?.siteId ) {
		return;
	}

	const server = SiteServer.get( site.siteId );
	if ( ! server ) {
		return;
	}

	await server.start();

	const ipcEvent = event as IpcMainInvokeEvent;
	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
	}
}

export async function openSiteInBrowserHandler(
	_event: unknown,
	wctSiteId: unknown
): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site?.siteId ) {
		return;
	}

	const server = SiteServer.get( site.siteId );
	if ( ! server?.details.running || ! server.details.url ) {
		return;
	}

	await shell.openExternal( server.details.url );
}

export async function cloneRepoHandler(
	event: unknown,
	wctSiteId: unknown,
	targetPath: unknown
): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	site.repoStatus = 'cloning';
	const ipcEvent = event as IpcMainInvokeEvent;

	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
	}

	try {
		await gitOps.cloneWordPressDevelop( targetPath as string, ( progress ) => {
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:cloneProgress', progress );
			}
		} );

		site.repoStatus = 'ready';
	} catch ( error ) {
		site.repoStatus = 'error';
		throw error;
	} finally {
		if ( ! ipcEvent.sender.isDestroyed() ) {
			ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
		}
	}
}

export async function runNpmInstallHandler( event: unknown, wctSiteId: unknown ): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	const ipcEvent = event as IpcMainInvokeEvent;
	site.installStatus = 'running';
	logLines = [];

	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
		ipcEvent.sender.send( 'wct:clearLog' );
	}

	buildOps.runNpmInstall(
		site.repoPath,
		( line ) => {
			logLines = [ ...logLines.slice( -199 ), line ];
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:buildLog', line );
			}
		},
		( success ) => {
			site.installStatus = success ? 'success' : 'error';
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
			}
		}
	);
}

export async function runBuildHandler( event: unknown, wctSiteId: unknown ): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	const ipcEvent = event as IpcMainInvokeEvent;
	site.buildStatus = 'running';
	logLines = [];

	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
		ipcEvent.sender.send( 'wct:clearLog' );
	}

	buildOps.runBuild(
		site.repoPath,
		( line ) => {
			logLines = [ ...logLines.slice( -199 ), line ];
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:buildLog', line );
			}
		},
		( success ) => {
			site.buildStatus = success ? 'success' : 'error';
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
			}
		}
	);
}

export async function startWatchHandler( event: unknown, wctSiteId: unknown ): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	const ipcEvent = event as IpcMainInvokeEvent;
	logLines = [];

	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:clearLog' );
	}

	buildOps.startWatch(
		id,
		site.repoPath,
		( line ) => {
			logLines = [ ...logLines.slice( -199 ), line ];
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:buildLog', line );
			}
		},
		( status ) => {
			site.watchStatus = status;
			if ( ! ipcEvent.sender.isDestroyed() ) {
				ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
			}
		}
	);

	site.watchStatus = 'running';
	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
	}
}

export async function stopWatchHandler( event: unknown, wctSiteId: unknown ): Promise< void > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return;
	}

	buildOps.stopWatch( id );
	site.watchStatus = 'idle';

	const ipcEvent = event as IpcMainInvokeEvent;
	if ( ! ipcEvent.sender.isDestroyed() ) {
		ipcEvent.sender.send( 'wct:siteUpdated', { ...site } );
	}
}

export async function getChangedFilesHandler(
	_event: unknown,
	wctSiteId: unknown
): Promise< string[] > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return [];
	}

	try {
		changedFiles = await gitOps.getChangedFiles( site.repoPath );
		return changedFiles;
	} catch {
		return [];
	}
}

export async function generatePatchHandler(
	_event: unknown,
	wctSiteId: unknown,
	outputPath: unknown
): Promise< PatchResult > {
	const id = wctSiteId as string;
	const site = sites.find( ( s ) => s.id === id );
	if ( ! site ) {
		return { success: false, error: 'No repository configured.' };
	}

	return gitOps.generateUnifiedPatch( site.repoPath, outputPath as string );
}

export async function openFolderHandler( _event: unknown, folderPath: unknown ): Promise< void > {
	await shell.openPath( folderPath as string );
}

export async function chooseRepoFolderHandler( _event: unknown ): Promise< string | null > {
	const result = await dialog.showOpenDialog( {
		title: 'Select wordpress-develop Directory',
		properties: [ 'openDirectory' ],
	} );

	if ( result.canceled || result.filePaths.length === 0 ) {
		return null;
	}

	return result.filePaths[ 0 ];
}
