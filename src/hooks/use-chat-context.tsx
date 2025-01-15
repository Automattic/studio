import * as Sentry from '@sentry/electron/renderer';
import React, {
	createContext,
	useContext,
	useRef,
	useState,
	useEffect,
	useCallback,
	ReactNode,
} from 'react';
import { DEFAULT_PHP_VERSION } from '../../vendor/wp-now/src/constants';
import { CHAT_MESSAGES_STORE_KEY } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { useCheckInstalledApps } from './use-check-installed-apps';
import { useGetWpVersion } from './use-get-wp-version';
import { useSiteDetails } from './use-site-details';
import { useThemeDetails } from './use-theme-details';
import { useWindowListener } from './use-window-listener';

type Message = {
	id?: number;
	messageApiId?: number;
	content: string;
	role: 'user' | 'assistant';
	chatId?: string;
	blocks?: {
		cliOutput?: string;
		cliStatus?: 'success' | 'error';
		cliTime?: string;
		codeBlockContent?: string;
	}[];
	createdAt: number;
	failedMessage?: boolean;
	feedbackReceived?: boolean;
};

type MessageDict = { [ key: string ]: Message[] };
type ChatIdDict = { [ key: string ]: string | undefined };

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
	getChatInput: ( siteId: string ) => string;
	saveChatInput: ( input: string, siteId: string ) => void;
	messagesDict: MessageDict;
	setMessagesDict: React.Dispatch< React.SetStateAction< MessageDict > >;
	chatIdDict: ChatIdDict;
	setChatIdDict: React.Dispatch< React.SetStateAction< ChatIdDict > >;
	lastMessageIdDictRef: React.MutableRefObject< { [ key: string ]: number } >;
	isLoadingDict: Record< string, boolean >;
	setIsLoadingDict: React.Dispatch< React.SetStateAction< Record< string, boolean > > >;
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
	getChatInput: () => '',
	saveChatInput: () => {
		// noop
	},
	messagesDict: {},
	setMessagesDict: () => {
		// noop
	},
	chatIdDict: {},
	setChatIdDict: () => {
		// noop
	},
	lastMessageIdDictRef: { current: {} },
	isLoadingDict: {},
	setIsLoadingDict: () => {
		// noop
	},
} );

const parseWpCliOutput = ( stdout: string, defaultValue: string[] ): string[] => {
	try {
		const data = JSON.parse( stdout );
		return data?.map( ( item: { name: string } ) => item.name ) || [];
	} catch ( error ) {
		Sentry.captureException( error, {
			extra: { stdout },
		} );
	}
	return defaultValue;
};

export const CHAT_ID_STORE_KEY = 'ai_chat_ids';

type ChatProviderProps = {
	children: ReactNode;
};

export const ChatProvider: React.FC< ChatProviderProps > = ( { children } ) => {
	const initialLoad = useRef< Record< string, boolean > >( {} );
	const inputBySite = useRef< Record< string, string > >( {} );
	const lastMessageIdDictRef = useRef< { [ key: string ]: number } >( {} );

	const installedApps = useCheckInstalledApps();
	const { data: sites, loadingSites, selectedSite } = useSiteDetails();
	const wpVersion = useGetWpVersion( selectedSite || ( {} as SiteDetails ) );
	const [ pluginsList, setPluginsList ] = useState< Record< string, string[] > >( {} );
	const [ themesList, setThemesList ] = useState< Record< string, string[] > >( {} );

	const [ messagesDict, setMessagesDict ] = useState< MessageDict >( {} );
	const [ chatIdDict, setChatIdDict ] = useState< ChatIdDict >( {} );
	const [ isLoadingDict, setIsLoadingDict ] = useState< Record< string, boolean > >( {} );

	const numberOfSites = sites?.length || 0;
	const sitePort = selectedSite?.port || '';

	const { selectedThemeDetails: themeDetails } = useThemeDetails();

	const availableEditors = Object.keys( installedApps ).filter( ( app ) => {
		return installedApps[ app as keyof InstalledApps ];
	} );

	const getChatInput = useCallback( ( siteId: string ) => {
		return inputBySite.current[ siteId ] ?? '';
	}, [] );

	const saveChatInput = useCallback( ( input: string, siteId: string ) => {
		inputBySite.current[ siteId ] = input;
	}, [] );

	const fetchPluginList = useCallback( async ( siteId: string ) => {
		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			siteId,
			args: 'plugin list --format=json --status=active',
			skipPluginsAndThemes: true,
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
			skipPluginsAndThemes: true,
		} );
		if ( stderr ) {
			return [];
		}
		return parseWpCliOutput( stdout, [] );
	}, [] );

	useEffect( () => {
		const storedMessages = localStorage.getItem( CHAT_MESSAGES_STORE_KEY );
		if ( storedMessages ) {
			const parsedMessages: MessageDict = JSON.parse( storedMessages );
			setMessagesDict( parsedMessages );
			Object.entries( parsedMessages ).forEach( ( [ key, messages ] ) => {
				lastMessageIdDictRef.current[ key ] = messages.length - 1;
			} );
		}
	}, [] );

	useEffect( () => {
		const storedChatIds = localStorage.getItem( CHAT_ID_STORE_KEY );
		if ( storedChatIds ) {
			setChatIdDict( JSON.parse( storedChatIds ) );
		}
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

	return (
		<ChatContext.Provider
			value={ {
				availableEditors,
				chatIdDict,
				currentURL: `http://localhost:${ sitePort }`,
				getChatInput,
				isBlockTheme: themeDetails?.isBlockTheme,
				messagesDict,
				lastMessageIdDictRef,
				numberOfSites,
				os: window.appGlobals?.platform,
				phpVersion: selectedSite?.phpVersion ?? DEFAULT_PHP_VERSION,
				pluginList: selectedSite?.id ? pluginsList[ selectedSite.id ] || [] : [],
				saveChatInput,
				setChatIdDict,
				setMessagesDict,
				siteName: selectedSite?.name,
				themeList: selectedSite?.id ? themesList[ selectedSite.id ] || [] : [],
				themeName: themeDetails?.name,
				wpVersion,
				isLoadingDict,
				setIsLoadingDict,
			} }
		>
			{ children }
		</ChatContext.Provider>
	);
};

export const useChatContext = (): ChatContextType => {
	const context = useContext( ChatContext );
	if ( ! context ) {
		throw new Error( 'useChatContext must be used within a ChatProvider' );
	}
	return context;
};
