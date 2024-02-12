// To run tests, execute `npm run test -- src/hooks/use-delete-snapshot.test.ts` from the root directory
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '../hooks/use-auth';
import { useSiteDetails } from '../hooks/use-site-details';
import { useDeleteSnapshot } from './use-delete-snapshot';

jest.mock( '../hooks/use-site-details' );
jest.mock( '../hooks/use-auth' );

describe( 'useDeleteSnapshot', () => {
	// Mock data and responses
	const mockSnapshot = { atomicSiteId: 12345 };
	const mockResponse = { message: 'Site deleted successfully.' };
	const clientReqPost = jest.fn().mockResolvedValue( mockResponse );
	const removeSnapshotMock = jest.fn();
	beforeEach( () => {
		( useAuth as jest.Mock ).mockImplementation( () => ( {
			client: {
				req: {
					post: clientReqPost,
				},
			},
		} ) );
		( useSiteDetails as jest.Mock ).mockImplementation( () => ( {
			removeSnapshot: removeSnapshotMock,
		} ) );
	} );

	afterEach( () => {
		jest.clearAllMocks();
	} );

	it( 'Test all the functions to delete an snapshot are called and the isLoading state is false', async () => {
		const { result } = renderHook( () => useDeleteSnapshot() );

		await act( async () => {
			expect( result.current.isLoading ).toBe( false );
			await result.current.deleteSnapshot( mockSnapshot );
		} );

		expect( result.current.isLoading ).toBe( false );
		// Delete the snapshot site remotely
		expect( clientReqPost ).toHaveBeenCalledWith( {
			path: '/jurassic-ninja/delete',
			apiNamespace: 'wpcom/v2',
			body: { site_id: mockSnapshot.atomicSiteId },
		} );
		// Remove the snapshot from the local state appdata
		expect( removeSnapshotMock ).toHaveBeenCalledWith( mockSnapshot );
	} );
} );
