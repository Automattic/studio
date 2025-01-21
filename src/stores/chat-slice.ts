import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import WPCOM from 'wpcom';
import { CHAT_ID_STORE_KEY, CHAT_MESSAGES_STORE_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';
import { RootState } from '.';

export interface ChatState {
	currentURL: string;
	pluginList: string[];
	themeList: string[];
	numberOfSites: number;
	phpVersion: string;
	siteName: string;
	isSiteLoadedDict: Record< string, boolean >;
	themeName: string;
	isBlockTheme: boolean;
	os: string;
	availableEditors: string[];
	wpVersion: string;
	messagesDict: { [ key: string ]: Message[] };
	chatIdDict: { [ key: string ]: string | undefined };
	chatInputBySite: { [ key: string ]: string };
	isLoadingDict: Record< string, boolean >;
}

export type Message = {
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

const parseWpCliOutput = ( stdout: string ): string[] => {
	try {
		const data = JSON.parse( stdout );
		return data?.map( ( item: { name: string } ) => item.name ) || [];
	} catch ( error ) {
		Sentry.captureException( error, { extra: { stdout } } );
		return [];
	}
};

async function fetchPluginList( siteId: string ): Promise< string[] > {
	const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
		siteId,
		args: 'plugin list --format=json --status=active',
		skipPluginsAndThemes: true,
	} );

	return stderr ? [] : parseWpCliOutput( stdout );
}

async function fetchThemeList( siteId: string ): Promise< string[] > {
	const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
		siteId,
		args: 'theme list --format=json',
		skipPluginsAndThemes: true,
	} );

	return stderr ? [] : parseWpCliOutput( stdout );
}

export const updateFromSite = createAsyncThunk(
	'chat/updateFromSite',
	async ( site: SiteDetails ) => {
		const [ plugins, themes ] = await Promise.all( [
			fetchPluginList( site.id ),
			fetchThemeList( site.id ),
		] );

		return {
			plugins,
			themes,
		};
	}
);

type FetchAssistantParams = {
	client: WPCOM;
	chatId: string | undefined;
	isRetry?: boolean;
	message: Message;
	siteId: string;
};

type FetchAssistantResponseData = {
	choices: { message: { content: string; id: number } }[];
	id: string;
};

export const fetchAssistantThunk = createAsyncThunk(
	'chat/fetchAssistant',
	async ( { client, chatId, message, siteId }: FetchAssistantParams, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const context = {
			current_url: state.chat.currentURL,
			number_of_sites: state.chat.numberOfSites,
			wp_version: state.chat.wpVersion,
			php_version: state.chat.phpVersion,
			plugins: state.chat.pluginList,
			themes: state.chat.themeList,
			current_theme: state.chat.themeName,
			is_block_theme: state.chat.isBlockTheme,
			ide: state.chat.availableEditors,
			site_name: state.chat.siteName,
			os: state.chat.os,
		};
		const messages = state.chat.messagesDict[ siteId ].concat( message );

		const { data, headers } = await new Promise< {
			data: FetchAssistantResponseData;
			headers: Record< string, string >;
		} >( ( resolve, reject ) => {
			client.req.post< FetchAssistantResponseData >(
				{
					path: '/studio-app/ai-assistant/chat',
					apiNamespace: 'wpcom/v2',
					body: {
						messages,
						chat_id: chatId,
						context,
					},
				},
				( error, data, headers ) => {
					if ( error ) {
						return reject( error );
					}
					return resolve( { data, headers } );
				}
			);
		} );

		return {
			chatId: data?.id,
			message: data?.choices?.[ 0 ]?.message?.content,
			messageApiId: data?.choices?.[ 0 ]?.message?.id,
		};
	}
);

const storedMessages = localStorage.getItem( CHAT_MESSAGES_STORE_KEY );
const storedChatIds = localStorage.getItem( CHAT_ID_STORE_KEY );

const initialState: ChatState = {
	currentURL: '',
	pluginList: [],
	themeList: [],
	numberOfSites: 0,
	themeName: '',
	wpVersion: '',
	phpVersion: DEFAULT_PHP_VERSION,
	isBlockTheme: false,
	os: window.appGlobals?.platform || '',
	availableEditors: [],
	siteName: '',
	isSiteLoadedDict: {},
	messagesDict: storedMessages ? JSON.parse( storedMessages ) : {},
	chatIdDict: storedChatIds ? JSON.parse( storedChatIds ) : {},
	chatInputBySite: {},
	isLoadingDict: {},
};

export function generateMessage(
	content: string,
	role: 'user' | 'assistant',
	newMessageId: number,
	chatId?: string,
	messageApiId?: number
): Message {
	return {
		content,
		role,
		id: newMessageId,
		chatId,
		createdAt: Date.now(),
		feedbackReceived: false,
		messageApiId,
	};
}

const chatSlice = createSlice( {
	name: 'chat',
	initialState,
	reducers: {
		updateFromTheme: (
			state,
			action: PayloadAction< { name: string; isBlockTheme: boolean } >
		) => {
			const { name, isBlockTheme } = action.payload;
			state.themeName = name;
			state.isBlockTheme = isBlockTheme;
		},
		setMessages: ( state, action: PayloadAction< { siteId: string; messages: Message[] } > ) => {
			const { siteId, messages } = action.payload;
			state.messagesDict[ siteId ] = messages;

			const newDict = { ...state.messagesDict, [ siteId ]: messages };
			localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( newDict ) );
		},
		setChatId: ( state, action: PayloadAction< { siteId: string; chatId?: string } > ) => {
			const { siteId, chatId } = action.payload;
			state.chatIdDict[ siteId ] = chatId;

			const newChatDict = { ...state.chatIdDict, [ siteId ]: chatId };
			localStorage.setItem( CHAT_ID_STORE_KEY, JSON.stringify( newChatDict ) );
		},
		setChatInput: ( state, action: PayloadAction< { siteId: string; input: string } > ) => {
			const { siteId, input } = action.payload;
			state.chatInputBySite[ siteId ] = input;
		},
		setIsLoading: ( state, action: PayloadAction< { siteId: string; isLoading: boolean } > ) => {
			const { siteId, isLoading } = action.payload;
			state.isLoadingDict[ siteId ] = isLoading;
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( updateFromSite.pending, ( state, action ) => {
				const site = action.meta.arg;

				state.currentURL = `http://localhost:${ site.port }`;
				state.phpVersion = site.phpVersion ?? DEFAULT_PHP_VERSION;
				state.siteName = site.name;
				state.isSiteLoadedDict[ site.id ] = true;
			} )
			.addCase( updateFromSite.fulfilled, ( state, action ) => {
				const { plugins, themes } = action.payload;

				state.pluginList = plugins;
				state.themeList = themes;
			} )
			.addCase( updateFromSite.rejected, ( state, action ) => {
				state.isSiteLoadedDict[ action.meta.arg.id ] = false;
			} )
			.addCase( fetchAssistantThunk.pending, ( state, action ) => {
				state.isLoadingDict[ action.meta.arg.siteId ] = true;

				if ( ! state.messagesDict[ action.meta.arg.siteId ] ) {
					state.messagesDict[ action.meta.arg.siteId ] = [];
				}

				const messages = state.messagesDict[ action.meta.arg.siteId ];

				if ( action.meta.arg.isRetry ) {
					messages.forEach( ( message ) => {
						if ( message.id === action.meta.arg.message.id ) {
							message.failedMessage = false;
						}
					} );
				}

				messages.push( action.meta.arg.message );
			} )
			.addCase( fetchAssistantThunk.rejected, ( state, action ) => {
				state.isLoadingDict[ action.meta.arg.siteId ] = false;
				const messages = state.messagesDict[ action.meta.arg.siteId ];

				messages.forEach( ( message ) => {
					if ( message.id === action.meta.arg.message.id ) {
						message.failedMessage = true;
					}
				} );
			} )
			.addCase( fetchAssistantThunk.fulfilled, ( state, action ) => {
				state.isLoadingDict[ action.meta.arg.siteId ] = false;

				const messages = state.messagesDict[ action.meta.arg.siteId ];
				const message = generateMessage(
					action.payload.message,
					'assistant',
					messages.length,
					action.meta.arg.chatId,
					action.payload.messageApiId
				);

				messages.push( message );
			} );
	},
	selectors: {
		selectChatInput: ( state, siteId: string ) => state.chatInputBySite[ siteId ] ?? '',
		selectMessages: ( state, siteId: string ) => state.messagesDict[ siteId ] ?? [],
		selectChatId: ( state, siteId: string ) => state.chatIdDict[ siteId ],
		selectIsLoading: ( state, siteId: string ) => state.isLoadingDict[ siteId ] ?? false,
	},
} );

export const { updateFromTheme, setMessages, setChatId, setChatInput, setIsLoading } =
	chatSlice.actions;

export const { selectChatInput, selectMessages, selectChatId, selectIsLoading } =
	chatSlice.selectors;

export default chatSlice.reducer;
