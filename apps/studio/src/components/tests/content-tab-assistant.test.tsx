import { UnknownAction } from '@reduxjs/toolkit';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import nock from 'nock';
import { Provider } from 'react-redux';
import { Dispatch } from 'redux';
import { vi } from 'vitest';
import { AuthContext, AuthContextType } from 'src/components/auth-provider';
import {
	ContentTabAssistant,
	MIMIC_CONVERSATION_DELAY,
} from 'src/components/content-tab-assistant';
import { LOCAL_STORAGE_CHAT_MESSAGES_KEY, CLEAR_HISTORY_REMINDER_TIME } from 'src/constants';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useOffline } from 'src/hooks/use-offline';
import { ThemeDetailsProvider } from 'src/hooks/use-theme-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { generateMessage, chatActions } from 'src/stores/chat-slice';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import { useGetAssistantQuota, useGetWelcomeMessages } from 'src/stores/wpcom-api';
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
} ) );

const runningSite = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.3',
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
		auth?: Partial< AuthContextType >;
	};

	const buildContextTree = ( { selectedSite = runningSite, auth = {} }: ContextState = {} ) => {
		const authContextValue: AuthContextType = {
			client: createWpcomClient(),
			isAuthenticated: true,
			authenticate,
			logout,
			...auth,
		};

		return (
			<Provider store={ store }>
				<AuthContext.Provider value={ authContextValue }>
					<ThemeDetailsProvider>
						<ContentTabAssistant selectedSite={ selectedSite } />
					</ThemeDetailsProvider>
				</AuthContext.Provider>
			</Provider>
		);
	};

	const renderWithContext = ( options?: ContextState ) => render( buildContextTree( options ) );

	const getInput = () => screen.getByTestId( 'ai-input-textarea' );

	const getGuidelinesLink = () => screen.getByTestId( 'guidelines-link' );

	beforeAll( () => {
		nock.cleanAll();
		mockAssistantChat();
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
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
