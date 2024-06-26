import * as Sentry from '@sentry/electron/renderer';
import { render, screen } from '@testing-library/react';
import { speak } from '@wordpress/a11y';
import { useSiteDetails } from '../../hooks/use-site-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import Anchor from '../assistant-anchor';

jest.mock( '@sentry/electron/renderer' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../lib/get-ipc-api' );
jest.mock( '@wordpress/a11y' );

describe( 'Anchor', () => {
	beforeAll( () => {
		( useSiteDetails as jest.Mock ).mockReturnValue( {} );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn( () => Promise.resolve() ),
			showMessageBox: jest.fn(),
		} );
	} );

	it( 'should render an anchor element', () => {
		render( <Anchor href="https://example.com" children="Example link" /> );

		expect( screen.getByRole( 'link' ) ).toBeInTheDocument();
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
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn( () => Promise.resolve() ),
			showMessageBox: jest.fn(),
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

	it( 'should gracefully handle link open failures', async () => {
		( getIpcApi as jest.Mock ).mockReturnValue( {
			openURL: jest.fn( () => Promise.reject( new Error( 'Failed to open link' ) ) ),
			showMessageBox: jest.fn(),
		} );
		render( <Anchor href="https://example.com" children="Example link" /> );

		screen.getByRole( 'link' ).click();

		// Await asynchronous openURL execution
		await new Promise( process.nextTick );

		expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith( {
			type: 'error',
			message: 'Failed to open link',
			detail: 'We were unable to open the link. Please try again.',
			buttons: [ 'OK' ],
		} );
		expect( Sentry.captureException ).toHaveBeenCalled();
	} );
} );
