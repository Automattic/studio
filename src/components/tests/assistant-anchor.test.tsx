import { render, screen } from '@testing-library/react';
import { speak } from '@wordpress/a11y';
import { vi } from 'vitest';
import Anchor from 'src/components/assistant-anchor';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

const mockOpenURL = vi.fn( () => Promise.resolve() );
const mockShowErrorMessageBox = vi.fn();

vi.mock( '@sentry/electron/renderer' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		openURL: mockOpenURL,
		showErrorMessageBox: mockShowErrorMessageBox,
	} ),
} ) );
vi.mock( '@wordpress/a11y' );

const createMockSiteDetails = ( overrides = {} ): SiteDetails =>
	( {
		id: '1',
		name: 'Test Site',
		path: '/test/path',
		port: 3000,
		phpVersion: '8.0',
		running: false,
		...overrides,
	} ) as SiteDetails;

describe( 'Anchor', () => {
	beforeEach( () => {
		mockOpenURL.mockClear();
		mockShowErrorMessageBox.mockClear();
		vi.mocked( useSiteDetails ).mockReturnValue(
			{} as Partial< ReturnType< typeof useSiteDetails > > as ReturnType< typeof useSiteDetails >
		);
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
		vi.mocked( useSiteDetails ).mockReturnValue( {
			selectedSite: createMockSiteDetails(),
			startServer: vi.fn( () => Promise.resolve() ),
			loadingServer: {},
		} as Partial< ReturnType< typeof useSiteDetails > > as ReturnType< typeof useSiteDetails > );
		render( <Anchor href="http://localhost:3000" children="Local link" /> );

		screen.getByRole( 'link' ).click();

		expect( speak ).toHaveBeenCalledWith( 'Starting the server before opening the site link' );
		expect( useSiteDetails().startServer ).toHaveBeenCalledWith( '1' );

		// Await asynchronous start server execution
		await new Promise( process.nextTick );

		expect( getIpcApi().openURL ).toHaveBeenCalledWith( 'http://localhost:3000' );
	} );

	it( "should communicate background activity while the site's server is starting", () => {
		vi.mocked( useSiteDetails ).mockReturnValue( {
			selectedSite: createMockSiteDetails(),
			loadingServer: { 1: true },
		} as Partial< ReturnType< typeof useSiteDetails > > as ReturnType< typeof useSiteDetails > );
		render( <Anchor href="http://localhost:3000" children="Example link" /> );

		expect( screen.getByRole( 'link' ) ).toHaveClass( 'animate-pulse', 'cursor-wait' );
	} );
} );
