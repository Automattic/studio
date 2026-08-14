import { describe, expect, it } from 'vitest';
import { classifySyncFailure } from '../classify-sync-failure';

describe( 'classifySyncFailure', () => {
	it( 'buckets untranslated system errors by substring', () => {
		expect( classifySyncFailure( new Error( 'ENOSPC: no space left on device' ) ) ).toBe(
			'disk_full'
		);
		expect( classifySyncFailure( new Error( 'read ECONNRESET' ) ) ).toBe( 'network' );
		expect(
			classifySyncFailure( new Error( 'getaddrinfo ENOTFOUND public-api.wordpress.com' ) )
		).toBe( 'network' );
		expect( classifySyncFailure( new Error( 'Import timed out' ) ) ).toBe( 'timeout' );
	} );

	it( 'maps HTTP statuses the call site reports', () => {
		expect( classifySyncFailure( new Error( 'nope' ), { status: 413 } ) ).toBe(
			'payload_too_large'
		);
		expect( classifySyncFailure( new Error( 'nope' ), { status: 401 } ) ).toBe( 'auth' );
		expect( classifySyncFailure( new Error( 'nope' ), { status: 403 } ) ).toBe( 'auth' );
		expect( classifySyncFailure( new Error( 'nope' ), { status: 404 } ) ).toBe( 'not_found' );
	} );

	it( 'falls back to an unrecognised status, then to the phase', () => {
		expect( classifySyncFailure( new Error( 'nope' ), { status: 500, phase: 'upload' } ) ).toBe(
			'upload'
		);
	} );

	it( 'prefers an explicit code over a status, substring, or phase', () => {
		expect(
			classifySyncFailure( new Error( 'read ECONNRESET' ), {
				code: 'sql_import',
				status: 413,
				phase: 'upload',
			} )
		).toBe( 'sql_import' );
	} );

	it( 'prefers a substring match over the phase', () => {
		expect(
			classifySyncFailure( new Error( 'ENOSPC: no space left on device' ), {
				phase: 'local_export',
			} )
		).toBe( 'disk_full' );
	} );

	it( 'ignores a code that is not part of the bucket vocabulary', () => {
		expect( classifySyncFailure( new Error( 'nope' ), { code: 'made_up', phase: 'upload' } ) ).toBe(
			'upload'
		);
	} );

	it( 'uses the phase as the bucket when nothing else identifies the failure', () => {
		expect( classifySyncFailure( new Error( 'nope' ), { phase: 'remote_backup' } ) ).toBe(
			'remote_backup'
		);
		expect( classifySyncFailure( new Error( 'nope' ), { phase: 'storage_write' } ) ).toBe(
			'storage_write'
		);
	} );

	it( 'returns `unknown` for an unrecognised error with no hint', () => {
		expect( classifySyncFailure( new Error( 'something went sideways' ) ) ).toBe( 'unknown' );
	} );

	it( 'tolerates non-Error input without throwing', () => {
		expect( classifySyncFailure( undefined ) ).toBe( 'unknown' );
		expect( classifySyncFailure( null ) ).toBe( 'unknown' );
		expect( classifySyncFailure( 'ENOSPC' ) ).toBe( 'disk_full' );
		expect( classifySyncFailure( { status: 500 } ) ).toBe( 'unknown' );
	} );

	// The bucket is the only thing that ever reaches Tracks — raw sync errors embed
	// site names, URLs, and filesystem paths.
	it( 'never leaks the error message into the returned bucket', () => {
		const reason = classifySyncFailure(
			new Error(
				'ENOSPC: no space left writing /Users/jane/Studio/my-secret-site/wp-content/uploads to https://my-secret-site.wordpress.com'
			)
		);

		expect( reason ).toBe( 'disk_full' );
		expect( reason ).not.toContain( 'jane' );
		expect( reason ).not.toContain( 'my-secret-site' );
		expect( reason ).not.toContain( '/' );
	} );
} );
