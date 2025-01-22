import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import WPCOM from 'wpcom';
import { CHAT_ID_STORE_KEY, CHAT_MESSAGES_STORE_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

export interface ChatState {
	currentURL: string;
	pluginListDict: Record< string, string[] >;
	themeListDict: Record< string, string[] >;
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
	async ( { client, message, siteId }: FetchAssistantParams, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const context = {
			current_url: state.chat.currentURL,
			number_of_sites: state.chat.numberOfSites,
			wp_version: state.chat.wpVersion,
			php_version: state.chat.phpVersion,
			plugins: state.chat.pluginListDict[ siteId ] || [],
			themes: state.chat.themeListDict[ siteId ] || [],
			current_theme: state.chat.themeName,
			is_block_theme: state.chat.isBlockTheme,
			ide: state.chat.availableEditors,
			site_name: state.chat.siteName,
			os: state.chat.os,
		};
		const messages = state.chat.messagesDict[ siteId ].concat( message );
		const chatId = state.chat.chatIdDict[ siteId ];

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

		// TODO: Store the quota headers

		return {
			chatId: data?.id,
			message: data?.choices?.[ 0 ]?.message?.content,
			messageApiId: data?.choices?.[ 0 ]?.message?.id,
		};
	}
);

type SendFeedbackParams = {
	client: WPCOM;
	messageApiId: number;
	ratingValue: number;
	siteId: string;
};

export const sendFeedbackThunk = createAsyncThunk(
	'chat/sendFeedback',
	async ( { client, messageApiId, ratingValue, siteId }: SendFeedbackParams, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const chatId = state.chat.chatIdDict[ siteId ];

		try {
			await client.req.post( {
				path: `/odie/chat/wpcom-studio-chat/${ chatId }/${ messageApiId }/feedback`,
				apiNamespace: 'wpcom/v2',
				body: {
					rating_value: ratingValue,
				},
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}
);

const storedMessages = localStorage.getItem( CHAT_MESSAGES_STORE_KEY );
const storedChatIds = localStorage.getItem( CHAT_ID_STORE_KEY );
const EMPTY_MESSAGES: readonly Message[] = Object.freeze( [] );

const initialState: ChatState = {
	currentURL: '',
	pluginListDict: {},
	themeListDict: {},
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
			action: PayloadAction< NonNullable< SiteDetails[ 'themeDetails' ] > >
		) => {
			state.themeName = action.payload.name;
			state.isBlockTheme = action.payload.isBlockTheme;
		},
		setMessages: ( state, action: PayloadAction< { siteId: string; messages: Message[] } > ) => {
			const { siteId, messages } = action.payload;
			state.messagesDict[ siteId ] = messages;
		},
		setChatId: ( state, action: PayloadAction< { siteId: string; chatId?: string } > ) => {
			const { siteId, chatId } = action.payload;
			state.chatIdDict[ siteId ] = chatId;
			localStorage.setItem( CHAT_ID_STORE_KEY, JSON.stringify( state.chatIdDict ) );
		},
		setChatInput: ( state, action: PayloadAction< { siteId: string; input: string } > ) => {
			const { siteId, input } = action.payload;
			state.chatInputBySite[ siteId ] = input;
		},
		setIsLoading: ( state, action: PayloadAction< { siteId: string; isLoading: boolean } > ) => {
			const { siteId, isLoading } = action.payload;
			state.isLoadingDict[ siteId ] = isLoading;
		},
		updateMessage: (
			state,
			action: PayloadAction< {
				cliOutput?: string;
				cliStatus?: 'success' | 'error';
				cliTime?: string;
				codeBlockContent: string;
				messageId: number;
				siteId: string;
			} >
		) => {
			const { cliOutput, cliStatus, cliTime, codeBlockContent, messageId, siteId } = action.payload;

			state.messagesDict[ siteId ].forEach( ( message ) => {
				if ( message.id === messageId ) {
					message.blocks?.forEach( ( block ) => {
						if ( block.codeBlockContent === codeBlockContent ) {
							block.cliOutput = cliOutput;
							block.cliStatus = cliStatus;
							block.cliTime = cliTime;
						}
					} );
				}
			} );
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
				const siteId = action.meta.arg.id;

				state.pluginListDict[ siteId ] = plugins;
				state.themeListDict[ siteId ] = themes;
			} )
			.addCase( updateFromSite.rejected, ( state, action ) => {
				state.isSiteLoadedDict[ action.meta.arg.id ] = false;
			} )
			.addCase( fetchAssistantThunk.pending, ( state, action ) => {
				const { message, siteId, isRetry } = action.meta.arg;

				state.isLoadingDict[ siteId ] = true;

				if ( ! state.messagesDict[ siteId ] ) {
					state.messagesDict[ siteId ] = [];
				}

				if ( isRetry ) {
					state.messagesDict[ siteId ].forEach( ( msg ) => {
						if ( msg.id === message.id ) {
							msg.failedMessage = false;
						}
					} );
				}

				state.messagesDict[ siteId ].push( message );
			} )
			.addCase( fetchAssistantThunk.rejected, ( state, action ) => {
				const { message, siteId } = action.meta.arg;

				state.isLoadingDict[ siteId ] = false;
				const messages = state.messagesDict[ siteId ];

				messages.forEach( ( msg ) => {
					if ( msg.id === message.id ) {
						msg.failedMessage = true;
					}
				} );
			} )
			.addCase( fetchAssistantThunk.fulfilled, ( state, action ) => {
				const { siteId } = action.meta.arg;

				state.isLoadingDict[ siteId ] = false;

				const messages = state.messagesDict[ siteId ];
				const chatId = state.chatIdDict[ siteId ];

				const message = generateMessage(
					action.payload.message,
					'assistant',
					messages.length,
					chatId,
					action.payload.messageApiId
				);

				messages.push( message );

				if ( message.chatId ) {
					state.chatInputBySite[ siteId ] = message.chatId;
				}
			} )
			.addCase( sendFeedbackThunk.pending, ( state, action ) => {
				const { siteId, messageApiId } = action.meta.arg;

				state.messagesDict[ siteId ].forEach( ( message ) => {
					if ( message.messageApiId === messageApiId ) {
						message.feedbackReceived = true;
					}
				} );
			} );
	},
	selectors: {
		selectChatInput: ( state, siteId: string ) => state.chatInputBySite[ siteId ] ?? '',
		selectMessages: ( state, siteId: string ) => state.messagesDict[ siteId ] ?? EMPTY_MESSAGES,
		selectChatId: ( state, siteId: string ) => state.chatIdDict[ siteId ],
		selectIsLoading: ( state, siteId: string ) => state.isLoadingDict[ siteId ] ?? false,
	},
} );

export const {
	updateFromTheme,
	setMessages,
	setChatId,
	setChatInput,
	setIsLoading,
	updateMessage,
} = chatSlice.actions;

export const { selectChatInput, selectMessages, selectChatId, selectIsLoading } =
	chatSlice.selectors;

export default chatSlice.reducer;
