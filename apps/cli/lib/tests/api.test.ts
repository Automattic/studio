import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { vi } from 'vitest';
import { enableReprintExporter, getWpComSites, installReprintPublicKey } from 'cli/lib/api';

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
	const mockToken = 'mock-token-123';
	const mockSiteId = 12345;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'fetch', vi.fn() );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	describe( 'installReprintPublicKey', () => {
		it( 'sends the public key as the JSON body of install-public-key', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					code: 200,
					body: {
						key_id: 'c1c08fadfa3a465c',
						export_url: 'https://example.com/?reprint-api-jetpack',
					},
				} ),
			} as never );

			await expect(
				installReprintPublicKey( mockSiteId, mockToken, 'MIIBojANBg' )
			).resolves.toBeUndefined();
			expect( fetch ).toHaveBeenCalledWith(
				`https://public-api.wordpress.com/rest/v1.1/jetpack-blogs/${ mockSiteId }/rest-api?http_envelope=1&`,
				expect.objectContaining( {
					method: 'POST',
					body: JSON.stringify( {
						path: '/jetpack/v4/reprint/install-public-key',
						body: JSON.stringify( { public_key: 'MIIBojANBg' } ),
						json: true,
					} ),
				} )
			);
		} );

		it( 'throws when the site rejects the key', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					code: 400,
					body: { code: 'jetpack_reprint_invalid_public_key', data: { status: 400 } },
				} ),
			} as never );

			await expect( installReprintPublicKey( mockSiteId, mockToken, 'bogus' ) ).rejects.toThrow(
				'Failed to install the migration key on the WordPress.com site'
			);
		} );

		it( 'throws on a transport failure', async () => {
			vi.mocked( fetch ).mockResolvedValue( { ok: false, status: 502 } as never );

			await expect(
				installReprintPublicKey( mockSiteId, mockToken, 'MIIBojANBg' )
			).rejects.toThrow( 'Failed to install the migration key on the WordPress.com site' );
		} );
	} );

	describe( 'enableReprintExporter', () => {
		it( 'reports a key when enable-export opens the window', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( { code: 200, body: { enabled: true } } ),
			} as never );

			await expect( enableReprintExporter( mockSiteId, mockToken ) ).resolves.toEqual( {
				hasPublicKey: true,
			} );
			expect( fetch ).toHaveBeenCalledWith(
				`https://public-api.wordpress.com/rest/v1.1/jetpack-blogs/${ mockSiteId }/rest-api?http_envelope=1&`,
				expect.objectContaining( {
					body: JSON.stringify( { path: '/jetpack/v4/reprint/enable-export' } ),
				} )
			);
		} );

		it( 'tells the user to update Jetpack when the site has no enable-export route', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					code: 200,
					body: { code: 'rest_no_route', data: { status: 404 } },
				} ),
			} as never );

			await expect( enableReprintExporter( mockSiteId, mockToken ) ).rejects.toThrow(
				'Update Jetpack on the site'
			);
		} );

		it( 'reports no key when the site has no public key installed yet', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					// As WordPress.com's Jetpack proxy relays the site's WP_Error.
					code: 409,
					body: {
						error: 'jetpack_reprint_no_credential',
						message: 'Install a public key first.',
						data: { status: 409 },
					},
				} ),
			} as never );

			await expect( enableReprintExporter( mockSiteId, mockToken ) ).resolves.toEqual( {
				hasPublicKey: false,
			} );
		} );

		it( 'throws on a 409 that is not the missing-credential error', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( {
					code: 409,
					body: { code: 'something_else', data: { status: 409 } },
				} ),
			} as never );

			await expect( enableReprintExporter( mockSiteId, mockToken ) ).rejects.toThrow(
				'Failed to enable the reprint exporter'
			);
		} );

		it( 'throws on an unexpected probe status', async () => {
			vi.mocked( fetch ).mockResolvedValue( {
				ok: true,
				json: vi.fn().mockResolvedValue( { code: 500, body: {} } ),
			} as never );

			await expect( enableReprintExporter( mockSiteId, mockToken ) ).rejects.toThrow(
				'Failed to enable the reprint exporter'
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
