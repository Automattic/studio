import fs from 'fs';
import { downloadFile } from '@studio/common/lib/download-file';
import { extractZip } from '@studio/common/lib/extract-zip';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getWordPressVersionPath } from '../paths';
import { updateLatestWordPressVersion } from '../wordpress';

vi.mock( 'fs', () => ( {
	default: {
		existsSync: vi.fn(),
		promises: {
			readdir: vi.fn(),
			readFile: vi.fn(),
			mkdir: vi.fn(),
			cp: vi.fn(),
			rm: vi.fn(),
		},
	},
} ) );

vi.mock( '@studio/common/lib/download-file', () => ( { downloadFile: vi.fn() } ) );
vi.mock( '@studio/common/lib/extract-zip', () => ( { extractZip: vi.fn() } ) );
vi.mock( '@studio/common/lib/fs-utils', () => ( { recursiveCopyDirectory: vi.fn() } ) );
vi.mock( '../paths', () => ( {
	getWordPressVersionPath: vi.fn(
		( version: string ) => `/server-files/wordpress-versions/${ version }`
	),
} ) );

const STABLE_CHECK_URL = 'https://api.wordpress.org/core/stable-check/1.0/';

function mockStableCheck( body: Record< string, string > ) {
	vi.spyOn( global, 'fetch' ).mockResolvedValue( {
		json: async () => body,
	} as Response );
}

describe( 'updateLatestWordPressVersion', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [ 'wp-includes' ] as never );
		vi.mocked( fs.promises.readFile ).mockResolvedValue( "<?php $wp_version = '6.9.5';" as never );
		mockStableCheck( { '6.9.5': 'latest' } );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'replaces the cached copy when wordpress.org reports a newer release', async () => {
		mockStableCheck( { '6.9.5': 'outdated', '6.9.7': 'latest' } );

		await updateLatestWordPressVersion();

		// The outgoing release is kept under its own version number, so a site
		// pinned to it doesn't have to download it again.
		expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
			getWordPressVersionPath( 'latest' ),
			getWordPressVersionPath( '6.9.5' )
		);
		expect( downloadFile ).toHaveBeenCalledTimes( 1 );
		expect( extractZip ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves the cached copy alone when it is already the current release', async () => {
		mockStableCheck( { '6.9.5': 'latest' } );

		await updateLatestWordPressVersion();

		expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
		expect( downloadFile ).not.toHaveBeenCalled();
	} );

	it( 'throws when wordpress.org is unreachable instead of serving the stale copy', async () => {
		vi.spyOn( global, 'fetch' ).mockRejectedValue( new Error( 'network' ) );

		await expect( updateLatestWordPressVersion() ).rejects.toThrow( 'network' );
		expect( downloadFile ).not.toHaveBeenCalled();
	} );

	it( 'throws when wordpress.org reports no latest release', async () => {
		mockStableCheck( { '6.9.5': 'outdated' } );

		await expect( updateLatestWordPressVersion() ).rejects.toThrow(
			'did not report a latest WordPress version'
		);
		expect( downloadFile ).not.toHaveBeenCalled();
	} );

	it( 'downloads without a version check when nothing is cached yet', async () => {
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [] as never );
		vi.mocked( fs.existsSync ).mockReturnValue( false );

		await updateLatestWordPressVersion();

		expect( global.fetch ).not.toHaveBeenCalled();
		expect( downloadFile ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'queries the documented stable-check endpoint', async () => {
		mockStableCheck( { '6.9.5': 'latest' } );

		await updateLatestWordPressVersion();

		expect( global.fetch ).toHaveBeenCalledWith( STABLE_CHECK_URL );
	} );
} );
