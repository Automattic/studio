import fs from 'fs';
import { uploadArchive, waitForSiteReady, SnapshotStatus } from 'cli/lib/api';
import { LoggerError } from 'cli/logger';
import { createMock } from 'src/lib/test-utils';
import wpcomFactory from 'src/lib/wpcom-factory';
import { vi } from 'vitest';

vi.mock( 'fs' );
vi.mock( 'wpcom' );
vi.mock( 'wpcom-xhr-request' );
vi.mock( 'src/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

describe( 'API Module', () => {
	const mockArchivePath = '/mock/archive.zip';
	const mockToken = 'mock-token-123';
	const mockWordPressVersion = '6.8.1';
	const mockSiteUrl = 'test-site.wp.build';
	const mockSiteId = 12345;
	const mockReadStream = { pipe: vi.fn() };

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.createReadStream, { partial: true } ).mockReturnValue( mockReadStream );
	} );

	describe( 'uploadArchive', () => {
		it( 'should successfully upload archive', async () => {
			const mockResponse = {
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
			};

			const mockWpcom = {
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					post: vi.fn().mockResolvedValue( mockResponse ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

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
					[ 'wordpress_version', '6.8.1' ],
				],
			} );
			expect( result ).toEqual( {
				site_url: mockSiteUrl,
				site_id: mockSiteId,
			} );
		} );

		it( 'should successfully send wordpress_version to create new site from zip', async () => {
			const mockWpcom = {
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					post: vi.fn().mockResolvedValue( {
						domain_name: mockSiteUrl,
						atomic_site_id: mockSiteId,
					} ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

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
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					post: vi.fn().mockRejectedValue( mockError ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

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
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					post: vi.fn().mockResolvedValue( invalidResponse ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

			await expect(
				uploadArchive( mockArchivePath, mockToken, mockWordPressVersion )
			).rejects.toThrow( 'Invalid API response format' );
		} );
	} );

	describe( 'waitForSiteReady', () => {
		beforeEach( () => {
			// @ts-expect-error - mock implementation returns number instead of Timeout for simplicity
			vi.spyOn( global, 'setTimeout' ).mockImplementation( ( fn ) => {
				fn();
				return 1;
			} );
		} );

		afterEach( () => {
			vi.restoreAllMocks();
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
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					get: vi
						.fn()
						.mockResolvedValueOnce( pendingResponse )
						.mockResolvedValueOnce( activeResponse ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

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
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					get: vi.fn().mockResolvedValue( pendingResponse ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

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
				req: createMock< ReturnType< typeof wpcomFactory >[ 'req' ] >( {
					get: vi
						.fn()
						.mockResolvedValueOnce( invalidResponse )
						.mockResolvedValueOnce( validResponse ),
				} ),
			};
			vi.mocked( wpcomFactory, { partial: true } ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );
	} );
} );
