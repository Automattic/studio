import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter, installReprintPublicKey } from 'cli/lib/api';
import * as migrationClient from 'cli/lib/pull/migration-client';
import { ensureReprintKey } from './reprint-key';
import { emptyReprintMetadata } from './reprint-metadata';

vi.mock( 'cli/lib/api', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/api') >() ),
	enableReprintExporter: vi.fn(),
	installReprintPublicKey: vi.fn(),
} ) );

const apiUrl = 'https://example.com/?reprint-api-jetpack';
const stateDirectory = '/state';
const storedKey = {
	id: 'c1c08fadfa3a465c',
	path: '/state/remotes/abc/key.pem',
	publicKey: 'STORED-PUBLIC-KEY',
};

/**
 * Answers `pull-metadata` with the given stored key and `keygen` with a new
 * one, the way Reprint reports them when stdout is not a terminal.
 */
function mockReprint( key: typeof storedKey | null ) {
	return vi
		.spyOn( migrationClient, 'runReprintCommandUntilComplete' )
		.mockImplementation( async ( args ) => {
			if ( args[ 0 ] === 'pull-metadata' ) {
				return {
					stdout: JSON.stringify( { ...emptyReprintMetadata, key } ),
					stderr: '',
					exitCode: 0,
				};
			}
			if ( args[ 0 ] === 'keygen' ) {
				return {
					stdout: '',
					stderr: '',
					exitCode: 0,
					report: {
						type: 'reprint_report',
						command: 'keygen',
						status: 'complete',
						exit_code: 0,
						error: null,
						error_code: null,
						key_id: 'new-key-id',
						key_path: '/state/remotes/abc/key.pem',
						public_key: 'NEW-PUBLIC-KEY',
					},
				};
			}
			throw new Error( `Unexpected reprint command: ${ args[ 0 ] }` );
		} );
}

function ensureKey( hasPublicKey: boolean ) {
	return ensureReprintKey( {
		wpComSiteId: 22,
		wpComAccessToken: 'token',
		exporter: { hasPublicKey },
		apiUrl,
		stateDirectory,
		verbose: false,
	} );
}

describe( 'ensureReprintKey', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
		vi.mocked( enableReprintExporter ).mockReset();
		vi.mocked( installReprintPublicKey ).mockReset();
	} );

	it( 'generates and installs a key when none is stored, then opens the export window', async () => {
		const reprint = mockReprint( null );
		vi.mocked( enableReprintExporter ).mockResolvedValue( { hasPublicKey: true } );

		await expect( ensureKey( false ) ).resolves.toBeUndefined();

		expect( reprint.mock.calls.map( ( call ) => call[ 0 ] ) ).toEqual( [
			[ 'pull-metadata', apiUrl, `--state-dir=${ stateDirectory }` ],
			[ 'keygen', apiUrl, `--state-dir=${ stateDirectory }` ],
		] );
		expect( installReprintPublicKey ).toHaveBeenCalledWith( 22, 'token', 'NEW-PUBLIC-KEY' );
		expect( enableReprintExporter ).toHaveBeenCalledWith( 22, 'token', false );
	} );

	it( 'installs a newly generated key over a key the site already has', async () => {
		mockReprint( null );

		await expect( ensureKey( true ) ).resolves.toBeUndefined();

		expect( installReprintPublicKey ).toHaveBeenCalledWith( 22, 'token', 'NEW-PUBLIC-KEY' );
		// The window is already open, so there is no need to enable it again.
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'reuses the stored key without touching the site when the site has a key', async () => {
		const reprint = mockReprint( storedKey );

		await expect( ensureKey( true ) ).resolves.toBeUndefined();

		expect( reprint.mock.calls.map( ( call ) => call[ 0 ][ 0 ] ) ).toEqual( [ 'pull-metadata' ] );
		expect( installReprintPublicKey ).not.toHaveBeenCalled();
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'installs the stored key again when the site has no key', async () => {
		const reprint = mockReprint( storedKey );
		vi.mocked( enableReprintExporter ).mockResolvedValue( { hasPublicKey: true } );

		await expect( ensureKey( false ) ).resolves.toBeUndefined();

		expect( reprint.mock.calls.map( ( call ) => call[ 0 ][ 0 ] ) ).toEqual( [ 'pull-metadata' ] );
		expect( installReprintPublicKey ).toHaveBeenCalledWith( 22, 'token', 'STORED-PUBLIC-KEY' );
		expect( enableReprintExporter ).toHaveBeenCalled();
	} );

	it( 'fails when the site still reports no key after the install', async () => {
		mockReprint( null );
		vi.mocked( enableReprintExporter ).mockResolvedValue( { hasPublicKey: false } );

		await expect( ensureKey( false ) ).rejects.toThrow( 'did not accept the migration key' );
	} );
} );
