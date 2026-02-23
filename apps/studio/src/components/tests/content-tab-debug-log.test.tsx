import { render, screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import { ContentTabDebugLog } from 'src/components/content-tab-debug-log';
import { getIpcApi } from 'src/lib/get-ipc-api';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-ipc-listener', () => ( {
	useIpcListener: vi.fn(),
} ) );

const selectedSite: SiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: false,
	phpVersion: '8.3',
	id: 'site-id',
};

describe( 'ContentTabDebugLog', () => {
	const readSiteDebugLog = vi.fn();
	const watchDebugLog = vi.fn();
	const unwatchDebugLog = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			readSiteDebugLog,
			watchDebugLog,
			unwatchDebugLog,
		} );
	} );

	it( 'shows loading state initially', () => {
		readSiteDebugLog.mockReturnValue( new Promise( () => {} ) ); // never resolves
		render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Loading debug log…' ) ).toBeVisible();
	} );

	it( 'shows empty state when debug.log does not exist', async () => {
		readSiteDebugLog.mockResolvedValue( null );
		await act( async () => {
			render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		} );
		await waitFor( () => {
			expect(
				screen.getByText( 'No debug log entries yet. PHP errors and warnings will appear here.' )
			).toBeVisible();
		} );
	} );

	it( 'shows empty state when debug.log is empty', async () => {
		readSiteDebugLog.mockResolvedValue( { lines: [], totalLines: 0 } );
		await act( async () => {
			render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		} );
		await waitFor( () => {
			expect(
				screen.getByText( 'No debug log entries yet. PHP errors and warnings will appear here.' )
			).toBeVisible();
		} );
	} );

	it( 'renders log content after loading', async () => {
		readSiteDebugLog.mockResolvedValue( {
			lines: [ '[error] Something went wrong', '[notice] Site loaded' ],
			totalLines: 2,
		} );
		await act( async () => {
			render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		} );
		await waitFor( () => {
			expect( screen.getByText( /Something went wrong/ ) ).toBeVisible();
			expect( screen.getByText( /Site loaded/ ) ).toBeVisible();
		} );
		expect( screen.getByText( /2 lines/ ) ).toBeVisible();
	} );

	it( 'calls watchDebugLog on mount and unwatchDebugLog on unmount', async () => {
		readSiteDebugLog.mockResolvedValue( { lines: [], totalLines: 0 } );
		const { unmount } = render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		expect( watchDebugLog ).toHaveBeenCalledWith( 'site-id' );
		unmount();
		expect( unwatchDebugLog ).toHaveBeenCalledWith( 'site-id' );
	} );

	it( 'calls readSiteDebugLog with site id and limit', async () => {
		readSiteDebugLog.mockResolvedValue( { lines: [ 'line1' ], totalLines: 1 } );
		await act( async () => {
			render( <ContentTabDebugLog selectedSite={ selectedSite } /> );
		} );
		expect( readSiteDebugLog ).toHaveBeenCalledWith( 'site-id', { limit: 200 } );
	} );
} );
