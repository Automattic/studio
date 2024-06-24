import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuth } from '../../hooks/use-auth';
import { useFetchWelcomeMessages } from '../../hooks/use-fetch-welcome-messages';
import { ContentTabAssistant } from '../content-tab-assistant';

jest.mock( '../../hooks/use-theme-details' );
jest.mock( '../../hooks/use-auth' );
jest.mock( '../../hooks/use-fetch-welcome-messages' );

jest.mock( '../../lib/app-globals', () => ( {
	getAppGlobals: () => ( {
		locale: jest.fn,
	} ),
} ) );

const mockFetchWelcomeMessages = jest.fn();
( useFetchWelcomeMessages as jest.Mock ).mockReturnValue( {
	messages: [ 'Welcome to our service!', 'How can I help you today?' ],
	examplePrompts: [
		'How to create a WordPress site',
		'How to clear cache',
		'How to install a plugin',
	],
	fetchWelcomeMessages: mockFetchWelcomeMessages,
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
	{ content: 'Initial message 1', role: 'user' },
	{ content: 'Initial message 2', role: 'assistant' },
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

	const getInput = () =>
		screen.getByPlaceholderText( 'What would you like to learn?' ) as HTMLTextAreaElement;

	const getGuidelinesLink = () => screen.getByTestId( 'guidelines-link' ) as HTMLAnchorElement;

	beforeEach( () => {
		jest.clearAllMocks();
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		localStorage.clear();
		jest.useFakeTimers();
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
		} ) );
	} );

	test( 'renders placeholder text input', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		const textInput = getInput();
		expect( textInput ).toBeInTheDocument();
		expect( textInput ).toBeEnabled();
		expect( textInput.placeholder ).toBe( 'What would you like to learn?' );
	} );

	test( 'renders guideline section', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		const guideLines = getGuidelinesLink();
		expect( guideLines ).toBeInTheDocument();
		expect( guideLines ).toHaveTextContent( 'Powered by experimental AI. Learn more' );
	} );

	test( 'saves and retrieves conversation from localStorage', async () => {
		const storageKey = `ai_chat_messages_${ runningSite.id }`;
		localStorage.setItem( storageKey, JSON.stringify( initialMessages ) );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.getByText( 'Initial message 1' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Initial message 2' ) ).toBeInTheDocument();
		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'New message' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );
		expect( screen.getByText( 'New message' ) ).toBeInTheDocument();
		await waitFor( () => {
			const storedMessages = JSON.parse( localStorage.getItem( storageKey ) || '[]' );
			expect( storedMessages ).toHaveLength( 3 );
			expect( storedMessages[ 2 ].content ).toBe( 'New message' );
		} );
	} );

	test( 'renders default message when not authenticated', () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} ) );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.getByText( 'Hold up!' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'You need to log in to your WordPress.com account to use the assistant.' )
		).toBeInTheDocument();
	} );

	test( 'allows authentication from Assistant chat', () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} ) );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( loginButton ).toBeInTheDocument();
		fireEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'it stores messages with user-unique keys', async () => {
		const user1 = { id: 'mock-user-1' };
		const user2 = { id: 'mock-user-2' };
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
			user: user1,
		} ) );
		const { rerender } = render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = getInput();
		fireEvent.change( textInput, { target: { value: 'New message' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		expect( screen.getByText( 'New message' ) ).toBeVisible();

		// Simulate user authentication change
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: true,
			authenticate,
			user: user2,
		} ) );

		rerender( <ContentTabAssistant selectedSite={ runningSite } /> );

		expect( screen.queryByText( 'New message' ) ).toBeNull();
	} );

	test( 'does not render the Welcome messages and example prompts when not authenticated', () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
			isAuthenticated: false,
			authenticate,
		} ) );
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( screen.getByText( 'Hold up!' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Welcome to our service!' ) ).not.toBeInTheDocument();
	} );

	test( 'confirm that Welcome messages and example prompts are present when the conversation is started', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );
		expect( mockFetchWelcomeMessages ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Welcome to our service!' ) ).toBeInTheDocument();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeInTheDocument();
		expect( screen.getByText( 'How to clear cache' ) ).toBeInTheDocument();
		expect( screen.getByText( 'How to install a plugin' ) ).toBeInTheDocument();
	} );

	test( 'confirm that Welcome messages are present, the selected prompt is present, other prompts are removed', async () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		expect( await screen.findByText( 'Welcome to our service!' ) ).toBeInTheDocument();
		expect( await screen.findByText( 'How to create a WordPress site' ) ).toBeInTheDocument();
		expect( await screen.findByText( 'How to install a plugin' ) ).toBeInTheDocument();

		const samplePrompt = await screen.findByRole( 'button', {
			name: 'How to create a WordPress site',
		} );
		expect( samplePrompt ).toBeInTheDocument();
		fireEvent.click( samplePrompt );

		// Check if the selected prompt is still present and other prompts are removed
		expect( screen.getByText( 'Welcome to our service!' ) ).toBeInTheDocument();
		expect( screen.getByText( 'How to create a WordPress site' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'How to clear cache' ) ).not.toBeInTheDocument();
	} );
} );
