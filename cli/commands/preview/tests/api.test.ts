import fs from 'fs';
import wpcom from 'wpcom';
import { uploadArchive, waitForSiteReady, SnapshotStatus } from 'cli/commands/preview/lib/api';

jest.mock( 'fs' );
jest.mock( 'wpcom' );

describe( 'API Module', () => {
	const mockArchivePath = '/mock/archive.zip';
	const mockToken = 'mock-token-123';
	const mockSiteUrl = 'test-site.wp.build';
	const mockSiteId = 12345;
	const mockReadStream = { pipe: jest.fn() };

	beforeEach( () => {
		jest.clearAllMocks();
		( fs.createReadStream as jest.Mock ).mockReturnValue( mockReadStream );
	} );

	describe( 'uploadArchive', () => {
		it( 'should successfully upload archive', async () => {
			const mockResponse = {
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
			};

			const mockWpcom = {
				req: {
					post: jest.fn().mockResolvedValue( mockResponse ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await uploadArchive( mockArchivePath, mockToken );

			expect( wpcom ).toHaveBeenCalledWith( mockToken );
			expect( mockWpcom.req.post ).toHaveBeenCalledWith( {
				path: '/jurassic-ninja/create-new-site-from-zip',
				apiNamespace: 'wpcom/v2',
				formData: [
					[
						'import',
						mockReadStream,
						{
							filename: 'local-env-site-1.zip',
							contentType: 'application/zip',
						},
					],
				],
			} );
			expect( result ).toEqual( {
				site_url: mockSiteUrl,
				site_id: mockSiteId,
			} );
		} );

		it( 'should handle API errors', async () => {
			const mockError = new Error( 'API error' );
			const mockWpcom = {
				req: {
					post: jest.fn().mockRejectedValue( mockError ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await uploadArchive( mockArchivePath, mockToken );

			expect( result ).toBeInstanceOf( Error );
			expect( ( result as Error ).message ).toBe( 'Failed to upload archive: API error' );
		} );
	} );

	describe( 'waitForSiteReady', () => {
		beforeEach( () => {
			jest.spyOn( global, 'setTimeout' ).mockImplementation( ( fn ) => {
				fn();
				return 1 as unknown as NodeJS.Timeout;
			} );
		} );

		afterEach( () => {
			jest.restoreAllMocks();
		} );

		it( 'should return true when site becomes active', async () => {
			const mockWpcom = {
				req: {
					get: jest
						.fn()
						.mockResolvedValueOnce( { status: SnapshotStatus.Pending } )
						.mockResolvedValueOnce( { status: SnapshotStatus.Active } ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );

		it( 'should timeout after max attempts', async () => {
			const mockWpcom = {
				req: {
					get: jest.fn().mockResolvedValue( { status: SnapshotStatus.Pending } ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );

			expect( result ).toBe( false );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 100 );
		} );
	} );
} );
