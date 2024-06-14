import { useState, useEffect, useMemo, useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useGetWpVersion } from './use-get-wp-version';
import { useSiteDetails } from './use-site-details';
import { useWindowListener } from './use-window-listener';

export interface SiteContext {
	currentURL: string;
	pluginList: string[];
	themeList: string[];
	numberOfSites: number;
	themeName?: string;
	wpVersion: string;
	phpVersion: string;
	isBlockTheme?: boolean;
}

function parseWpCliOutput( stdout: string, defaultValue: string[] ): string[] {
	try {
		const data = JSON.parse( stdout );
		return data?.map( ( item: { name: string } ) => item.name ) || [];
	} catch ( error ) {
		console.error( error );
	}
	return defaultValue;
}

export const useChatContext = ( selectedSite: SiteDetails ) => {
	const [ initialLoad, setInitialLoad ] = useState< Record< string, boolean > >( {} );
	const { data: sites, loadingSites } = useSiteDetails();
	const wpVersion = useGetWpVersion( selectedSite || ( {} as SiteDetails ) );
	const [ pluginsList, setPluginsList ] = useState< Record< string, string[] > >( {} );
	const [ themesList, setThemesList ] = useState< Record< string, string[] > >( {} );
	const numberOfSites = sites?.length || 0;
	const { path, port, themeDetails } = selectedSite;

	const fetchPluginList = useCallback( async ( path: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			projectPath: path,
			args: [ 'plugin', 'list', '--format=json', '--status=active' ],
		} );
		if ( stderr ) {
			return [];
		}
		return parseWpCliOutput( stdout, [] );
	}, [] );

	const fetchThemeList = useCallback( async ( path: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			projectPath: path,
			args: [ 'theme', 'list', '--format=json' ],
		} );
		if ( stderr ) {
			return [];
		}
		return parseWpCliOutput( stdout, [] );
	}, [] );

	useEffect( () => {
		let isCurrent = true;
		// Initial load. Prefetch all the plugins and themes for the sites.
		const run = async () => {
			const isCurrent = true;
			const result = await Promise.all( [
				fetchPluginList( selectedSite.path ),
				fetchThemeList( selectedSite.path ),
			] );
			if ( isCurrent ) {
				setInitialLoad( ( prev ) => ( { ...prev, [ selectedSite.id ]: true } ) );
				setPluginsList( ( prev ) => ( { ...prev, [ selectedSite.id ]: result[ 0 ] } ) );
				setThemesList( ( prev ) => ( { ...prev, [ selectedSite.id ]: result[ 1 ] } ) );
			}
		};
		if ( selectedSite && ! loadingSites && ! initialLoad[ selectedSite.id ] && isCurrent ) {
			run();
		}
		return () => {
			isCurrent = false;
		};
	}, [
		fetchPluginList,
		fetchThemeList,
		initialLoad,
		loadingSites,
		pluginsList,
		selectedSite,
		sites,
		themesList,
	] );

	useWindowListener( 'focus', async () => {
		// When the window is focused, we need to kick off a request to refetch the theme details, if server is running.
		if ( ! selectedSite?.id || selectedSite.running === false ) {
			return;
		}
		const plugins = await fetchPluginList( path );
		const themes = await fetchThemeList( path );
		pluginsList[ selectedSite.id ] = plugins;
		themesList[ selectedSite.id ] = themes;
	} );
	const siteContext: SiteContext = useMemo( () => {
		return {
			numberOfSites,
			themeList: themesList[ selectedSite.id ] || [],
			pluginList: pluginsList[ selectedSite.id ] || [],
			wpVersion,
			// This will be fetched by a hook when php selection is merged
			phpVersion: '8.0',
			currentURL: `http://localhost:${ port }`,
			themeName: themeDetails?.name,
			isBlockTheme: themeDetails?.isBlockTheme,
		};
	}, [
		numberOfSites,
		themesList,
		selectedSite.id,
		pluginsList,
		wpVersion,
		port,
		themeDetails?.name,
		themeDetails?.isBlockTheme,
	] );

	return siteContext;
};
