import { renderHook, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useSyncSites } from '../sync-sites';
import { useArchiveSite } from '../use-archive-site';
import { useAuth } from '../use-auth';
import { useSiteDetails } from '../use-site-details';

jest.mock( '../use-auth' );
jest.mock( '../sync-sites' );
jest.mock( '../use-site-details' );
jest.mock( '../../lib/get-ipc-api' );

describe( 'useArchiveSite', () => {
	const LOCAL_SITE_ID = '1658e275-3e68-4aff-a016-2dbf9c5de3db';
	const mockPost = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();

		mockPost.mockImplementation( () => Promise.resolve( {} ) );

		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: { req: { post: mockPost } },
		} ) );

		( useSiteDetails as jest.Mock ).mockImplementation( () => ( {
			uploadingSites: {},
			setUploadingSites: jest.fn(),
		} ) );

		( getIpcApi as jest.Mock ).mockImplementation( () => ( {
			archiveSite: () =>
				Promise.resolve( {
					archivePath: '/tmp/test.zip',
					archiveSizeInBytes: 1000,
				} ),
			getFileContent: () => Promise.resolve( new Uint8Array() ),
			removeTemporalFile: () => Promise.resolve(),
			showErrorMessageBox: () => {},
			getWpVersion: () => Promise.resolve( '6.7.1' ),
		} ) );
	} );

	it( 'should include connected_site_id in form data when a production WPCOM site is connected', async () => {
		( useSyncSites as jest.Mock ).mockImplementation( () => ( {
			connectedSites: [
				{
					id: 240383639,
					localSiteId: LOCAL_SITE_ID,
					name: 'Test Production Site',
					url: 'https://test-site1987.wpcomstaging.com',
					isStaging: false,
					stagingSiteIds: [ 240567528 ],
					syncSupport: 'already-connected',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
				{
					id: 240567528,
					localSiteId: LOCAL_SITE_ID,
					name: 'Test Staging Site',
					url: 'https://staging-9582-test-site1987.wpcomstaging.com',
					isStaging: true,
					stagingSiteIds: [],
					syncSupport: 'already-connected',
					lastPullTimestamp: null,
					lastPushTimestamp: null,
				},
			],
		} ) );

		const { result } = renderHook( () => useArchiveSite() );
		await act( () => result.current.archiveSite( LOCAL_SITE_ID ) );

		const formData = mockPost.mock.calls[ 0 ][ 0 ].formData;
		expect( formData ).toContainEqual( [ 'connected_site_id', 240383639 ] );
	} );

	it( 'should not include connected_site_id in form data when no WPCOM site is connected', async () => {
		( useSyncSites as jest.Mock ).mockImplementation( () => ( {
			connectedSites: [],
		} ) );

		const { result } = renderHook( () => useArchiveSite() );
		await act( () => result.current.archiveSite( LOCAL_SITE_ID ) );

		const formData = mockPost.mock.calls[ 0 ][ 0 ].formData;
		expect(
			formData.find( ( [ key ]: [ string, number ] ) => key === 'connected_site_id' )
		).toBeUndefined();
	} );
} );
