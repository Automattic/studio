import { UnknownAction } from '@reduxjs/toolkit';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import nock from 'nock';
import { StrictMode } from 'react';
import { Provider } from 'react-redux';
import { Dispatch } from 'redux';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from 'src/components/auth-provider';
import {
	ContentTabAssistant,
	MIMIC_CONVERSATION_DELAY,
	WpcomSiteAssistant,
	clearWpcomSiteAssistantStateCacheForTests,
} from 'src/components/content-tab-assistant';
import {
	LOCAL_STORAGE_CHAT_MESSAGES_KEY,
	LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY,
	CLEAR_HISTORY_REMINDER_TIME,
} from 'src/constants';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useOffline } from 'src/hooks/use-offline';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { generateMessage, chatActions } from 'src/stores/chat-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { useGetAssistantQuota, useGetWelcomeMessages } from 'src/stores/wpcom-api';
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

store.replaceReducer( testReducer );

vi.mock( 'src/hooks/use-offline' );
vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-get-wp-version' );

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: () => ( {
		locale: vi.fn,
	} ),
} ) );

vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetWelcomeMessages: vi.fn(),
	useGetAssistantQuota: vi.fn(),
	wpcomApi: {
		reducerPath: 'wpcomApi',
		reducer: () => ( {} ),
		middleware: () => ( next: Dispatch ) => ( action: UnknownAction ) => next( action ),
		injectEndpoints: vi.fn().mockReturnValue( {
			useGetLatestRewindIdQuery: vi.fn(),
		} ),
	},
	wpcomPublicApi: {
		reducerPath: 'wpcomPublicApi',
		reducer: () => ( {} ),
		middleware: () => ( next: Dispatch ) => ( action: UnknownAction ) => next( action ),
	},
	galleryBlueprintsApi: {
		reducerPath: 'galleryBlueprintsApi',
		reducer: () => ( {} ),
		middleware: () => ( next: Dispatch ) => ( action: UnknownAction ) => next( action ),
	},
} ) );

const runningSite = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.4',
	id: 'site-id',
	url: 'http://example.com',
};

const createWpcomClient = (): WPCOM => wpcomFactory( 'test-token', wpcomXhrRequest );

const mockAssistantChat = () => {
	const chatResponse = {
		id: 100,
		created_at: '2025-01-24 09:11:50',
		choices: [
			{
				index: 0,
				message: {
					id: 0,
					role: 'assistant',
					content:
						'Hello! How can I assist you today? Are you working on a WordPress project, or do you need help with something specific related to WordPress or WP-CLI?',
				},
			},
		],
	};
	const quotaHeaders = {
		'x-quota-max': '100',
		'x-quota-remaining': '99',
		'x-quota-reset': '2025-05-01T00:00:00+00:00',
	};

	nock( 'https://public-api.wordpress.com' )
		.persist()
		.post( '/wpcom/v2/studio-app/ai-assistant/chat' )
		.query( true )
		.reply( ( uri ) => {
			const isEnvelopeMode = uri.includes( '_envelope=1' );
			if ( isEnvelopeMode ) {
				return [
					200,
					{
						status: 200,
						headers: quotaHeaders,
						body: chatResponse,
					},
				];
			}
			return [ 200, chatResponse, quotaHeaders ];
		} );

	nock( 'https://public-api.wordpress.com' )
		.persist()
		.get( '/wpcom/v2/ai/chats/wpcom-agent-dolly' )
		.query( true )
		.reply( 200, [] );
};

const initialMessages = [
	generateMessage( 'Initial message 1', 'user', 0, 100, 10 ),
	generateMessage( 'Initial message 2', 'assistant', 1, 100, 11 ),
];

describe( 'ContentTabAssistant', () => {
	const authenticate = vi.fn();
	const logout = vi.fn();

	type ContextState = {
		selectedSite?: SiteDetails;
		selectedWpcomSite?: SyncSite;
		auth?: Partial< AuthContextType >;
		component?: 'content-tab' | 'wpcom-site';
		strictMode?: boolean;
		keyWpcomSiteAssistant?: boolean;
	};

	const firstWpcomSite: SyncSite = {
		id: 123,
		localSiteId: '',
		name: 'Dolly Site',
		url: 'https://dolly.example',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};

	const secondWpcomSite: SyncSite = {
		...firstWpcomSite,
		id: 456,
		name: 'Second Dolly Site',
		url: 'https://second-dolly.example',
	};

	const buildContextTree = ( {
		selectedSite = runningSite,
		selectedWpcomSite = firstWpcomSite,
		auth = {},
		component = 'content-tab',
		strictMode = false,
		keyWpcomSiteAssistant = true,
	}: ContextState = {} ) => {
		const authContextValue: AuthContextType = {
			client: createWpcomClient(),
			isAuthenticated: true,
			authenticate,
			logout,
			...auth,
		};

		const tree = (
			<Provider store={ store }>
				<AuthContext.Provider value={ authContextValue }>
					<ThemeDetailsProvider>
						{ component === 'wpcom-site' ? (
							keyWpcomSiteAssistant ? (
								<WpcomSiteAssistant
									key={ selectedWpcomSite.id }
									selectedWpcomSite={ selectedWpcomSite }
								/>
							) : (
								<WpcomSiteAssistant selectedWpcomSite={ selectedWpcomSite } />
							)
						) : (
							<ContentTabAssistant selectedSite={ selectedSite } />
						) }
					</ThemeDetailsProvider>
				</AuthContext.Provider>
			</Provider>
		);
		return strictMode ? <StrictMode>{ tree }</StrictMode> : tree;
	};

	const renderWithContext = ( options?: ContextState ) => render( buildContextTree( options ) );

	const getInput = () => screen.getByRole( 'textbox' );

	const getGuidelinesLink = () => screen.getByTestId( 'guidelines-link' );

	const getChatMessageText = ( text: string | RegExp ) =>
		screen
			.getAllByText( text )
			.find( ( element ) => element.closest( '[data-slot="messages"]' ) ) ??
		screen.getByText( text );

	const queryChatMessageText = ( text: string | RegExp ) =>
		screen
			.queryAllByText( text )
			.find( ( element ) => element.closest( '[data-slot="messages"]' ) ) ?? null;

	beforeAll( () => {
		nock.cleanAll();
		mockAssistantChat();
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		clearWpcomSiteAssistantStateCacheForTests();
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		window.HTMLElement.prototype.scrollTo = vi.fn();
		localStorage.clear();

		// Reset Redux store state
		store.dispatch( testActions.resetState() );
		// Avoid flaky late async updates from previous tests by ensuring the default instance exists.
		store.dispatch( chatActions.setMessages( { instanceId: runningSite.id, messages: [] } ) );

		vi.mocked( useOffline ).mockReturnValue( false );
		vi.mocked( useGetWelcomeMessages, { partial: true } ).mockReturnValue( {
			data: {
				messages: [ 'Welcome to our service!', 'How can I help you today?' ],
				example_prompts: [
					'How to create a WordPress site',
					'How to clear cache',
					'How to install a plugin',
				],
			},
		} );
		vi.mocked( useGetAssistantQuota, { partial: true } ).mockReturnValue( {
			data: { userCanSendMessage: true },
		} );
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			showMessageBox: vi.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
			executeWPCLiInline: vi.fn().mockResolvedValue( { stdout: '', stderr: 'Error' } ),
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [
				{
					id: 123,
					localSiteId: runningSite.id,
					name: 'Dolly Site',
					url: 'https://dolly.example',
					isStaging: false,
					isPressable: false,
					syncSupport: 'syncable',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			] ),
			openURL: vi.fn(),
		} );
		vi.mocked( useGetWpVersion ).mockReturnValue( [ '6.4.3', vi.fn() ] );
	} );

	afterAll( () => {
		nock.cleanAll();
	} );

	it( 'renders placeholder text input', () => {
		renderWithContext();
		const textInput = getInput();
		expect( textInput ).toBeVisible();
		expect( textInput ).toBeEnabled();
		expect( textInput ).toHaveAttribute( 'placeholder', 'What would you like to learn?' );
	} );

	it( 'keeps the local site content tab on the existing assistant', () => {
		renderWithContext( { component: 'content-tab' } );

		expect( getInput() ).toHaveAttribute( 'placeholder', 'What would you like to learn?' );
		expect( screen.queryByText( 'Powered by Dolly.' ) ).not.toBeInTheDocument();
		expect( getGuidelinesLink() ).toHaveTextContent( 'Powered by experimental AI.' );
	} );

	it( 'starts a fresh Dolly backend session when the selected WP.com site changes', async () => {
		const dollyClient = {
			req: {
				post: vi
					.fn()
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-1',
								sessionId: 'session-for-first-site',
								status: {
									state: 'completed',
									message: {
										parts: [
											{
												type: 'text',
												text: 'First site response',
											},
										],
									},
								},
							},
						} );
					} )
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-2',
								sessionId: 'session-for-second-site',
								status: {
									state: 'completed',
									message: {
										parts: [
											{
												type: 'text',
												text: 'Second site response',
											},
										],
									},
								},
							},
						} );
					} ),
			},
		} as unknown as WPCOM;

		const { rerender } = renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		let textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'Hello first site' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'First site response' ) ).toBeVisible();
		} );

		rerender(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: secondWpcomSite,
				auth: {
					client: dollyClient,
				},
			} )
		);

		textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'Hello second site' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Second site response' ) ).toBeVisible();
		} );

		const secondRequest = vi.mocked( dollyClient.req.post ).mock.calls[ 1 ][ 0 ] as {
			path: string;
			body: {
				params: {
					id?: string;
					sessionId?: string;
					message: {
						parts: Array< {
							data?: { clientContext?: { selectedSiteId?: number } };
						} >;
					};
				};
			};
		};
		const secondClientContextPart = secondRequest.body.params.message.parts.find(
			( part ) => part.data?.clientContext
		);

		expect( secondRequest.path ).toBe( '/sites/456/ai/agent/dolly' );
		expect( secondRequest.body.params.sessionId ).toBe( secondRequest.body.params.id );
		expect( secondClientContextPart?.data?.clientContext?.selectedSiteId ).toBe( 456 );
	} );

	it( 'does not cache the previous WP.com-only session under the next selected site', async () => {
		const requestBodies: unknown[] = [];
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi.fn( ( params, callback ) => {
					requestBodies.push( params.body );
					const body = params.body as {
						params?: {
							message?: { parts?: Array< { text?: string } > };
						};
					};
					const textPart = body.params?.message?.parts?.find(
						( part ) => typeof part.text === 'string'
					);
					const messageText = textPart?.text;
					const selectedSiteId = messageText === 'Second hello' ? 456 : 123;

					callback( null, {
						result: {
							id: `task-${ requestBodies.length }`,
							sessionId: selectedSiteId === 456 ? 'session-second' : 'session-first',
							selectedSiteId,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: `${ messageText } response`,
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		const { rerender } = render(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: firstWpcomSite,
				keyWpcomSiteAssistant: false,
				auth: {
					client: dollyClient,
				},
			} )
		);

		fireEvent.change( getInput(), { target: { value: 'First hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'First hello response' ) ).toBeVisible();
		} );

		rerender(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: secondWpcomSite,
				keyWpcomSiteAssistant: false,
				auth: {
					client: dollyClient,
				},
			} )
		);

		await waitFor( () => {
			expect( screen.getByText( 'Second Dolly Site' ) ).toBeVisible();
			expect( queryChatMessageText( 'First hello response' ) ).not.toBeInTheDocument();
		} );

		const persistedConversationsAfterSwitch = JSON.parse(
			localStorage.getItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY ) || '{}'
		) as Record< string, { sessionId?: string } >;
		expect( persistedConversationsAfterSwitch[ 'wpcom-site:456' ]?.sessionId ).toBeUndefined();

		fireEvent.change( getInput(), { target: { value: 'Second hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Second hello response' ) ).toBeVisible();
		} );

		const secondRequest = requestBodies[ 1 ] as {
			params?: {
				id?: string;
				sessionId?: string;
				message?: { parts?: Array< { data?: unknown } > };
			};
		};
		expect( secondRequest.params?.sessionId ).toBe( secondRequest.params?.id );
	} );

	it( 'renders a completed Dolly response in the WP.com-only live site chat', async () => {
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi.fn( ( _params, callback ) => {
					callback( null, {
						jsonrpc: '2.0',
						id: 'rpc-1',
						result: {
							id: 'task-1',
							status: {
								state: 'completed',
								message: {
									kind: 'message',
									messageId: 'msg-1',
									role: 'agent',
									parts: [
										{
											type: 'text',
											text: "hey Big D \u{1f44b} what's up?",
										},
									],
								},
								timestamp: '2026-05-14T13:20:16+00:00',
							},
							sessionId: 'session-1',
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			strictMode: true,
			auth: {
				client: dollyClient,
			},
		} );

		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'hey' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( "hey Big D \u{1f44b} what's up?" ) ).toBeVisible();
			expect( getInput() ).toBeEnabled();
		} );
	} );

	it( 'updates the active WP.com-only site when Dolly reports a backend site change', async () => {
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, {
						sites: [
							{
								ID: 123,
								name: 'Dolly Site',
								URL: 'https://dolly.example',
							},
							{
								ID: 456,
								name: 'Second Dolly Site',
								primary_domain: 'second-dolly.example',
							},
						],
					} );
				} ),
				post: vi.fn( ( _params, callback ) => {
					callback( null, {
						result: {
							id: 'task-1',
							sessionId: 'session-1',
							selectedSiteId: 456,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: 'Now working on the second site.',
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'Switch to the second site' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Now working on the second site.' ) ).toBeVisible();
			expect( screen.getByText( 'Second Dolly Site' ) ).toBeVisible();
			expect( screen.getByText( 'https://second-dolly.example' ) ).toBeVisible();
			expect( screen.queryByTitle( 'Second Dolly Site preview' ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();
		} );
	} );

	it( 'keeps the WP.com-only preview hidden until the user opens it', () => {
		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: {
				...firstWpcomSite,
				url: 'dolly.example',
			},
		} );

		expect( screen.queryByTitle( 'Dolly Site preview' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Show preview' } ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );

		expect( screen.getByTitle( 'Dolly Site preview' ) ).toHaveAttribute(
			'src',
			'https://dolly.example/'
		);
	} );

	it( 'preserves WP.com-only chat state and Dolly session per selected live site', async () => {
		const requestBodies: unknown[] = [];
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi.fn( ( params, callback ) => {
					requestBodies.push( params.body );
					const body = params.body as {
						params?: {
							sessionId?: string;
							message?: { parts?: Array< { text?: string } > };
						};
					};
					const textPart = body.params?.message?.parts?.find(
						( part ) => typeof part.text === 'string'
					);
					const messageText = textPart?.text;
					const selectedSiteId = messageText === 'Second hello' ? 456 : 123;
					const sessionId = selectedSiteId === 456 ? 'session-second' : 'session-first';
					const responseText =
						messageText === 'Follow up first'
							? 'First follow-up response'
							: `${ messageText } response`;

					callback( null, {
						result: {
							id: `task-${ requestBodies.length }`,
							sessionId,
							selectedSiteId,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: responseText,
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		const { rerender } = render(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: firstWpcomSite,
				auth: {
					client: dollyClient,
				},
			} )
		);

		fireEvent.change( getInput(), { target: { value: 'First hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'First hello response' ) ).toBeVisible();
		} );
		const persistedConversations = JSON.parse(
			localStorage.getItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY ) || '{}'
		) as Record< string, { id?: string; sessionId?: string } >;
		expect( persistedConversations[ 'wpcom-site:123' ]?.id ).toMatch( /^local:/ );
		expect( persistedConversations[ 'wpcom-site:123' ]?.sessionId ).toBe( 'session-first' );

		rerender(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: secondWpcomSite,
				auth: {
					client: dollyClient,
				},
			} )
		);

		expect( queryChatMessageText( 'First hello response' ) ).not.toBeInTheDocument();
		fireEvent.change( getInput(), { target: { value: 'Second hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Second hello response' ) ).toBeVisible();
		} );

		rerender(
			buildContextTree( {
				component: 'wpcom-site',
				selectedWpcomSite: firstWpcomSite,
				auth: {
					client: dollyClient,
				},
			} )
		);

		expect( getChatMessageText( 'First hello response' ) ).toBeInTheDocument();
		expect( queryChatMessageText( 'Second hello response' ) ).not.toBeInTheDocument();

		fireEvent.change( getInput(), { target: { value: 'Follow up first' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'First follow-up response' ) ).toBeVisible();
		} );

		const followUpRequest = requestBodies[ 2 ] as { params?: { sessionId?: string } };
		expect( followUpRequest.params?.sessionId ).toBe( 'session-first' );
	} );

	it( 'clears the WP.com-only chat state and starts the next Dolly turn without a session', async () => {
		localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
		const requestBodies: unknown[] = [];
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi.fn( ( params, callback ) => {
					requestBodies.push( params.body );
					const body = params.body as {
						params?: {
							message?: { parts?: Array< { text?: string } > };
						};
					};
					const textPart = body.params?.message?.parts?.find(
						( part ) => typeof part.text === 'string'
					);
					const messageText = textPart?.text;

					callback( null, {
						result: {
							id: `task-${ requestBodies.length }`,
							sessionId: `session-${ requestBodies.length }`,
							selectedSiteId: 123,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: `${ messageText } response`,
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		fireEvent.change( getInput(), { target: { value: 'First hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'First hello response' ) ).toBeVisible();
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Clear conversation' } ) );

		await waitFor( () => {
			expect( queryChatMessageText( 'First hello response' ) ).not.toBeInTheDocument();
		} );

		fireEvent.change( getInput(), { target: { value: 'Fresh hello' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Fresh hello response' ) ).toBeVisible();
		} );

		const freshRequest = requestBodies[ 1 ] as { params?: { id?: string; sessionId?: string } };
		expect( freshRequest.params?.sessionId ).toBe( freshRequest.params?.id );
	} );

	it( 'hydrates WP.com-only chat state from Dolly server history', async () => {
		localStorage.setItem(
			LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY,
			JSON.stringify( {
				'wpcom-site:123': {
					id: 'local:server-session',
					key: {
						siteId: 123,
						agentId: 'dolly',
					},
					input: '',
					messages: [],
					sessionId: 'server-session',
					activeWpcomSite: firstWpcomSite,
					previewState: {
						open: false,
						pathOrUrl: '/',
						isLoading: false,
						reloadNonce: 0,
					},
					lastUpdated: Date.parse( '2026-05-14T13:19:00Z' ),
					serverHydrationDisabled: true,
				},
			} )
		);

		const requestBodies: unknown[] = [];
		const dollyClient = {
			req: {
				get: vi.fn( ( params, callback ) => {
					if ( params.path.startsWith( '/ai/chats/wpcom-agent-dolly' ) ) {
						callback( null, [
							{
								chat_id: 900,
								session_id: 'server-session',
								created_at: '2026-05-14 13:10:00',
								first_message: {
									message_id: 10,
									role: 'user',
									content: 'Older summary question',
									created_at: '2026-05-14 13:10:00',
								},
								last_message: {
									message_id: 11,
									role: 'bot',
									content: 'Older summary answer',
									created_at: '2026-05-14 13:11:00',
								},
							},
							{
								chat_id: 987,
								session_id: 'server-session',
								site_id: 123,
								created_at: '2026-05-14 13:20:00',
								first_message: {
									message_id: 1,
									role: 'user',
									content: 'Server summary question',
									created_at: '2026-05-14 13:20:00',
								},
								last_message: {
									message_id: 2,
									role: 'bot',
									content: 'Server summary answer',
									created_at: '2026-05-14 13:21:00',
								},
							},
						] );
						return;
					}

					if ( params.path.startsWith( '/ai/chat/wpcom-agent-dolly/900' ) ) {
						callback( null, {
							chat_id: 900,
							session_id: 'server-session',
							created_at: '2026-05-14 13:10:00',
							messages: [
								{
									message_id: 10,
									role: 'user',
									content: 'Older server question',
									created_at: '2026-05-14 13:10:00',
								},
								{
									message_id: 11,
									role: 'bot',
									content: 'Older server answer',
									created_at: '2026-05-14 13:11:00',
								},
							],
						} );
						return;
					}

					if ( params.path.startsWith( '/ai/chat/wpcom-agent-dolly/987' ) ) {
						callback( null, {
							chat_id: 987,
							session_id: 'server-session',
							site_id: 123,
							created_at: '2026-05-14 13:20:00',
							messages: [
								{
									message_id: 1,
									role: 'user',
									content:
										'Local workspace context:\nSelected site: Dolly Site\n\nUser message:\nServer question',
									created_at: '2026-05-14 13:20:00',
								},
								{
									message_id: 2,
									role: 'bot',
									content: 'Server answer',
									created_at: '2026-05-14 13:21:00',
								},
							],
						} );
						return;
					}

					callback( null, [] );
				} ),
				post: vi.fn( ( params, callback ) => {
					requestBodies.push( params.body );
					callback( null, {
						result: {
							id: 'task-1',
							sessionId: 'server-session',
							selectedSiteId: 123,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: 'Continuation answer',
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		await waitFor( () => {
			expect( getChatMessageText( 'Older server question' ) ).toBeVisible();
			expect( getChatMessageText( 'Older server answer' ) ).toBeVisible();
			expect( getChatMessageText( 'Server question' ) ).toBeVisible();
			expect( getChatMessageText( 'Server answer' ) ).toBeVisible();
		} );
		expect( screen.queryByText( /Local workspace context:/ ) ).not.toBeInTheDocument();

		const persistedConversations = JSON.parse(
			localStorage.getItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY ) || '{}'
		) as Record< string, { id?: string; remoteChatId?: number; sessionId?: string } >;
		expect( persistedConversations[ 'wpcom-site:123' ] ).toEqual(
			expect.objectContaining( {
				id: 'wpcom:dolly:987',
				remoteChatId: 987,
				sessionId: 'server-session',
			} )
		);

		fireEvent.change( getInput(), { target: { value: 'Continue server chat' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Continuation answer' ) ).toBeVisible();
		} );

		const continuationRequest = requestBodies[ 0 ] as { params?: { sessionId?: string } };
		expect( continuationRequest.params?.sessionId ).toBe( 'server-session' );
	} );

	it( 'starts a fresh WP.com-only session on first send even when server history exists', async () => {
		const requestBodies: unknown[] = [];
		const dollyClient = {
			req: {
				get: vi.fn( ( params, callback ) => {
					if ( params.path.startsWith( '/ai/chats/wpcom-agent-dolly' ) ) {
						callback( null, [
							{
								chat_id: 987,
								session_id: 'old-server-session',
								site_id: 123,
								created_at: '2026-05-14 13:20:00',
								first_message: {
									message_id: 1,
									role: 'user',
									content: 'Old server question',
									created_at: '2026-05-14 13:20:00',
								},
								last_message: {
									message_id: 2,
									role: 'bot',
									content: 'Old server answer',
									created_at: '2026-05-14 13:21:00',
								},
							},
						] );
						return;
					}

					callback( null, [] );
				} ),
				post: vi.fn( ( params, callback ) => {
					requestBodies.push( params.body );
					callback( null, {
						result: {
							id: 'task-1',
							sessionId: 'fresh-server-session',
							selectedSiteId: 123,
							status: {
								state: 'completed',
								message: {
									parts: [
										{
											type: 'text',
											text: 'Fresh answer',
										},
									],
								},
							},
						},
					} );
				} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		await waitFor( () => {
			expect( queryChatMessageText( 'Old server answer' ) ).not.toBeInTheDocument();
		} );

		fireEvent.change( getInput(), { target: { value: 'First fresh message' } } );
		fireEvent.keyDown( getInput(), { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'Fresh answer' ) ).toBeVisible();
		} );

		const firstRequest = requestBodies[ 0 ] as { params?: { id?: string; sessionId?: string } };
		expect( firstRequest.params?.id ).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
		expect( firstRequest.params?.id ).not.toBe( 'old-server-session' );
		expect( firstRequest.params?.sessionId ).toBe( firstRequest.params?.id );
	} );

	it( 'does not reload the WP.com-only preview for same-url preview tool calls without a site change', async () => {
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi
					.fn()
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-1',
								sessionId: 'session-1',
								status: {
									state: 'input-required',
									message: {
										parts: [
											{
												type: 'data',
												data: {
													toolCallId: 'tool-call-1',
													toolId: 'wpworkspace/preview',
													arguments: {
														url: '/',
													},
												},
											},
										],
									},
								},
							},
						} );
					} )
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-1',
								sessionId: 'session-1',
								status: {
									state: 'completed',
									message: {
										parts: [
											{
												type: 'text',
												text: 'The preview is already open.',
											},
										],
									},
								},
							},
						} );
					} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
		const initialPreview = screen.getByTitle( 'Dolly Site preview' );
		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'Keep the preview open' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'The preview is already open.' ) ).toBeVisible();
		} );
		expect( screen.getByTitle( 'Dolly Site preview' ) ).toBe( initialPreview );
	} );

	it( 'reloads the WP.com-only preview when Dolly marks the site as changed', async () => {
		const dollyClient = {
			req: {
				get: vi.fn( ( _params, callback ) => {
					callback( null, [] );
				} ),
				post: vi
					.fn()
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-1',
								sessionId: 'session-1',
								status: {
									state: 'input-required',
									message: {
										parts: [
											{
												type: 'data',
												data: {
													toolCallId: 'tool-call-1',
													toolId: 'wpworkspace/preview',
													arguments: {
														url: '/',
														siteChanged: true,
													},
												},
											},
										],
									},
								},
							},
						} );
					} )
					.mockImplementationOnce( ( _params, callback ) => {
						callback( null, {
							result: {
								id: 'task-1',
								sessionId: 'session-1',
								status: {
									state: 'completed',
									message: {
										parts: [
											{
												type: 'text',
												text: 'I updated the site.',
											},
										],
									},
								},
							},
						} );
					} ),
			},
		} as unknown as WPCOM;

		renderWithContext( {
			component: 'wpcom-site',
			selectedWpcomSite: firstWpcomSite,
			auth: {
				client: dollyClient,
			},
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Show preview' } ) );
		const initialPreview = screen.getByTitle( 'Dolly Site preview' );
		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'Update the site' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		await waitFor( () => {
			expect( getChatMessageText( 'I updated the site.' ) ).toBeVisible();
		} );
		expect( screen.getByTitle( 'Dolly Site preview' ) ).not.toBe( initialPreview );
	} );

	it( 'renders guideline section', () => {
		renderWithContext();
		const guideLines = getGuidelinesLink();
		expect( guideLines ).toBeVisible();
		expect( guideLines ).toHaveTextContent( 'Powered by experimental AI. Learn more' );
	} );

	it( 'saves and retrieves conversation from Redux state', async () => {
		store.dispatch(
			chatActions.setMessages( { instanceId: runningSite.id, messages: initialMessages } )
		);
		renderWithContext();
		await waitFor( () => {
			expect( screen.getByText( 'Initial message 1' ) ).toBeVisible();
			expect( screen.getByText( 'Initial message 2' ) ).toBeVisible();
		} );

		const textInput = getInput();
		act( () => {
			fireEvent.change( textInput, { target: { value: 'New message' } } );
			fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );
		} );

		await waitFor( () => {
			expect( screen.getByText( 'New message' ) ).toBeInTheDocument();
		} );

		await waitFor( () => {
			const storedMessages = JSON.parse(
				localStorage.getItem( LOCAL_STORAGE_CHAT_MESSAGES_KEY ) || '[]'
			);
			expect( storedMessages[ runningSite.id ] ).toHaveLength( 3 );
			expect( storedMessages[ runningSite.id ][ 2 ].content ).toBe( 'New message' );
		} );
	} );

	it( 'renders default message when not authenticated', async () => {
		renderWithContext( { auth: { isAuthenticated: false } } );

		await waitFor( () => {
			expect( screen.getByText( 'Hold up!' ) ).toBeVisible();
			expect(
				screen.getByText( 'You need to log in to your WordPress.com account to use the assistant.' )
			).toBeVisible();
		} );
	} );

	it( 'renders offline notice when not authenticated', () => {
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithContext( { auth: { isAuthenticated: false } } );
		expect( screen.queryByText( 'Hold up!' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'You need to log in to your WordPress.com account to use the assistant.' )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
	} );

	it( 'allows authentication from Assistant chat', async () => {
		renderWithContext( { auth: { isAuthenticated: false } } );

		await waitFor( () => {
			const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
			expect( loginButton ).toBeInTheDocument();
		} );

		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com ↗' } );
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'it stores messages with user-unique keys', async () => {
		const user1 = { id: 1, email: 'user1@example.com', displayName: 'User 1' };
		const user2 = { id: 2, email: 'user2@example.com', displayName: 'User 2' };
		const { rerender } = renderWithContext( { auth: { user: user1 } } );

		const textInput = getInput();
		act( () => {
			fireEvent.change( textInput, { target: { value: 'New message' } } );
			fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );
		} );
		await waitFor( () => {
			expect( screen.getByText( 'New message' ) ).toBeVisible();
		} );

		// Simulate user authentication change
		rerender( buildContextTree( { auth: { user: user2 } } ) );

		await waitFor(
			() => {
				expect( screen.queryByText( 'New message' ) ).not.toBeInTheDocument();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);
	} );

	it( 'does not render the Welcome messages and example prompts when not authenticated', () => {
		renderWithContext( { auth: { isAuthenticated: false } } );

		expect( screen.getByTestId( 'unauthenticated-header' ) ).toHaveTextContent( 'Hold up!' );

		expect( screen.queryByText( 'Welcome to our service!' ) ).not.toBeInTheDocument();
	} );

	it( 'renders Welcome messages and example prompts when the conversation is starts', () => {
		store.dispatch( chatActions.setMessages( { instanceId: runningSite.id, messages: [] } ) );
		renderWithContext();

		expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeVisible();
		expect( screen.getByText( 'How to clear cache' ) ).toBeVisible();
		expect( screen.getByText( 'How to install a plugin' ) ).toBeVisible();
	} );

	it( 'renders Welcome messages and example prompts when offline', () => {
		store.dispatch( chatActions.setMessages( { instanceId: runningSite.id, messages: [] } ) );
		vi.mocked( useOffline ).mockReturnValue( true );

		renderWithContext();
		expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeVisible();
		expect( screen.getByText( 'How to clear cache' ) ).toBeVisible();
		expect( screen.getByText( 'How to install a plugin' ) ).toBeVisible();
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
	} );

	it( 'should manage the focus state when selecting an example prompt', async () => {
		store.dispatch( chatActions.setMessages( { instanceId: runningSite.id, messages: [] } ) );
		const user = userEvent.setup();
		renderWithContext();

		const textInput = getInput();
		await user.type( textInput, '[Tab]' );
		expect( textInput ).not.toHaveFocus();

		const samplePrompt = await screen.findByRole( 'button', {
			name: 'How to create a WordPress site',
		} );
		expect( samplePrompt ).toBeVisible();
		await user.click( samplePrompt );

		expect( textInput ).toHaveFocus();
	} );

	it( 'renders the selected prompt of Welcome messages and confirms other prompts are removed', async () => {
		store.dispatch( chatActions.setMessages( { instanceId: runningSite.id, messages: [] } ) );

		renderWithContext();

		await waitFor( () => {
			expect( screen.getByText( 'Welcome to our service!' ) ).toBeInTheDocument();
			expect( screen.getByText( 'How to create a WordPress site' ) ).toBeInTheDocument();
			expect( screen.getByText( 'How to install a plugin' ) ).toBeInTheDocument();
		} );

		const samplePrompt = await screen.findByRole( 'button', {
			name: 'How to create a WordPress site',
		} );
		fireEvent.click( samplePrompt );

		await waitFor(
			() => {
				expect( screen.getByText( 'Welcome to our service!' ) ).toBeInTheDocument();
				expect( screen.getByText( 'How to create a WordPress site' ) ).toBeInTheDocument();
				expect( screen.queryByText( 'How to clear cache' ) ).not.toBeInTheDocument();
				expect( screen.queryByText( 'How to install a plugin' ) ).not.toBeInTheDocument();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);
	} );

	it( 'clears history via reminder when last message is two hours old', async () => {
		const MOCKED_CURRENT_TIME = 1718882159928;
		const OLD_MESSAGE_TIME = MOCKED_CURRENT_TIME - CLEAR_HISTORY_REMINDER_TIME - 1;
		vi.useFakeTimers( { shouldAdvanceTime: true } );
		vi.setSystemTime( MOCKED_CURRENT_TIME );

		const messageOne = generateMessage( 'Initial message 1', 'user', 0, 100, 10 );
		messageOne.createdAt = MOCKED_CURRENT_TIME;
		const messageTwo = generateMessage( 'Initial message 2', 'assistant', 1, 100, 11 );
		messageTwo.createdAt = OLD_MESSAGE_TIME;
		store.dispatch(
			chatActions.setMessages( {
				instanceId: runningSite.id,
				messages: [ messageOne, messageTwo ],
			} )
		);

		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			showMessageBox: vi.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
			executeWPCLiInline: vi.fn().mockResolvedValue( { stdout: '', stderr: 'Error' } ),
		} );

		renderWithContext();

		await waitFor(
			() => {
				expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
				expect( screen.getByText( 'Initial message 1' ) ).toBeVisible();
				expect( screen.getByText( 'Initial message 2' ) ).toBeVisible();
				expect(
					screen.getByText( 'This conversation is over two hours old.', { exact: false } )
				).toBeVisible();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Clear the history' } ) );
		await waitFor(
			() => {
				expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
				expect( screen.queryByText( 'Initial message 1' ) ).not.toBeInTheDocument();
				expect( screen.queryByText( 'Initial message 2' ) ).not.toBeInTheDocument();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);
	} );

	it( 'renders notices by importance', async () => {
		const messageOne = generateMessage( 'Initial message 1', 'user', 0, 100, 10 );
		messageOne.createdAt = 0;
		const messageTwo = generateMessage( 'Initial message 2', 'assistant', 1, 100, 11 );
		messageTwo.createdAt = 0;
		store.dispatch(
			chatActions.setMessages( {
				instanceId: runningSite.id,
				messages: [ messageOne, messageTwo ],
			} )
		);

		const { rerender } = renderWithContext();
		await waitFor(
			() => {
				expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
				expect( screen.getByText( 'Initial message 1' ) ).toBeVisible();
				expect( screen.getByText( 'Initial message 2' ) ).toBeVisible();
				expect(
					screen.getByText( 'This conversation is over two hours old.', { exact: false } )
				).toBeVisible();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 2000 }
		);

		vi.mocked( useGetAssistantQuota, { partial: true } ).mockReturnValue( {
			data: { userCanSendMessage: false, daysUntilReset: 4 },
		} );
		rerender( buildContextTree() );
		expect(
			screen.getByText( 'Your limit will reset in 4 days.', { exact: false } )
		).toBeVisible();
		expect(
			screen.queryByText( 'This conversation is over two hours old.', { exact: false } )
		).not.toBeInTheDocument();

		vi.mocked( useOffline ).mockReturnValue( true );
		rerender( buildContextTree() );
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
		expect(
			screen.queryByText( 'Your limit will reset in 4 days.', { exact: false } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'This conversation is over two hours old.', { exact: false } )
		).not.toBeInTheDocument();
	} );

	it( 'restores chat input when changing current site', async () => {
		const anotherSite = {
			...runningSite,
			id: 'another-site-id',
			name: 'Another Test Site',
		};

		const { rerender } = renderWithContext();

		// Input should be empty initially
		expect( getInput() ).toHaveValue( '' );

		// Input is updated for the first site
		fireEvent.change( getInput(), { target: { value: 'New message' } } );
		expect( getInput() ).toHaveValue( 'New message' );

		// Changing to second site should reset the input
		rerender( buildContextTree( { selectedSite: anotherSite } ) );
		expect( getInput() ).toHaveValue( '' );

		// Input is updated for the second site
		fireEvent.change( getInput(), { target: { value: 'Another message' } } );
		expect( getInput() ).toHaveValue( 'Another message' );

		// Changing to the first site should restore the input
		rerender( buildContextTree() );
		expect( getInput() ).toHaveValue( 'New message' );

		// Changing to the second site should restore the input
		rerender( buildContextTree( { selectedSite: anotherSite } ) );
		expect( getInput() ).toHaveValue( 'Another message' );
	} );
} );
