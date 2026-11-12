import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter, installReprintPublicKey } from '../reprint';

const mockToken = 'mock-token-123';
const mockSiteId = 12345;

beforeEach( () => {
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

		await expect( installReprintPublicKey( mockSiteId, mockToken, 'MIIBojANBg' ) ).rejects.toThrow(
			'Failed to install the migration key on the WordPress.com site'
		);
	} );
} );

describe( 'enableReprintExporter', () => {
	it( 'reports a key when enable-export opens the window', async () => {
		vi.mocked( fetch ).mockResolvedValue( {
			ok: true,
			json: vi.fn().mockResolvedValue( { code: 200, body: { enabled: true } } ),
		} as never );

		await expect( enableReprintExporter( mockSiteId, mockToken ) ).resolves.toBe( true );
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

		await expect( enableReprintExporter( mockSiteId, mockToken ) ).resolves.toBe( false );
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
