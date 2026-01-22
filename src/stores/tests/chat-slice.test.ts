import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { WPCOM } from 'wpcom/types';
import { LOCAL_STORAGE_CHAT_API_IDS_KEY, LOCAL_STORAGE_CHAT_MESSAGES_KEY } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { chatThunks, generateMessage, chatActions, chatSelectors } from 'src/stores/chat-slice';
import {
	getDispatchedActions,
	resetDispatchedActions,
	testActions,
	testReducer,
} from 'src/stores/tests/utils/test-reducer';
import { wpcomApi } from 'src/stores/wpcom-api';

vi.mock( 'src/lib/get-ipc-api' );
vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
	executeWPCLiInline: vi.fn(),
	getLastSeenVersion: vi.fn().mockResolvedValue( '1.2.3' ),
	saveLastSeenVersion: vi.fn().mockResolvedValue( undefined ),
} );

store.replaceReducer( testReducer );

const mockClientReqPostUsingCallback = vi.fn().mockImplementation( ( params, callback ) => {
	callback(
		null,
		{
			created_at: '2025-02-06 12:00:00',
			id: 123,
			choices: [
				{
					index: 0,
					message: {
						id: 42,
						content: 'Test assistant response',
						role: 'assistant',
					},
				},
			],
		},
		{
			'x-quota-max': '100',
			'x-quota-remaining': '99',
			'x-quota-reset': '2025-05-01T00:00:00Z',
		}
	);
} );

const mockClientUsingCallback = {
	req: { post: mockClientReqPostUsingCallback },
} as unknown as WPCOM;

const mockClientReqPostUsingPromise = vi.fn().mockResolvedValue( {
	data: 'success',
} );

const mockClientUsingPromise = {
	req: { post: mockClientReqPostUsingPromise },
} as unknown as WPCOM;

describe( 'chat-slice', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		localStorage.clear();
		store.dispatch( testActions.resetState() );
		resetDispatchedActions();
	} );

	describe( 'fetchAssistant', () => {
		it( 'should add assistant message to state when fulfilled', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 1', 'user', 0, 100, 42 );

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
				chatApiId: 123,
				message: 'Test assistant response',
				messageApiId: 42,
			} );

			const state = store.getState();
			const messages = state.chat.messagesDict[ instanceId ];

			expect( messages ).toHaveLength( 2 );
			expect( messages[ 0 ] ).toEqual( userMessage );
			expect( messages[ 1 ] ).toMatchObject( {
				content: 'Test assistant response',
				role: 'assistant',
				chatApiId: 123,
				messageApiId: 42,
			} );

			expect( getDispatchedActions() ).toContainEqual(
				wpcomApi.util.invalidateTags( [ 'AssistantQuota' ] )
			);
		} );

		it( 'should update failed message when retrying', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test retry', 'user', 0, 100, 42 );
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
				chatApiId: 123,
				message: 'Test assistant response',
				messageApiId: 42,
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
				chatApiId: 123,
				messageApiId: 42,
			} );
		} );

		it( 'should mark message as failed when rejected', async () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 2', 'user', 0, 100, 42 );

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

			const userMessage = generateMessage( 'Hello test 3', 'user', 0, 100, 42 );
			const assistantMessage = generateMessage( 'Response', 'assistant', 1, 100, 43 );
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
			const userMessage = generateMessage( 'Hello test 4', 'user', 0, 100, 42 );

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
			expect( storedChatIds[ instanceId ] ).toBe( 123 );
		} );

		it( 'should handle invalid JSON in localStorage gracefully', async () => {
			// Silence `console.error` output
			const consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

			localStorage.setItem( LOCAL_STORAGE_CHAT_MESSAGES_KEY, 'invalid json' );
			localStorage.setItem( LOCAL_STORAGE_CHAT_API_IDS_KEY, '{also invalid}' );

			vi.resetModules();
			const { store: freshStore } = await import( 'src/stores' );

			const state = freshStore.getState();
			expect( state.chat.messagesDict ).toEqual( {} );
			expect( state.chat.chatApiIdDict ).toEqual( {} );

			expect( consoleErrorSpy ).toHaveBeenCalledTimes( 1 );
		} );

		afterEach( () => {
			vi.restoreAllMocks();
		} );
	} );

	describe( 'updateMessage', () => {
		it( 'should update existing message block with CLI output', () => {
			const instanceId = 'test-site';
			const userMessage = generateMessage( 'Hello test 5', 'user', 0, 100, 42 );
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
				...generateMessage( 'Hello test 6', 'user', 0, 100, 42 ),
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
				...generateMessage( 'Hello test 7', 'user', 0, 100, 42 ),
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
			phpVersion: '8.3',
			path: '/test/path',
			running: true,
			url: 'http://localhost:8881',
		};

		beforeEach( () => {
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				executeWPCLiInline: vi.fn().mockImplementation( ( { args } ) => {
					if ( args.includes( 'plugin list' ) ) {
						return {
							stdout: JSON.stringify( [ { name: 'woocommerce' }, { name: 'jetpack' } ] ),
							stderr: '',
						};
					}

					if ( args.includes( 'theme list' ) ) {
						return {
							stdout: JSON.stringify( [
								{ name: 'twentytwentyfour' },
								{ name: 'twentytwentythree' },
							] ),
							stderr: '',
						};
					}

					if ( args.includes( 'option get siteurl' ) ) {
						return {
							stdout: 'http://localhost:8881',
							stderr: '',
						};
					}
				} ),
			} );
		} );

		it( 'should update plugin and theme lists when WP CLI succeeds', async () => {
			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [ 'woocommerce', 'jetpack' ],
				themes: [ 'twentytwentyfour', 'twentytwentythree' ],
				siteUrl: 'http://localhost:8881',
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [ 'woocommerce', 'jetpack' ] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [
				'twentytwentyfour',
				'twentytwentythree',
			] );
			expect( state.chat.currentURL ).toBe( 'http://localhost:8881' );
			expect( state.chat.phpVersion ).toBe( '8.3' );
			expect( state.chat.siteName ).toBe( 'Test Site' );
		} );

		it( 'should handle WP CLI errors gracefully', async () => {
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				executeWPCLiInline: vi.fn().mockResolvedValue( {
					stdout: '',
					stderr: 'Error: WP CLI failed',
				} ),
			} );

			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [],
				themes: [],
				siteUrl: '',
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [] );
		} );

		it( 'should handle JSON parsing errors gracefully', async () => {
			vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
				executeWPCLiInline: vi.fn().mockImplementation( ( { args } ) => {
					const isGettingSiteUrl = args.includes( 'option get siteurl' );

					return {
						stdout: isGettingSiteUrl ? '' : 'Invalid JSON',
						stderr: '',
					};
				} ),
			} );

			const result = await store.dispatch( chatThunks.updateFromSite( { site: mockSite } ) );

			expect( result.type ).toBe( 'chat/updateFromSite/fulfilled' );
			expect( result.payload ).toEqual( {
				plugins: [],
				themes: [],
				siteUrl: '',
			} );

			const state = store.getState();
			expect( state.chat.pluginListDict[ mockSite.id ] ).toEqual( [] );
			expect( state.chat.themeListDict[ mockSite.id ] ).toEqual( [] );
			expect( state.chat.currentURL ).toBe( '' );
		} );
	} );
} );
