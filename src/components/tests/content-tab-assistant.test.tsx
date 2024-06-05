import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAuth } from '../../hooks/use-auth';
import { ContentTabAssistant } from '../content-tab-assistant';

jest.mock( '../../hooks/use-theme-details' );
jest.mock( '../../hooks/use-auth' );

const runningSite = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
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

		const textInput = screen.getByPlaceholderText( 'Ask Studio WordPress Assistant' );
		expect( textInput ).toBeInTheDocument();
		expect( textInput ).toBeEnabled();
	} );

	test( 'clears input and chat history when MenuIcon is clicked', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = screen.getByPlaceholderText(
			'Ask Studio WordPress Assistant'
		) as HTMLInputElement;
		const menuIcon = screen.getByLabelText( 'menu' );

		fireEvent.change( textInput, { target: { value: 'Hello, Assistant!' } } );
		expect( textInput.value ).toBe( 'Hello, Assistant!' );

		fireEvent.click( menuIcon );
		expect( textInput.value ).toBe( '' );

		expect( screen.queryByText( 'Hello, Assistant!' ) ).not.toBeInTheDocument();
	} );

	test( 'saves and retrieves conversation from localStorage', async () => {
		const storageKey = `${ runningSite.name }`;
		localStorage.setItem( storageKey, JSON.stringify( initialMessages ) );

		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		expect( screen.getByText( 'Initial message 1' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Initial message 2' ) ).toBeInTheDocument();

		const textInput = screen.getByPlaceholderText(
			'Ask Studio WordPress Assistant'
		) as HTMLInputElement;

		fireEvent.change( textInput, { target: { value: 'New message' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		expect( screen.getByText( 'New message' ) ).toBeInTheDocument();

		await waitFor( () => {
			const storedMessages = JSON.parse( localStorage.getItem( storageKey ) || '[]' );
			expect( storedMessages ).toHaveLength( 3 );
			expect( storedMessages[ 2 ].content ).toBe( 'New message' );
		} );
	} );

	// Temporarily skip this test until the input placeholder text is updated
	// to 'What do you want to learn?' in a subsequent PR (or implement a testid on the input)
	test.skip( 'renders assistant chat when authenticated', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		expect( screen.getByText( 'What do you want to learn?' ) ).toBeInTheDocument();
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

	test( 'clicks login button when not authenticated', () => {
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

	test( 'disables input and buttons when offline or not authenticated', () => {
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

		const textInput = screen.getByPlaceholderText( 'Ask Studio WordPress Assistant' );
		const menuIcon = screen.getByLabelText( 'menu' );

		expect( textInput ).toBeDisabled();
		expect( menuIcon ).toBeDisabled();
	} );
} );
