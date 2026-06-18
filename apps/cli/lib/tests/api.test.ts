import fs from 'fs';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import {
	getWpComSites,
	rotateReprintSecret,
	SnapshotStatus,
	uploadArchive,
	waitForSiteReady,
} from 'cli/lib/api';
import { LoggerError } from 'cli/logger';

vi.mock( 'fs' );
vi.mock( 'wpcom' );
vi.mock( 'wpcom-xhr-request' );
vi.mock( '@studio/common/lib/wpcom-factory', () => ( {
	__esModule: true,
	default: vi.fn(),
} ) );

type WpcomReqMethods = Pick< ReturnType< typeof wpcomFactory >[ 'req' ], 'post' | 'get' >;
type WpcomFactory = ReturnType< typeof wpcomFactory >;
const createWpcomMock = ( req: Partial< WpcomReqMethods > ): WpcomFactory =>
	( { req: req } ) as WpcomFactory;

describe( 'API Module', () => {
	const mockArchivePath = '/mock/archive.zip';
	const mockToken = 'mock-token-123';
	const mockWordPressVersion = '6.8.1';
	const mockSiteUrl = 'test-site.wp.build';
	const mockSiteId = 12345;
	const mockReadStream = { pipe: vi.fn() } as unknown as ReturnType< typeof fs.createReadStream >;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( fs, 'createReadStream' ).mockReturnValue( mockReadStream );
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	describe( 'uploadArchive', () => {
		it( 'should successfully upload archive', async () => {
			const mockResponse = {
				domain_name: mockSiteUrl,
				atomic_site_id: mockSiteId,
			};

			const mockWpcom = createWpcomMock( {
				post: vi.fn().mockResolvedValue( mockResponse ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

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
			const mockWpcom = createWpcomMock( {
				post: vi.fn().mockResolvedValue( {
					domain_name: mockSiteUrl,
					atomic_site_id: mockSiteId,
				} ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

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
			const mockWpcom = createWpcomMock( {
				post: vi.fn().mockRejectedValue( mockError ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

			await expect(
				uploadArchive( mockArchivePath, mockToken, mockWordPressVersion )
			).rejects.toThrow( 'Failed to upload archive' );
		} );

		it( 'should throw LoggerError for invalid API response', async () => {
			const invalidResponse = {
				// Missing required fields
				some_field: 'value',
			};

			const mockWpcom = createWpcomMock( {
				post: vi.fn().mockResolvedValue( invalidResponse ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

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

			const mockWpcom = createWpcomMock( {
				get: vi
					.fn()
					.mockResolvedValueOnce( pendingResponse )
					.mockResolvedValueOnce( activeResponse ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

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

			const mockWpcom = createWpcomMock( {
				get: vi.fn().mockResolvedValue( pendingResponse ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

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

			const mockWpcom = createWpcomMock( {
				get: vi
					.fn()
					.mockResolvedValueOnce( invalidResponse )
					.mockResolvedValueOnce( validResponse ),
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( mockWpcom );

			const result = await waitForSiteReady( mockSiteId, mockToken );
			expect( mockWpcom.req.get ).toHaveBeenCalledTimes( 2 );
			expect( result ).toBe( true );
		} );
	} );

	describe( 'rotateReprintSecret', () => {
		it( 'should rotate the WordPress.com secret and return it', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					code: 200,
					body: {
						data: {
							secret: 'rotated-secret',
						},
					},
				} ),
			} as never );

			await expect( rotateReprintSecret( mockSiteId, mockToken ) ).resolves.toBe(
				'rotated-secret'
			);
			expect( fetch ).toHaveBeenCalledWith(
				`https://public-api.wordpress.com/rest/v1.1/jetpack-blogs/${ mockSiteId }/rest-api?http_envelope=1&`,
				expect.objectContaining( {
					method: 'POST',
					headers: expect.objectContaining( {
						Authorization: `Bearer ${ mockToken }`,
					} ),
				} )
			);
		} );

		it( 'should throw when rotating the WordPress.com secret fails', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: false,
				status: 500,
			} as never );

			await expect( rotateReprintSecret( mockSiteId, mockToken ) ).rejects.toThrow(
				'Failed to rotate the WordPress.com site secret'
			);
		} );
	} );

	describe( 'getWpComSites', () => {
		it( 'maps the response to { id, name, url } and excludes deleted and a8c-owned sites', async () => {
			const get = vi.fn().mockResolvedValue( {
				sites: [
					{ ID: 1, name: 'Keep', URL: 'https://keep.example.com' },
					{ ID: 2, name: 'Deleted', URL: 'https://deleted.example.com', is_deleted: true },
					{ ID: 3, name: 'A8c', URL: 'https://a8c.example.com', is_a8c: true },
				],
			} );
			vi.mocked( wpcomFactory ).mockReturnValue( createWpcomMock( { get } ) );

			const sites = await getWpComSites( mockToken );

			expect( sites ).toEqual( [ { id: 1, name: 'Keep', url: 'https://keep.example.com' } ] );
			expect( get ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/me/sites' } ),
				expect.objectContaining( { fields: 'ID,name,URL,is_deleted,is_a8c' } )
			);
		} );
	} );
} );
