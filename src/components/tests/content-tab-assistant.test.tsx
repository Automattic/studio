import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContentTabAssistant } from '../content-tab-assistant';

jest.mock( '../../hooks/use-theme-details' );

const runningSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	id: 'site-id',
	url: 'http://example.com',
};

const initialMessages = [
	{ text: 'Initial message 1', isUser: true },
	{ text: 'Initial message 2', isUser: false },
];

describe( 'ContentTabAssistant', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		localStorage.clear();
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

	test( 'clears input when MenuIcon is clicked', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = screen.getByPlaceholderText(
			'Ask Studio WordPress Assistant'
		) as HTMLInputElement;
		const menuIcon = screen.getByLabelText( 'menu' );

		fireEvent.change( textInput, { target: { value: 'Hello, Assistant!' } } );
		expect( textInput.value ).toBe( 'Hello, Assistant!' );

		fireEvent.click( menuIcon );
		expect( textInput.value ).toBe( '' );
	} );

	test( 'saves and retrieves conversation from localStorage', async () => {
		localStorage.setItem( runningSite.name, JSON.stringify( initialMessages ) );

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
			const storedMessages = JSON.parse( localStorage.getItem( runningSite.name ) || '[]' );
			expect( storedMessages ).toHaveLength( 4 );
			expect( storedMessages[ 2 ].text ).toBe( 'New message' );
		} );
	} );
} );
