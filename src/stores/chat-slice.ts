import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import WPCOM from 'wpcom';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

export type Message = {
	id?: number;
	messageApiId?: number;
	content: string;
	role: 'user' | 'assistant';
	chatApiId?: string;
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

type UpdateFromSiteParams = {
	site: SiteDetails;
};

const updateFromSite = createAsyncThunk(
	'chat/updateFromSite',
	async ( { site }: UpdateFromSiteParams ) => {
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
	instanceId: string;
	isRetry?: boolean;
	message: Message;
	siteId: string;
};

type FetchAssistantResponseData = {
	choices: { message: { content: string; id: number } }[];
	id: string;
};

const fetchAssistant = createAsyncThunk(
	'chat/fetchAssistant',
	async ( { client, instanceId, siteId }: FetchAssistantParams, thunkAPI ) => {
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
		const messages = state.chat.messagesDict[ instanceId ];
		const chatApiId = state.chat.chatApiIdDict[ instanceId ];

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
						chat_id: chatApiId,
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
			chatApiId: data?.id,
			maxQuota: headers[ 'x-quota-max' ] || '',
			message: data?.choices?.[ 0 ]?.message?.content,
			messageApiId: data?.choices?.[ 0 ]?.message?.id,
			remainingQuota: headers[ 'x-quota-remaining' ] || '',
		};
	}
);

type SendFeedbackParams = {
	client: WPCOM;
	instanceId: string;
	messageApiId: number;
	ratingValue: number;
};

const sendFeedback = createAsyncThunk(
	'chat/sendFeedback',
	async ( { client, messageApiId, ratingValue, instanceId }: SendFeedbackParams, thunkAPI ) => {
		const state = thunkAPI.getState() as RootState;
		const chatApiId = state.chat.chatApiIdDict[ instanceId ];

		try {
			await client.req.post( {
				path: `/odie/chat/wpcom-studio-chat/${ chatApiId }/${ messageApiId }/feedback`,
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

const EMPTY_MESSAGES: readonly Message[] = Object.freeze( [] );

export interface ChatState {
	currentURL: string;
	pluginListDict: Record< string, string[] >;
	themeListDict: Record< string, string[] >;
	numberOfSites: number;
	phpVersion: string;
	siteName: string;
	themeName: string;
	isBlockTheme: boolean;
	os: string;
	availableEditors: string[];
	wpVersion: string;
	messagesDict: { [ key: string ]: Message[] };
	chatApiIdDict: { [ key: string ]: string | undefined };
	chatInputBySite: { [ key: string ]: string };
	isLoadingDict: Record< string, boolean >;
	promptUsageDict: Record< string, { maxQuota: string; remainingQuota: string } >;
}

const getInitialState = (): ChatState => {
	const storedMessages = localStorage.getItem( LOCAL_STORAGE_CHAT_MESSAGES_KEY );
	const storedChatIds = localStorage.getItem( LOCAL_STORAGE_CHAT_API_IDS_KEY );

	return {
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
		messagesDict: storedMessages ? JSON.parse( storedMessages ) : {},
		chatApiIdDict: storedChatIds ? JSON.parse( storedChatIds ) : {},
		chatInputBySite: {},
		isLoadingDict: {},
		promptUsageDict: {},
	};
};

export function generateMessage(
	content: string,
	role: 'user' | 'assistant',
	newMessageId: number,
	chatApiId?: string,
	messageApiId?: number
): Message {
	return {
		content,
		role,
		id: newMessageId,
		chatApiId,
		createdAt: Date.now(),
		feedbackReceived: false,
		messageApiId,
	};
}

const chatSlice = createSlice( {
	name: 'chat',
	initialState: getInitialState(),
	reducers: {
		updateFromTheme: (
			state,
			action: PayloadAction< NonNullable< SiteDetails[ 'themeDetails' ] > >
		) => {
			state.themeName = action.payload.name;
			state.isBlockTheme = action.payload.isBlockTheme;
		},
		setMessages: (
			state,
			action: PayloadAction< { instanceId: string; messages: Message[] } >
		) => {
			const { instanceId, messages } = action.payload;
			state.messagesDict[ instanceId ] = messages;
		},
		setChatInput: ( state, action: PayloadAction< { siteId: string; input: string } > ) => {
			const { siteId, input } = action.payload;
			state.chatInputBySite[ siteId ] = input;
		},
		updateMessage: (
			state,
			action: PayloadAction< {
				cliOutput?: string;
				cliStatus?: 'success' | 'error';
				cliTime?: string;
				codeBlockContent: string;
				messageId: number;
				instanceId: string;
			} >
		) => {
			const { cliOutput, cliStatus, cliTime, codeBlockContent, messageId, instanceId } =
				action.payload;

			if ( ! state.messagesDict[ instanceId ] ) {
				state.messagesDict[ instanceId ] = [];
			}

			state.messagesDict[ instanceId ].forEach( ( message ) => {
				if ( message.id !== messageId ) {
					return;
				}

				message.blocks = message.blocks || [];

				const relevantBlock = message.blocks.find(
					( block ) => block.codeBlockContent === codeBlockContent
				);

				if ( relevantBlock ) {
					relevantBlock.cliOutput = cliOutput;
					relevantBlock.cliStatus = cliStatus;
					relevantBlock.cliTime = cliTime;
				} else {
					message.blocks.push( { codeBlockContent, cliOutput, cliStatus, cliTime } );
				}
			} );
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( updateFromSite.pending, ( state, action ) => {
				const { site } = action.meta.arg;

				state.currentURL = `http://localhost:${ site.port }`;
				state.phpVersion = site.phpVersion ?? DEFAULT_PHP_VERSION;
				state.siteName = site.name;
			} )
			.addCase( updateFromSite.fulfilled, ( state, action ) => {
				const { plugins, themes } = action.payload;
				const siteId = action.meta.arg.site.id;

				state.pluginListDict[ siteId ] = plugins;
				state.themeListDict[ siteId ] = themes;
			} )
			.addCase( fetchAssistant.pending, ( state, action ) => {
				const { message, instanceId, isRetry } = action.meta.arg;

				state.isLoadingDict[ instanceId ] = true;

				if ( ! state.messagesDict[ instanceId ] ) {
					state.messagesDict[ instanceId ] = [];
				}

				if ( ! isRetry ) {
					state.messagesDict[ instanceId ].push( message );
				} else {
					state.messagesDict[ instanceId ].forEach( ( msg ) => {
						if ( msg.id === message.id ) {
							msg.failedMessage = false;
						}
					} );
				}
			} )
			.addCase( fetchAssistant.rejected, ( state, action ) => {
				const { message, instanceId } = action.meta.arg;

				state.isLoadingDict[ instanceId ] = false;

				state.messagesDict[ instanceId ].forEach( ( msg ) => {
					if ( msg.id === message.id ) {
						msg.failedMessage = true;
					}
				} );
			} )
			.addCase( fetchAssistant.fulfilled, ( state, action ) => {
				const { instanceId } = action.meta.arg;

				state.isLoadingDict[ instanceId ] = false;

				const message = generateMessage(
					action.payload.message,
					'assistant',
					state.messagesDict[ instanceId ].length,
					action.payload.chatApiId,
					action.payload.messageApiId
				);

				state.messagesDict[ instanceId ].push( message );

				if ( message.chatApiId ) {
					state.chatApiIdDict[ instanceId ] = message.chatApiId;
				}

				state.promptUsageDict[ instanceId ] = {
					maxQuota: action.payload.maxQuota,
					remainingQuota: action.payload.remainingQuota,
				};
			} )
			.addCase( sendFeedback.pending, ( state, action ) => {
				const { instanceId, messageApiId } = action.meta.arg;

				if ( ! state.messagesDict[ instanceId ] ) {
					state.messagesDict[ instanceId ] = [];
				}

				state.messagesDict[ instanceId ].forEach( ( message ) => {
					if ( message.messageApiId === messageApiId ) {
						message.feedbackReceived = true;
					}
				} );
			} );
	},
	selectors: {
		selectChatInput: ( state, siteId: string ) => state.chatInputBySite[ siteId ] ?? '',
		selectMessages: ( state, instanceId: string ) =>
			state.messagesDict[ instanceId ] ?? EMPTY_MESSAGES,
		selectChatApiId: ( state, instanceId: string ) => state.chatApiIdDict[ instanceId ],
		selectIsLoading: ( state, instanceId: string ) => state.isLoadingDict[ instanceId ] ?? false,
	},
} );

export const chatActions = chatSlice.actions;
export const chatSelectors = chatSlice.selectors;
export const chatThunks = {
	fetchAssistant,
	sendFeedback,
	updateFromSite,
};
export const { reducer } = chatSlice;
