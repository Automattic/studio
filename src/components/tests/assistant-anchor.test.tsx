import { render, screen } from '@testing-library/react';
import { speak } from '@wordpress/a11y';
import Anchor from 'src/components/assistant-anchor';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

jest.mock( '@sentry/electron/renderer' );
jest.mock( 'src/hooks/use-site-details' );
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( '@wordpress/a11y' );

describe( 'Anchor', () => {
	beforeAll( () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {} );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn( () => Promise.resolve() ),
			showErrorMessageBox: jest.fn(),
		} );
	} );

	it( 'should render an anchor element', () => {
		render( <Anchor href="https://example.com" children="Example link" /> );

		expect( screen.getByRole( 'link' ) ).toBeVisible();
	} );

	it( 'should render an anchor element with a custom class', () => {
		render(
			<Anchor href="https://example.com" className="custom-class" children="Example link" />
		);

		expect( screen.getByRole( 'link' ) ).toHaveClass( 'custom-class' );
	} );

	it( 'should not navigate if no href is provided', () => {
		render( <Anchor children="href-less link" /> );

		screen.getByText( 'href-less link' ).click();

		expect( getIpcApi().openURL ).not.toHaveBeenCalled();
	} );

	it( 'should navigate to the provided URL when clicked', () => {
		render( <Anchor href="https://example.com" children="Example link" /> );

		screen.getByRole( 'link' ).click();

		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'https://example.com' );
	} );

	it( "should start the site's server before navigating to a stopped site when clicked", async () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: { id: '1', running: false },
			startServer: jest.fn( () => Promise.resolve() ),
			loadingServer: {},
		} );
		render( <Anchor href="http://localhost:3000" children="Local link" /> );

		screen.getByRole( 'link' ).click();

		expect( speak ).toHaveBeenCalledWith( 'Starting the server before opening the site link' );
		expect( useSiteDetails().startServer ).toHaveBeenCalledWith( '1' );

		// Await asynchronous start server execution
		await new Promise( process.nextTick );

		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'http://localhost:3000' );
	} );

	it( "should communicate background activity while the site's server is starting", () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			selectedSite: { id: '1' },
			loadingServer: { 1: true },
		} );
		render( <Anchor href="http://localhost:3000" children="Example link" /> );

		expect( screen.getByRole( 'link' ) ).toHaveClass( 'animate-pulse', 'cursor-wait' );
	} );

	it( 'should add UTM params when clicking a Telex link', () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {} );
		render( <Anchor href="https://telex.automattic.ai/" children="Telex link" /> );

		screen.getByRole( 'link' ).click();

		expect( getIpcApi().openURL ).toHaveBeenCalledWith(
			expect.stringContaining( 'utm_source=studio' )
		);
		expect( getIpcApi().openURL ).toHaveBeenCalledWith(
			expect.stringContaining( 'utm_medium=app' )
		);
		expect( getIpcApi().openURL ).toHaveBeenCalledWith(
			expect.stringContaining( 'utm_campaign=assistant' )
		);
	} );

	it( 'should not modify non-Telex URLs', () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {} );
		render( <Anchor href="https://wordpress.com/" children="WordPress link" /> );

		screen.getByRole( 'link' ).click();

		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'https://wordpress.com/' );
	} );
} );
