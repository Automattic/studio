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

( useFetchWelcomeMessages as jest.Mock ).mockReturnValue( {
	messages: [ 'Welcome to our service!', 'How can I help you today?' ],
	examplePrompts: [ 'Create a WordPress site' ],
	fetchWelcomeMessages: jest.fn(),
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
} );
