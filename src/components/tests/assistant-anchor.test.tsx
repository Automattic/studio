import { render, screen } from '@testing-library/react';
import { speak } from '@wordpress/a11y';
import { vi, type Mock } from 'vitest';
import Anchor from 'src/components/assistant-anchor';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

vi.mock( '@sentry/electron/renderer' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/lib/get-ipc-api' );
vi.mock( '@wordpress/a11y' );

describe( 'Anchor', () => {
	beforeAll( () => {
		( useSiteDetails as Mock ).mockReturnValue( {} );
		( getIpcApi as Mock ).mockReturnValue( {
			openURL: vi.fn( () => Promise.resolve() ),
			showErrorMessageBox: vi.fn(),
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
		( useSiteDetails as Mock ).mockReturnValue( {
			selectedSite: { id: '1', running: false },
			startServer: vi.fn( () => Promise.resolve() ),
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
		( useSiteDetails as Mock ).mockReturnValue( {
			selectedSite: { id: '1' },
			loadingServer: { 1: true },
		} );
		render( <Anchor href="http://localhost:3000" children="Example link" /> );

		expect( screen.getByRole( 'link' ) ).toHaveClass( 'animate-pulse', 'cursor-wait' );
	} );
} );
