import WPCOM from 'wpcom';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { chatThunks, generateMessage, chatActions, chatSelectors } from 'src/stores/chat-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';

jest.mock( 'src/lib/get-ipc-api' );

store.replaceReducer( testReducer );

const mockClientReqPostUsingCallback = jest.fn().mockImplementation( ( params, callback ) => {
	callback(
		null,
		{
			id: 'chatcmpl-123',
			choices: [
				{
					message: {
						id: 42,
						content: 'Test assistant response',
					},
				},
			],
		},
		{
			'x-quota-max': '100',
			'x-quota-remaining': '99',
		}
	);
} );

const mockClientUsingCallback = {
	req: { post: mockClientReqPostUsingCallback },
} as unknown as WPCOM;

const mockClientReqPostUsingPromise = jest.fn().mockResolvedValue( {
	data: 'success',
} );

const mockClientUsingPromise = {
	req: { post: mockClientReqPostUsingPromise },
} as unknown as WPCOM;

describe( 'chat-slice', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		localStorage.clear();
		store.dispatch( testActions.resetState() );
	} );

	describe( 'fetchAssistant', () => {
		it( 'should add assistant message to state when fulfilled', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 1', 'user', 0, 'chatcmpl-123', 42 );

			const result = await store.dispatch(
				chatThunks.fetchAssistant( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			expect( result.type ).toBe( 'chat/fetchAssistant/fulfilled' );
			expect( result.payload ).toEqual( {
				chatApiId: 'chatcmpl-123',
				maxQuota: '100',
				message: 'Test assistant response',
				messageApiId: 42,
				remainingQuota: '99',
			} );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages ).toHaveLength( 2 );
			expect( messages[ 0 ] ).toEqual( userMessage );
			expect( messages[ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
				chatApiId: 'chatcmpl-123',
				messageApiId: 42,
			} );

			expect( state.chat.promptUsageDict[ instanceId ] ).toEqual( {
				maxQuota: '100',
				remainingQuota: '99',
			} );
		} );

		it( 'should update failed message when retrying', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test retry', 'user', 0, 'chatcmpl-123', 42 );
			userMessage.failedMessage = true;
			store.dispatch( chatActions.setMessages( { instanceId, messages: [ userMessage ] } ) );

			const result = await store.dispatch(
				chatThunks.fetchAssistant( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
					isRetry: true,
				} )
			);

			expect( result.type ).toBe( 'chat/fetchAssistant/fulfilled' );
			expect( result.payload ).toEqual( {
				chatApiId: 'chatcmpl-123',
				maxQuota: '100',
				message: 'Test assistant response',
				messageApiId: 42,
				remainingQuota: '99',
			} );

			const state = store.getState();
			const messages = chatSelectors.selectMessages( state, instanceId );

			expect( messages ).toHaveLength( 2 );
			expect( messages[ 0 ] ).toMatchObject( {
				...userMessage,
				failedMessage: false,
			} );
			expect( messages[ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
				chatApiId: 'chatcmpl-123',
				messageApiId: 42,
			} );
		} );

		it( 'should mark message as failed when rejected', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 2', 'user', 0, 'chatcmpl-123', 42 );

			mockClientReqPostUsingCallback.mockImplementationOnce( ( params, callback ) => {
				callback( new Error( 'API Error' ), null, {} );
			} );

			const result = await store.dispatch(
				chatThunks.fetchAssistant( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			expect( result.type ).toBe( 'chat/fetchAssistant/rejected' );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages ).toHaveLength( 1 );
			expect( messages[ 0 ] ).toMatchObject( {
				...userMessage,
				failedMessage: true,
			} );
		} );
	} );

	describe( 'sendFeedback', () => {
		it( 'should mark message as feedback received', async () => {
			const instanceId = 'test-site';

			const userMessage = generateMessage( 'Hello test 3', 'user', 0, 'chatcmpl-123', 42 );
			const assistantMessage = generateMessage( 'Response', 'assistant', 1, 'chatcmpl-123', 43 );
			store.dispatch(
				chatActions.setMessages( { instanceId, messages: [ userMessage, assistantMessage ] } )
			);

			const result = await store.dispatch(
				chatThunks.sendFeedback( {
					client: mockClientUsingPromise,
					instanceId,
					messageApiId: 42,
					ratingValue: 1,
				} )
			);

			expect( result.type ).toBe( 'chat/sendFeedback/fulfilled' );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages[ 0 ].feedbackReceived ).toBe( true );
		} );
	} );

	describe( 'localStorage persistence', () => {
		it( 'should persist messagesDict and chatApiIdDict changes to localStorage', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 4', 'user', 0, 'chatcmpl-123', 42 );

			await store.dispatch(
				chatThunks.fetchAssistant( {
					client: mockClientUsingCallback,
					instanceId,
					message: userMessage,
					siteId: instanceId,
				} )
			);

			const storedMessages = JSON.parse(
				localStorage.getItem( LOCAL_STORAGE_CHAT_MESSAGES_KEY ) || '{}'
			);
			expect( storedMessages[ instanceId ] ).toHaveLength( 2 );
			expect( storedMessages[ instanceId ][ 0 ] ).toEqual( userMessage );
			expect( storedMessages[ instanceId ][ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
			} );

			const storedChatIds = JSON.parse(
				localStorage.getItem( LOCAL_STORAGE_CHAT_API_IDS_KEY ) || '{}'
			);
			expect( storedChatIds[ instanceId ] ).toBe( 'chatcmpl-123' );
		} );

		it( 'should handle invalid JSON in localStorage gracefully', () => {
			const consoleErrorSpy = jest.spyOn( console, 'error' );

			localStorage.setItem( LOCAL_STORAGE_CHAT_MESSAGES_KEY, 'invalid json' );
			localStorage.setItem( LOCAL_STORAGE_CHAT_API_IDS_KEY, '{also invalid}' );

			jest.isolateModules( () => {
				const { store } = require( 'src/stores' );

				const state = store.getState();
				expect( state.chat.messagesDict ).toEqual( {} );
				expect( state.chat.chatApiIdDict ).toEqual( {} );
			} );

			expect( consoleErrorSpy ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'updateMessage', () => {
		it( 'should update existing message block with CLI output', () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 5', 'user', 0, 'chatcmpl-123', 42 );
			store.dispatch( chatActions.setMessages( { instanceId, messages: [ userMessage ] } ) );

			store.dispatch(
				chatActions.updateMessage( {
					cliOutput: 'Command output',
					cliStatus: 'success',
					cliTime: 'Completed in 1.00 seconds',
					codeBlockContent: 'wp plugin list',
					messageId: 0,
					instanceId,
				} )
			);

			const messages = chatSelectors.selectMessages( store.getState(), instanceId );

			expect( messages[ 0 ].blocks ).toHaveLength( 1 );
			expect( messages[ 0 ].blocks ).toHaveLength( 1 );
			expect( messages[ 0 ].blocks?.[ 0 ] ).toEqual( {
				cliOutput: 'Command output',
				cliStatus: 'success',
				cliTime: 'Completed in 1.00 seconds',
				codeBlockContent: 'wp plugin list',
			} );
		} );

		it( 'should update existing block when code content matches', () => {
			const instanceId = 'test-site';
			const userMessage = {
				...generateMessage( 'Hello test 6', 'user', 0, 'chatcmpl-123', 42 ),
				blocks: [
					{
						codeBlockContent: 'wp plugin list',
						cliOutput: 'Old output',
						cliStatus: 'error' as const,
						cliTime: 'Completed in 0.50 seconds',
					},
				],
			};
			store.dispatch( chatActions.setMessages( { instanceId, messages: [ userMessage ] } ) );

			store.dispatch(
				chatActions.updateMessage( {
					cliOutput: 'New output',
					cliStatus: 'success',
					cliTime: 'Completed in 1.00 seconds',
					codeBlockContent: 'wp plugin list',
					messageId: 0,
					instanceId,
				} )
			);

			const messages = chatSelectors.selectMessages( store.getState(), instanceId );

			expect( messages[ 0 ].blocks ).toHaveLength( 1 );
			expect( messages[ 0 ].blocks?.[ 0 ] ).toEqual( {
				cliOutput: 'New output',
				cliStatus: 'success',
				cliTime: 'Completed in 1.00 seconds',
				codeBlockContent: 'wp plugin list',
			} );
		} );

		it( 'should add new block when code content is different', () => {
			const instanceId = 'test-site';
			const userMessage = {
				...generateMessage( 'Hello test 7', 'user', 0, 'chatcmpl-123', 42 ),
				blocks: [
					{
						codeBlockContent: 'wp plugin list',
						cliOutput: 'First output',
						cliStatus: 'success' as const,
						cliTime: 'Completed in 0.50 seconds',
					},
				],
			};
			store.dispatch( chatActions.setMessages( { instanceId, messages: [ userMessage ] } ) );

			store.dispatch(
				chatActions.updateMessage( {
					cliOutput: 'Second output',
					cliStatus: 'success',
					cliTime: 'Completed in 1.00 seconds',
					codeBlockContent: 'wp theme list',
					messageId: 0,
					instanceId,
				} )
			);

			const messages = chatSelectors.selectMessages( store.getState(), instanceId );

			expect( messages[ 0 ].blocks ).toHaveLength( 2 );
			expect( messages[ 0 ].blocks?.[ 0 ] ).toEqual( {
				codeBlockContent: 'wp plugin list',
				cliOutput: 'First output',
				cliStatus: 'success',
				cliTime: 'Completed in 0.50 seconds',
			} );
			expect( messages[ 0 ].blocks?.[ 1 ] ).toEqual( {
				codeBlockContent: 'wp theme list',
				cliOutput: 'Second output',
				cliStatus: 'success',
				cliTime: 'Completed in 1.00 seconds',
			} );
		} );
	} );

	describe( 'updateFromSite', () => {
		const mockSite: SiteDetails = {
			id: 'test-site',
			name: 'Test Site',
			port: 8881,
			phpVersion: '8.0',
			path: '/test/path',
			running: true,
			url: 'http://localhost:8881',
		};

		beforeEach( () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( {
					stdout: JSON.stringify( [ { name: 'woocommerce' }, { name: 'jetpack' } ] ),
					stderr: '',
				} ),
			} );
		} );

		it( 'should update plugin and theme lists when WP CLI succeeds', async () => {
			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [ 'woocommerce', 'jetpack' ],
				themes: [ 'woocommerce', 'jetpack' ],
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [ 'woocommerce', 'jetpack' ] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [ 'woocommerce', 'jetpack' ] );
			expect( state.chat.currentURL ).toBe( 'http://localhost:8881' );
			expect( state.chat.phpVersion ).toBe( '8.0' );
			expect( state.chat.siteName ).toBe( 'Test Site' );
		} );

		it( 'should handle WP CLI errors gracefully', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( {
					stdout: '',
					stderr: 'Error: WP CLI failed',
				} ),
			} );

			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [],
				themes: [],
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [] );
		} );

		it( 'should handle JSON parsing errors gracefully', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( {
					stdout: 'Invalid JSON',
					stderr: '',
				} ),
			} );

			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [],
				themes: [],
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [] );
		} );
	} );
} );
