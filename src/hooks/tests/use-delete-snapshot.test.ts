// To run tests, execute `npm run test -- src/hooks/use-delete-snapshot.test.ts` from the root directory
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '../../hooks/use-auth';
import { useSiteDetails } from '../../hooks/use-site-details';
import { useDeleteSnapshot } from '../use-delete-snapshot';

jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-auth' );

describe( 'useDeleteSnapshot', () => {
	// Mock data and responses
	const mockSnapshot = { atomicSiteId: 12345 };
	const mockSnapshots = [
		{
			atomicSiteId: 12345,
		},
		{
			atomicSiteId: 67890,
		},
	];
	const mockResponse = { message: 'Site deleted successfully.' };
	const statusDeletedMockedResponse = { is_deleted: 1 };
	const clientReqPost = jest.fn().mockResolvedValue( mockResponse );
	const clientReqGet = jest.fn().mockResolvedValue( statusDeletedMockedResponse );
	const removeSnapshotMock = jest.fn();
	const updateSnapshotMock = jest.fn();
	beforeEach( () => {
		jest.useFakeTimers();
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
					get: clientReqGet,
				},
			},
		} ) );
	} );

	afterEach( () => {
		jest.clearAllMocks();
		jest.useRealTimers();
	} );

	it( 'Test all the functions to delete an snapshot are called and the isLoading state is false', async () => {
		( useSiteDetails as jest.Mock ).mockImplementation( () => ( {
			snapshots: [ { ...mockSnapshot, isDeleting: true } ],
			removeSnapshot: removeSnapshotMock,
			updateSnapshot: updateSnapshotMock,
		} ) );
		const { result } = renderHook( () => useDeleteSnapshot() );

		await act( async () => {
			expect( result.current.isLoading ).toBe( false );
			await result.current.deleteSnapshot( mockSnapshot );
			jest.advanceTimersByTime( 3000 );
		} );

		expect( result.current.isLoading ).toBe( false );
		// Delete the snapshot site remotely
		expect( clientReqPost ).toHaveBeenCalledWith( {
			path: '/jurassic-ninja/delete',
			apiNamespace: 'wpcom/v2',
			body: { site_id: mockSnapshot.atomicSiteId },
		} );

		expect( updateSnapshotMock ).toHaveBeenCalledWith( {
			...mockSnapshot,
			isDeleting: true,
		} );

		expect( clientReqGet ).toHaveBeenCalledWith( '/jurassic-ninja/status', {
			apiNamespace: 'wpcom/v2',
			site_id: 12345,
		} );
		// Remove the snapshot from the local state appdata
		expect( removeSnapshotMock ).toHaveBeenCalledWith( {
			...mockSnapshot,
			isDeleting: true,
		} );
	} );

	it( 'Test deleteAllSnapshots function deletes all snapshots and the loadingDeletingAllSnapshots state is false', async () => {
		( useSiteDetails as jest.Mock ).mockImplementation( () => ( {
			snapshots: mockSnapshots.map( ( snapshot ) => ( { ...snapshot, isDeleting: true } ) ),
			removeSnapshot: removeSnapshotMock,
			updateSnapshot: updateSnapshotMock,
		} ) );
		const { result } = renderHook( () => useDeleteSnapshot() );

		await act( async () => {
			expect( result.current.loadingDeletingAllSnapshots ).toBe( false );
			const promise = result.current.deleteAllSnapshots( mockSnapshots );
			jest.advanceTimersByTime( 3000 );
			await promise;
		} );

		expect( clientReqPost ).toHaveBeenCalledTimes( mockSnapshots.length );
		expect( clientReqGet ).toHaveBeenCalledTimes( mockSnapshots.length );
		mockSnapshots.forEach( ( snapshot, index ) => {
			expect( clientReqPost ).toHaveBeenNthCalledWith( index + 1, {
				path: '/jurassic-ninja/delete',
				apiNamespace: 'wpcom/v2',
				body: { site_id: snapshot.atomicSiteId },
			} );

			expect( updateSnapshotMock ).toHaveBeenNthCalledWith( index + 1, {
				...snapshot,
				isDeleting: true,
			} );

			expect( clientReqGet ).toHaveBeenNthCalledWith( index + 1, '/jurassic-ninja/status', {
				apiNamespace: 'wpcom/v2',
				site_id: snapshot.atomicSiteId,
			} );

			expect( removeSnapshotMock ).toHaveBeenNthCalledWith( index + 1, {
				...snapshot,
				isDeleting: true,
			} );
		} );
	} );
} );
