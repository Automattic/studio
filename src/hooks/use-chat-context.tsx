import React, {
	createContext,
	useContext,
	useMemo,
	useState,
	useEffect,
	useCallback,
	ReactNode,
} from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useGetWpVersion } from './use-get-wp-version';
import { useSiteDetails } from './use-site-details';
import { useWindowListener } from './use-window-listener';

export interface ChatContextType {
	currentURL: string;
	pluginList: string[];
	themeList: string[];
	numberOfSites: number;
	themeName?: string;
	wpVersion: string;
	phpVersion: string;
	isBlockTheme?: boolean;
}
const ChatContext = createContext< ChatContextType >( {
	currentURL: '',
	pluginList: [] as string[],
	themeList: [] as string[],
	numberOfSites: 0,
	themeName: '',
	phpVersion: '',
	isBlockTheme: false,
	wpVersion: '',
} );

interface ChatProviderProps {
	children: ReactNode;
}

const parseWpCliOutput = ( stdout: string, defaultValue: string[] ): string[] => {
	try {
		const data = JSON.parse( stdout );
		return data?.map( ( item: { name: string } ) => item.name ) || [];
	} catch ( error ) {
		console.error( error );
	}
	return defaultValue;
};

export const ChatProvider: React.FC< ChatProviderProps > = ( { children } ) => {
	const [ initialLoad, setInitialLoad ] = useState< Record< string, boolean > >( {} );
	const { data: sites, loadingSites, selectedSite } = useSiteDetails();
	const wpVersion = useGetWpVersion( selectedSite || ( {} as SiteDetails ) );
	const [ pluginsList, setPluginsList ] = useState< Record< string, string[] > >( {} );
	const [ themesList, setThemesList ] = useState< Record< string, string[] > >( {} );
	const numberOfSites = sites?.length || 0;
	const sitePath = selectedSite?.path || '';
	const sitePort = selectedSite?.port || '';
	const siteThemeDetails = selectedSite?.themeDetails;

	const fetchPluginList = useCallback( async ( path: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			projectPath: path,
			args: [ 'plugin', 'list', '--format=json', '--status=active' ],
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			forcedWPNowOptions: { mode: 'index' as any },
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			forcedWPNowOptions: { mode: 'index' as any },
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
			const result = await Promise.all( [
				fetchPluginList( sitePath ),
				fetchThemeList( sitePath ),
			] );
			if ( isCurrent && selectedSite?.id ) {
				setInitialLoad( ( prev ) => ( { ...prev, [ selectedSite.id ]: true } ) );
				setPluginsList( ( prev ) => ( { ...prev, [ selectedSite.id ]: result[ 0 ] } ) );
				setThemesList( ( prev ) => ( { ...prev, [ selectedSite.id ]: result[ 1 ] } ) );
			}
		};
		if (
			selectedSite &&
			! loadingSites &&
			! initialLoad[ selectedSite.id ] &&
			isCurrent &&
			! pluginsList[ selectedSite.id ] &&
			! themesList[ selectedSite.id ]
		) {
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
		sitePath,
	] );

	useWindowListener( 'focus', async () => {
		// When the window is focused, we need to kick off a request to refetch the theme details, if server is running.
		if ( ! selectedSite?.id || selectedSite.running === false ) {
			return;
		}
		const plugins = await fetchPluginList( sitePath );
		const themes = await fetchThemeList( sitePath );
		setPluginsList( ( prev ) => ( { ...prev, [ selectedSite.id ]: plugins } ) );
		setThemesList( ( prev ) => ( { ...prev, [ selectedSite.id ]: themes } ) );
	} );

	const contextValue = useMemo( () => {
		return {
			numberOfSites,
			themeList: selectedSite?.id ? themesList[ selectedSite.id ] || [] : [],
			pluginList: selectedSite?.id ? pluginsList[ selectedSite.id ] || [] : [],
			wpVersion,
			// This will be fetched by a hook when php selection is merged
			phpVersion: '8.0',
			currentURL: `http://localhost:${ sitePort }`,
			themeName: siteThemeDetails?.name,
			isBlockTheme: siteThemeDetails?.isBlockTheme,
		};
	}, [
		numberOfSites,
		themesList,
		selectedSite?.id,
		pluginsList,
		wpVersion,
		sitePort,
		siteThemeDetails?.name,
		siteThemeDetails?.isBlockTheme,
	] );

	return <ChatContext.Provider value={ contextValue }>{ children }</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextType => {
	const context = useContext( ChatContext );
	if ( ! context ) {
		throw new Error( 'useChatContext must be used within a ChatProvider' );
	}
	return context;
};
