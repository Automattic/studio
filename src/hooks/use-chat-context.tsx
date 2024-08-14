import React, {
	createContext,
	useContext,
	useMemo,
	useRef,
	useState,
	useEffect,
	useCallback,
	ReactNode,
} from 'react';
import { DEFAULT_PHP_VERSION } from '../../vendor/wp-now/src/constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { useCheckInstalledApps } from './use-check-installed-apps';
import { useGetWpVersion } from './use-get-wp-version';
import { useSiteDetails } from './use-site-details';
import { useThemeDetails } from './use-theme-details';
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
	os: string;
	availableEditors: string[];
	siteName?: string;
}
const ChatContext = createContext< ChatContextType >( {
	currentURL: '',
	pluginList: [],
	themeList: [],
	numberOfSites: 0,
	themeName: '',
	phpVersion: '',
	isBlockTheme: false,
	wpVersion: '',
	availableEditors: [] as string[],
	os: '',
	siteName: '',
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
	const initialLoad = useRef< Record< string, boolean > >( {} );
	const installedApps = useCheckInstalledApps();
	const { data: sites, loadingSites, selectedSite } = useSiteDetails();
	const wpVersion = useGetWpVersion( selectedSite || ( {} as SiteDetails ) );
	const [ pluginsList, setPluginsList ] = useState< Record< string, string[] > >( {} );
	const [ themesList, setThemesList ] = useState< Record< string, string[] > >( {} );
	const numberOfSites = sites?.length || 0;
	const sitePort = selectedSite?.port || '';

	const { selectedThemeDetails: themeDetails } = useThemeDetails();

	const availableEditors = Object.keys( installedApps ).filter( ( app ) => {
		return installedApps[ app as keyof InstalledApps ];
	} );

	const fetchPluginList = useCallback( async ( siteId: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			siteId,
			args: 'plugin list --format=json --status=active',
		} );
		if ( stderr ) {
			return [];
		}
		return parseWpCliOutput( stdout, [] );
	}, [] );

	const fetchThemeList = useCallback( async ( siteId: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			siteId,
			args: 'theme list --format=json',
		} );
		if ( stderr ) {
			return [];
		}
		return parseWpCliOutput( stdout, [] );
	}, [] );

	useEffect( () => {
		const run = async () => {
			const siteId = selectedSite?.id;
			if ( ! siteId || selectedSite.isAddingSite ) {
				return;
			}
			initialLoad.current[ siteId ] = true;
			Promise.all( [ fetchPluginList( siteId ), fetchThemeList( siteId ) ] )
				.then( ( result ) => {
					setPluginsList( ( prev ) => ( { ...prev, [ siteId ]: result[ 0 ] } ) );
					setThemesList( ( prev ) => ( { ...prev, [ siteId ]: result[ 1 ] } ) );
				} )
				.catch( ( _error ) => {
					initialLoad.current[ siteId ] = false;
				} );
		};
		if (
			selectedSite &&
			! loadingSites &&
			! initialLoad.current[ selectedSite.id ] &&
			! pluginsList[ selectedSite.id ] &&
			! themesList[ selectedSite.id ]
		) {
			run();
		}
	}, [
		fetchPluginList,
		fetchThemeList,
		loadingSites,
		pluginsList,
		selectedSite,
		sites,
		themesList,
	] );

	useWindowListener( 'focus', async () => {
		// When the window is focused, we need to kick off a request to refetch the theme details, if server is running.
		if ( ! selectedSite?.id || selectedSite.running === false || selectedSite?.isAddingSite ) {
			return;
		}
		const plugins = await fetchPluginList( selectedSite.id );
		const themes = await fetchThemeList( selectedSite.id );
		setPluginsList( ( prev ) => ( { ...prev, [ selectedSite.id ]: plugins } ) );
		setThemesList( ( prev ) => ( { ...prev, [ selectedSite.id ]: themes } ) );
	} );

	const contextValue = useMemo( () => {
		return {
			numberOfSites,
			themeList: selectedSite?.id ? themesList[ selectedSite.id ] || [] : [],
			pluginList: selectedSite?.id ? pluginsList[ selectedSite.id ] || [] : [],
			wpVersion,
			phpVersion: selectedSite?.phpVersion ?? DEFAULT_PHP_VERSION,
			currentURL: `http://localhost:${ sitePort }`,
			themeName: themeDetails?.name,
			isBlockTheme: themeDetails?.isBlockTheme,
			availableEditors,
			siteName: selectedSite?.name,
			os: window.appGlobals.platform,
		};
	}, [
		numberOfSites,
		selectedSite?.id,
		selectedSite?.phpVersion,
		selectedSite?.name,
		themesList,
		pluginsList,
		wpVersion,
		sitePort,
		themeDetails?.name,
		themeDetails?.isBlockTheme,
		availableEditors,
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
