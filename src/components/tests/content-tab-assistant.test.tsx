import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useAuth } from '../../hooks/use-auth';
import { useOffline } from '../../hooks/use-offline';
import { usePromptUsage } from '../../hooks/use-prompt-usage';
import { useWelcomeMessages } from '../../hooks/use-welcome-messages';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabAssistant, MIMIC_CONVERSATION_DELAY } from '../content-tab-assistant';

jest.mock( '../../hooks/use-theme-details' );
jest.mock( '../../hooks/use-auth' );
jest.mock( '../../hooks/use-welcome-messages' );
jest.mock( '../../hooks/use-offline' );
jest.mock( '../../hooks/use-prompt-usage' );
jest.mock( '../../hooks/use-prompt-usage' );
jest.mock( '../../lib/get-ipc-api' );

jest.mock( '../../lib/app-globals', () => ( {
	getAppGlobals: () => ( {
		locale: jest.fn,
	} ),
} ) );

( useWelcomeMessages as jest.Mock ).mockReturnValue( {
	messages: [ 'Welcome to our service!', 'How can I help you today?' ],
	examplePrompts: [
		'How to create a WordPress site',
		'How to clear cache',
		'How to install a plugin',
	],
} );

const runningSite = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.0',
	id: 'site-id',
	url: 'http://example.com',
};

const initialMessages = [
	{ id: 0, content: 'Initial message 1', role: 'user' },
	{ id: 1, content: 'Initial message 2', role: 'assistant' },
];

describe( 'ContentTabAssistant', () => {
	const clientReqPost = jest.fn().mockResolvedValue( {
		id: 'chatcmpl-9USNsuhHWYsPAUNiOhOG2970Hjwwb',
		object: 'chat.completion',
		created: 1717045976,
		model: 'test',
		choices: [
			{
				index: 0,
				message: {
					id: 0,
					role: 'assistant',
					content:
						'Hello! How can I assist you today? Are you working on a WordPress project, or do you need help with something specific related to WordPress or WP-CLI?',
				},
				logprobs: null,
				finish_reason: 'stop',
			},
		],
		usage: { prompt_tokens: 980, completion_tokens: 36, total_tokens: 1016 },
		system_fingerprint: 'fp_777',
	} );

	const authenticate = jest.fn();

	const getInput = () => screen.getByTestId( 'ai-input-textarea' );

	const getGuidelinesLink = () => screen.getByTestId( 'guidelines-link' ) as HTMLAnchorElement;

	beforeEach( () => {
		jest.clearAllMocks();
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		localStorage.clear();
		jest.useFakeTimers();
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
		} );
		( useOffline as jest.Mock ).mockReturnValue( false );
		( usePromptUsage as jest.Mock ).mockReturnValue( { userCanSendMessage: true } );
	} );

	test( 'renders placeholder text input', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		const textInput = getInput();
		expect( textInput ).toBeVisible();
		expect( textInput ).toBeEnabled();
		expect( textInput ).toHaveAttribute( 'placeholder', 'What would you like to learn?' );
	} );

	test( 'renders guideline section', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		const guideLines = getGuidelinesLink();
		expect( guideLines ).toBeVisible();
		expect( guideLines ).toHaveTextContent( 'Powered by experimental AI. Learn more' );
	} );

	test( 'saves and retrieves conversation from localStorage', async () => {
		const storageKey = 'ai_chat_messages';
		localStorage.setItem( storageKey, JSON.stringify( { [ runningSite.id ]: initialMessages } ) );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
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
			const storedMessages = JSON.parse( localStorage.getItem( storageKey ) || '[]' );
			expect( storedMessages[ runningSite.id ] ).toHaveLength( 3 );
			expect( storedMessages[ runningSite.id ][ 2 ].content ).toBe( 'New message' );
		} );
	} );

	test( 'renders default message when not authenticated', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		await waitFor( () => {
			expect( screen.getByText( 'Hold up!' ) ).toBeVisible();
			expect(
				screen.getByText( 'You need to log in to your WordPress.com account to use the assistant.' )
			).toBeVisible();
		} );
	} );

	test( 'renders offline notice when not authenticated', () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} );
		( useOffline as jest.Mock ).mockReturnValue( true );

		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.queryByText( 'Hold up!' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'You need to log in to your WordPress.com account to use the assistant.' )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
	} );

	test( 'allows authentication from Assistant chat', async () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		await waitFor( () => {
			const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
			expect( loginButton ).toBeInTheDocument();
		} );

		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'it stores messages with user-unique keys', async () => {
		const user1 = { id: 'mock-user-1' };
		const user2 = { id: 'mock-user-2' };
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
			user: user1,
		} );
		const { rerender } = render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = getInput();
		act( () => {
			fireEvent.change( textInput, { target: { value: 'New message' } } );
			fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );
			jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
		} );
		await waitFor( () => {
			expect( screen.getByText( 'New message' ) ).toBeVisible();
		} );

		// Simulate user authentication change
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
			user: user2,
		} );

		rerender( <ContentTabAssistant selectedSite={ runningSite } /> );

		await waitFor(
			() => {
				expect( screen.queryByText( 'New message' ) ).not.toBeInTheDocument();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);
	} );

	test( 'does not render the Welcome messages and example prompts when not authenticated', () => {
		( useAuth as jest.Mock ).mockReturnValue( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		expect( screen.getByTestId( 'unauthenticated-header' ) ).toHaveTextContent( 'Hold up!' );

		expect( screen.queryByText( 'Welcome to our service!' ) ).not.toBeInTheDocument();
	} );

	test( 'renders Welcome messages and example prompts when the conversation is starts', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeVisible();
		expect( screen.getByText( 'How to clear cache' ) ).toBeVisible();
		expect( screen.getByText( 'How to install a plugin' ) ).toBeVisible();
	} );

	test( 'renders Welcome messages and example prompts when offline', () => {
		( useOffline as jest.Mock ).mockReturnValue( true );

		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.getByText( 'Welcome to our service!' ) ).toBeVisible();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeVisible();
		expect( screen.getByText( 'How to clear cache' ) ).toBeVisible();
		expect( screen.getByText( 'How to install a plugin' ) ).toBeVisible();
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
	} );

	test( 'should manage the focus state when selecting an example prompt', async () => {
		jest.useRealTimers();
		const user = userEvent.setup();
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		let textInput = getInput();
		await user.type( textInput, '[Tab]' );
		expect( textInput ).not.toHaveFocus();

		const samplePrompt = await screen.findByRole( 'button', {
			name: 'How to create a WordPress site',
		} );
		expect( samplePrompt ).toBeVisible();
		fireEvent.click( samplePrompt );

		textInput = screen.getByPlaceholderText( 'Thinking about that...' );
		expect( textInput ).toHaveFocus();
	} );

	test( 'renders the selected prompt of Welcome messages and confirms other prompts are removed', async () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

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

	test( 'clears history via reminder when last message is two hours old', async () => {
		const MOCKED_TIME = 1718882159928;
		const TWO_HOURS_DIFF = 2 * 60 * 60 * 1000;
		jest.setSystemTime( MOCKED_TIME );

		const storageKey = 'ai_chat_messages';
		localStorage.setItem(
			storageKey,
			JSON.stringify( {
				[ runningSite.id ]: [
					{ id: 0, content: 'Initial message 1', role: 'user' },
					{
						id: 1,
						content: 'Initial message 2',
						role: 'assistant',
						createdAt: MOCKED_TIME - TWO_HOURS_DIFF,
					},
				],
			} )
		);

		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
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

		( getIpcApi as jest.Mock ).mockReturnValue( {
			showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
		} );
		act( () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear the history' } ) );
		} );
		jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
		await waitFor(
			() => {
				expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
				expect( screen.queryByText( 'Initial message 1' ) ).not.toBeInTheDocument();
				expect( screen.queryByText( 'Initial message 2' ) ).not.toBeInTheDocument();
			},
			{ timeout: MIMIC_CONVERSATION_DELAY + 1000 }
		);
	} );

	test( 'renders notices by importance', async () => {
		const storageKey = 'ai_chat_messages';
		localStorage.setItem(
			storageKey,
			JSON.stringify( {
				[ runningSite.id ]: [
					{ id: 0, content: 'Initial message 1', role: 'user' },
					{ id: 1, content: 'Initial message 2', role: 'assistant', createdAt: 0 },
				],
			} )
		);

		const { rerender } = render( <ContentTabAssistant selectedSite={ runningSite } /> );
		act( () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear the history' } ) );
			jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
		} );
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

		( usePromptUsage as jest.Mock ).mockReturnValue( {
			userCanSendMessage: false,
			daysUntilReset: 4,
		} );
		rerender( <ContentTabAssistant selectedSite={ runningSite } /> );
		act( () => {
			jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
		} );
		expect(
			screen.getByText( 'Your limit will reset in 4 days.', { exact: false } )
		).toBeVisible();
		expect(
			screen.queryByText( 'This conversation is over two hours old.', { exact: false } )
		).not.toBeInTheDocument();

		( useOffline as jest.Mock ).mockReturnValue( true );
		rerender( <ContentTabAssistant selectedSite={ runningSite } /> );
		act( () => {
			jest.advanceTimersByTime( MIMIC_CONVERSATION_DELAY + 1000 );
		} );
		expect( screen.getByText( 'The AI assistant requires an internet connection.' ) ).toBeVisible();
		expect(
			screen.queryByText( 'Your limit will reset in 4 days.', { exact: false } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'This conversation is over two hours old.', { exact: false } )
		).not.toBeInTheDocument();
	} );
} );
