/**
 * React context for the WordPress Contributor Toolkit addon.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { CloneProgress, ContributorToolkitState, PatchResult, WctSite } from '../types';
import type { IpcRendererEvent } from 'electron';
import type { ReactNode } from 'react';

interface WctIpcApi {
	wctGetState: () => Promise< ContributorToolkitState >;
	wctChooseRepoFolder: () => Promise< string | null >;
	wctAddSite: ( name: string, repoPath: string ) => Promise< WctSite >;
	wctRemoveSite: ( siteId: string ) => Promise< void >;
	wctSetActiveSite: ( siteId: string | null ) => Promise< void >;
	wctCreateStudioSite: ( wctSiteId: string ) => Promise< void >;
	wctStartSite: ( wctSiteId: string ) => Promise< void >;
	wctOpenSiteInBrowser: ( wctSiteId: string ) => Promise< void >;
	wctCloneRepo: ( wctSiteId: string, targetPath: string ) => Promise< void >;
	wctRunNpmInstall: ( wctSiteId: string ) => Promise< void >;
	wctRunBuild: ( wctSiteId: string ) => Promise< void >;
	wctStartWatch: ( wctSiteId: string ) => Promise< void >;
	wctStopWatch: ( wctSiteId: string ) => Promise< void >;
	wctGetChangedFiles: ( wctSiteId: string ) => Promise< string[] >;
	wctGeneratePatch: ( wctSiteId: string, outputPath: string ) => Promise< PatchResult >;
	wctOpenFolder: ( path: string ) => Promise< void >;
}

function getWctApi(): WctIpcApi | null {
	const api = window.ipcApi as unknown as WctIpcApi | undefined;
	if ( ! api || typeof api.wctGetState !== 'function' ) {
		return null;
	}
	return api;
}

interface ContributorContextValue {
	sites: WctSite[];
	activeSiteId: string | null;
	activeSite: WctSite | null;
	cloneProgress: CloneProgress | null;
	logLines: string[];
	changedFiles: string[];
	/** Studio site IDs managed by WCT — should be hidden from the regular site list */
	hiddenStudioSiteIds: Set< string >;
	addSite: ( name: string, repoPath: string ) => Promise< WctSite | null >;
	removeSite: ( siteId: string ) => Promise< void >;
	setActiveSite: ( siteId: string | null ) => Promise< void >;
	createStudioSite: ( wctSiteId: string ) => Promise< void >;
	startSite: ( wctSiteId: string ) => Promise< void >;
	openInBrowser: ( wctSiteId: string ) => Promise< void >;
	clone: ( wctSiteId: string, targetPath: string ) => Promise< void >;
	runInstall: ( wctSiteId: string ) => Promise< void >;
	runBuild: ( wctSiteId: string ) => Promise< void >;
	startWatch: ( wctSiteId: string ) => Promise< void >;
	stopWatch: ( wctSiteId: string ) => Promise< void >;
	generatePatch: ( wctSiteId: string ) => Promise< void >;
	refreshChangedFiles: ( wctSiteId: string ) => Promise< void >;
	openFolder: ( path: string ) => Promise< void >;
	chooseRepoFolder: () => Promise< string | null >;
}

export const ContributorContext = createContext< ContributorContextValue | null >( null );

export function ContributorProvider( { children }: { children: ReactNode } ) {
	const { refreshSites } = useSiteDetails();
	const [ sites, setSites ] = useState< WctSite[] >( [] );
	const [ activeSiteId, setActiveSiteId ] = useState< string | null >( null );
	const [ cloneProgress, setCloneProgress ] = useState< CloneProgress | null >( null );
	const [ logLines, setLogLines ] = useState< string[] >( [] );
	const [ changedFiles, setChangedFiles ] = useState< string[] >( [] );

	const activeSite = sites.find( ( s ) => s.id === activeSiteId ) ?? null;
	const hiddenStudioSiteIds = new Set(
		sites.map( ( s ) => s.siteId ).filter( Boolean ) as string[]
	);

	// Hydrate state from main process on mount
	useEffect( () => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		void api.wctGetState().then( ( state ) => {
			setSites( state.sites );
			setActiveSiteId( state.activeSiteId );
			setLogLines( state.logLines );
			setChangedFiles( state.changedFiles );
		} );
	}, [] );

	// Listen for site updates from the main process
	useEffect( () => {
		if ( ! window.ipcListener ) {
			return;
		}
		return window.ipcListener.subscribe(
			'wct:siteUpdated' as never,
			( _event: IpcRendererEvent, updatedSite: WctSite ) => {
				setSites( ( prev ) =>
					prev.map( ( s ) => ( s.id === updatedSite.id ? { ...s, ...updatedSite } : s ) )
				);
			}
		);
	}, [] );

	// Listen for clone progress events
	useEffect( () => {
		if ( ! window.ipcListener ) {
			return;
		}
		return window.ipcListener.subscribe(
			'wct:cloneProgress' as never,
			( _event: IpcRendererEvent, progress: CloneProgress ) => {
				setCloneProgress( progress );
			}
		);
	}, [] );

	// Listen for build log lines (install, build, and watch all share this channel)
	useEffect( () => {
		if ( ! window.ipcListener ) {
			return;
		}
		return window.ipcListener.subscribe(
			'wct:buildLog' as never,
			( _event: IpcRendererEvent, line: string ) => {
				setLogLines( ( prev ) => [ ...prev.slice( -199 ), line ] );
			}
		);
	}, [] );

	// Clear log when a new install/build starts
	useEffect( () => {
		if ( ! window.ipcListener ) {
			return;
		}
		return window.ipcListener.subscribe( 'wct:clearLog' as never, () => {
			setLogLines( [] );
		} );
	}, [] );

	const addSite = useCallback(
		async ( name: string, repoPath: string ) => {
			const api = getWctApi();
			if ( ! api ) {
				return null;
			}
			const site = await api.wctAddSite( name, repoPath );
			setSites( ( prev ) => [ ...prev, site ] );
			setActiveSiteId( site.id );
			// Refresh useSiteDetails so the auto-created Studio site (repoPath/build/)
			// becomes visible to useSiteDetails consumers (sidebar toggle, header ActionButton).
			await refreshSites();
			return site;
		},
		[ refreshSites ]
	);

	const removeSite = useCallback(
		async ( siteId: string ) => {
			const api = getWctApi();
			if ( ! api ) {
				return;
			}
			await api.wctRemoveSite( siteId );
			setSites( ( prev ) => prev.filter( ( s ) => s.id !== siteId ) );
			setActiveSiteId( ( prev ) => {
				if ( prev === siteId ) {
					const remaining = sites.filter( ( s ) => s.id !== siteId );
					return remaining.length > 0 ? remaining[ 0 ].id : null;
				}
				return prev;
			} );
			// Sync useSiteDetails — the linked Studio site was deleted on the main process side.
			await refreshSites();
		},
		[ sites, refreshSites ]
	);

	const setActiveSite = useCallback( async ( siteId: string | null ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctSetActiveSite( siteId );
		setActiveSiteId( siteId );
	}, [] );

	const createStudioSite = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctCreateStudioSite( wctSiteId );
	}, [] );

	const startSite = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctStartSite( wctSiteId );
	}, [] );

	const openInBrowser = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctOpenSiteInBrowser( wctSiteId );
	}, [] );

	const clone = useCallback( async ( wctSiteId: string, targetPath: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		setSites( ( prev ) =>
			prev.map( ( s ) => ( s.id === wctSiteId ? { ...s, repoStatus: 'cloning' } : s ) )
		);
		setCloneProgress( null );
		try {
			await api.wctCloneRepo( wctSiteId, targetPath );
		} catch ( error ) {
			setSites( ( prev ) =>
				prev.map( ( s ) => ( s.id === wctSiteId ? { ...s, repoStatus: 'error' } : s ) )
			);
			console.error( 'Clone failed:', error );
		}
	}, [] );

	const runInstall = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctRunNpmInstall( wctSiteId );
	}, [] );

	const runBuild = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctRunBuild( wctSiteId );
	}, [] );

	const startWatch = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctStartWatch( wctSiteId );
	}, [] );

	const stopWatch = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctStopWatch( wctSiteId );
	}, [] );

	const refreshChangedFiles = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		const files = await api.wctGetChangedFiles( wctSiteId );
		setChangedFiles( files );
	}, [] );

	const generatePatch = useCallback( async ( wctSiteId: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		const filePath = await getIpcApi().showSaveAsDialog( {
			title: 'Save Patch File',
			defaultPath: 'wordpress.patch',
			filters: [ { name: 'Patch Files', extensions: [ 'patch', 'diff' ] } ],
		} );
		if ( ! filePath ) {
			return;
		}
		await api.wctGeneratePatch( wctSiteId, filePath );
	}, [] );

	const openFolder = useCallback( async ( folderPath: string ) => {
		const api = getWctApi();
		if ( ! api ) {
			return;
		}
		await api.wctOpenFolder( folderPath );
	}, [] );

	const chooseRepoFolder = useCallback( async () => {
		const api = getWctApi();
		if ( ! api ) {
			return null;
		}
		return api.wctChooseRepoFolder();
	}, [] );

	return (
		<ContributorContext.Provider
			value={ {
				sites,
				activeSiteId,
				activeSite,
				hiddenStudioSiteIds,
				cloneProgress,
				logLines,
				changedFiles,
				addSite,
				removeSite,
				setActiveSite,
				createStudioSite,
				startSite,
				openInBrowser,
				clone,
				runInstall,
				runBuild,
				startWatch,
				stopWatch,
				generatePatch,
				refreshChangedFiles,
				openFolder,
				chooseRepoFolder,
			} }
		>
			{ children }
		</ContributorContext.Provider>
	);
}

export function useContributorContext(): ContributorContextValue {
	const ctx = useContext( ContributorContext );
	if ( ! ctx ) {
		return {
			sites: [],
			activeSiteId: null,
			activeSite: null,
			hiddenStudioSiteIds: new Set< string >(),
			cloneProgress: null,
			logLines: [],
			changedFiles: [],
			addSite: async () => null,
			removeSite: async () => {},
			setActiveSite: async () => {},
			createStudioSite: async () => {},
			startSite: async () => {},
			openInBrowser: async () => {},
			clone: async () => {},
			runInstall: async () => {},
			runBuild: async () => {},
			startWatch: async () => {},
			stopWatch: async () => {},
			generatePatch: async () => {},
			refreshChangedFiles: async () => {},
			openFolder: async () => {},
			chooseRepoFolder: async () => null,
		};
	}
	return ctx;
}
