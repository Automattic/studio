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
		} ) );
	} );

	test( 'renders placeholder text input', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = screen.getByPlaceholderText( 'Ask Studio WordPress Assistant' );
		expect( textInput ).toBeInTheDocument();
	} );

	test( 'sends message and receives a simulated response', async () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = screen.getByPlaceholderText(
			'Ask Studio WordPress Assistant'
		) as HTMLInputElement;

		fireEvent.change( textInput, { target: { value: 'Hello, Studio!' } } );
		fireEvent.keyDown( textInput, { key: 'Enter', code: 'Enter' } );

		expect( screen.getByText( 'Hello, Studio!' ) ).toBeInTheDocument();

		await waitFor( () => {
			expect(
				screen.getByText(
					/Welcome to the Studio assistant|What can I help you with today|To install the Jetpack plugin in WordPress|If you prefer to install it via WP-CLI|After installing and activating Jetpack/
				)
			).toBeInTheDocument();
		} );
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
			expect(
				screen.getByText(
					/Welcome to the Studio assistant|What can I help you with today|To install the Jetpack plugin in WordPress|If you prefer to install it via WP-CLI|After installing and activating Jetpack/
				)
			).toBeInTheDocument();
		} );

		await waitFor( () => {
			const storedMessages = JSON.parse( localStorage.getItem( storageKey ) || '[]' );
			expect( storedMessages ).toHaveLength( 3 );
			expect( storedMessages[ 2 ].content ).toBe( 'New message' );
		} );
	} );
} );
