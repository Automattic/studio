// To run tests, execute `npm test src/hooks/tests/use-update-demo-site.test.ts` from the root directory
import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useSiteDetails } from '../use-site-details';
import { useUpdateDemoSite, DemoSiteUpdateProvider } from '../use-update-demo-site';

jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-auth' );
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn().mockReturnValue( {
		archiveSite: jest.fn().mockResolvedValue( { zipContent: new Blob( [ 'zipContent' ] ) } ),
		showMessageBox: jest.fn().mockResolvedValue( { response: 1 } ), // Assuming '1' is the cancel button
		getWpVersion: jest.fn().mockResolvedValue( '6.5' ),
	} ),
} ) );
jest.mock( '@sentry/electron/renderer', () => ( {
	captureException: jest.fn(),
} ) );

global.File = jest.fn().mockImplementation( ( blobParts, fileName, options ) => ( {
	...new Blob( blobParts, options ),
	name: fileName,
	type: options.type,
} ) );

const wrapper = ( { children }: { children: ReactNode } ) => (
	<DemoSiteUpdateProvider>{ children }</DemoSiteUpdateProvider>
);

describe( 'useUpdateDemoSite', () => {
	// Mock data and responses
	const mockSnapshot: Snapshot = {
		atomicSiteId: 12345,
		localSiteId: '54321',
		url: '',
		date: 0,
	};
	const mockLocalSite: SiteDetails = {
		name: 'Test Site',
		running: false,
		id: '54321',
		path: '/path/to/site',
	};
	const clientReqPost = jest.fn().mockResolvedValue( {
		data: 'success',
	} );
	const updateSnapshotMock = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
		jest.useFakeTimers();

		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
		} ) );

		( useSiteDetails as jest.Mock ).mockImplementation( () => ( {
			snapshots: [ mockSnapshot ],
			updateSnapshot: updateSnapshotMock,
		} ) );
	} );

	it( 'when an update succeeds, ensure all functions to update a demo site are called', async () => {
		clientReqPost.mockResolvedValue( {
			data: 'success',
		} );

		const { result } = renderHook( () => useUpdateDemoSite(), { wrapper } );

		await act( async () => {
			await result.current.updateDemoSite( mockSnapshot, mockLocalSite );
			jest.advanceTimersByTime( 3000 );
		} );

		// Assert that 'update-site-from-zip' endpoint is correctly called
		expect( clientReqPost ).toHaveBeenCalledWith( {
			path: '/jurassic-ninja/update-site-from-zip',
			apiNamespace: 'wpcom/v2',
			formData: [
				[ 'site_id', mockSnapshot.atomicSiteId ],
				[
					'import',
					expect.objectContaining( {
						name: 'loca-env-site-1.zip',
						type: 'application/zip',
					} ),
				],
				[ 'wordpress_version', '6.5' ],
			],
		} );

		// Assert that 'isDemoSiteUpdating' is set back to false
		expect( result.current.isDemoSiteUpdating ).toBe( false );

		// Assert that demo site is updated with a new expiration date
		expect( updateSnapshotMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				...mockSnapshot,
				date: expect.any( Number ),
			} )
		);
	} );

	it( 'when an update fails, ensure an alert is triggered', async () => {
		clientReqPost.mockRejectedValue( new Error( 'Update failed' ) );

		const { result } = renderHook( () => useUpdateDemoSite(), { wrapper } );

		await act( async () => {
			await result.current.updateDemoSite( mockSnapshot, mockLocalSite );
			jest.advanceTimersByTime( 3000 );
		} );

		// Assert that an alert is displayed to inform users of the failure
		expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( {
				type: 'warning',
			} )
		);

		// Assert that 'isDemoSiteUpdating' is set back to false
		expect( result.current.isDemoSiteUpdating ).toBe( false );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );
} );
