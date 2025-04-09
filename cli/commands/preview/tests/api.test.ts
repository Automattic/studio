import fs from 'fs';
import wpcom from 'wpcom';
import { uploadArchive, waitForSiteReady, SnapshotStatus } from 'cli/commands/preview/lib/api';
import { LoggerError } from 'cli/logger';

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

		it( 'should throw LoggerError for API errors', async () => {
			const mockError = new Error( 'API error' );
			const mockWpcom = {
				req: {
					post: jest.fn().mockRejectedValue( mockError ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			await expect( uploadArchive( mockArchivePath, mockToken ) ).rejects.toThrow( LoggerError );
			await expect( uploadArchive( mockArchivePath, mockToken ) ).rejects.toMatchObject( {
				message: expect.stringContaining( 'Failed to upload archive: API error' ),
			} );
		} );

		it( 'should throw LoggerError for invalid API response', async () => {
			const invalidResponse = {
				// Missing required fields
				some_field: 'value',
			};

			const mockWpcom = {
				req: {
					post: jest.fn().mockResolvedValue( invalidResponse ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			await expect( uploadArchive( mockArchivePath, mockToken ) ).rejects.toThrow( LoggerError );
			await expect( uploadArchive( mockArchivePath, mockToken ) ).rejects.toMatchObject( {
				message: 'Invalid API response format',
			} );
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
			const pendingResponse = {
				status: SnapshotStatus.Pending,
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
				is_deleted: 'false',
			};

			const activeResponse = {
				status: SnapshotStatus.Active,
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
				is_deleted: 'false',
			};

			const mockWpcom = {
				req: {
					get: jest
						.fn()
						.mockResolvedValueOnce( pendingResponse )
						.mockResolvedValueOnce( activeResponse ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );

		it( 'should throw LoggerError after max attempts', async () => {
			const pendingResponse = {
				status: SnapshotStatus.Pending,
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
				is_deleted: 'false',
			};

			const mockWpcom = {
				req: {
					get: jest.fn().mockResolvedValue( pendingResponse ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			try {
				await waitForSiteReady( mockSiteId, mockToken );
			} catch ( error ) {
				expect( error ).toBeInstanceOf( LoggerError );
				expect( error ).toMatchObject( {
					message: expect.stringContaining( 'Failed to create preview site' ),
				} );
				expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 100 );
			}
		} );

		it( 'should continue polling if API validation fails', async () => {
			const invalidResponse = {}; // Empty response

			const validResponse = {
				status: SnapshotStatus.Active,
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
				is_deleted: 'false',
			};

			const mockWpcom = {
				req: {
					get: jest
						.fn()
						.mockResolvedValueOnce( invalidResponse )
						.mockResolvedValueOnce( validResponse ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );
	} );
} );
