import fs from 'fs';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcom from 'wpcom';
import { uploadArchive, waitForSiteReady, SnapshotStatus } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'wpcom' );
jest.mock( 'common/lib/get-wordpress-version' );
jest.mock( 'wpcom-xhr-request' );

describe( 'API Module', () => {
	const mockArchivePath = '/mock/archive.zip';
	const mockToken = 'mock-token-123';
	const mockWordPressVersion = '6.8.1';
	const mockSiteUrl = 'test-site.wp.build';
	const mockSiteId = 12345;
	const mockReadStream = { pipe: jest.fn() };

	beforeEach( () => {
		jest.clearAllMocks();
		( fs.createReadStream as jest.Mock ).mockReturnValue( mockReadStream );
	} );

	describe( 'uploadArchive', () => {
		it( 'should successfully upload archive', async () => {
			( getWordPressVersion as jest.Mock ).mockResolvedValue( '' );
			const mockResponse = {
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
			};

			const mockWpcom = {
				req: {
					post: jest.fn().mockResolvedValue( mockResponse ),
				},
			};
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await uploadArchive( mockArchivePath, mockToken, mockWordPressVersion );

			expect( wpcomFactory ).toHaveBeenCalledWith( mockToken, expect.anything() );
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

		it( 'should successfully send wordpress_version to create new site from zip', async () => {
			const mockWpcom = {
				req: {
					post: jest.fn().mockResolvedValue( {
						domain_name: mockSiteUrl,
						atomic_site_id: mockSiteId,
					} ),
				},
			};
			( wpcom as jest.Mock ).mockReturnValue( mockWpcom );
			( getWordPressVersion as jest.Mock ).mockResolvedValue( '6.8.1' );

			await uploadArchive( mockArchivePath, mockToken, mockWordPressVersion );
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
					[ 'wordpress_version', '6.8.1' ],
				],
			} );
		} );

		it( 'should throw LoggerError for API errors', async () => {
			const mockError = new Error( 'API error' );
			const mockWpcom = {
				req: {
					post: jest.fn().mockRejectedValue( mockError ),
				},
			};
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

			await expect(
				uploadArchive( mockArchivePath, mockToken, mockWordPressVersion )
			).rejects.toThrow( 'Failed to upload archive' );
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
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

			await expect(
				uploadArchive( mockArchivePath, mockToken, mockWordPressVersion )
			).rejects.toThrow( 'Invalid API response format' );
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
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

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
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

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
			( wpcomFactory as jest.Mock ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );
	} );
} );
