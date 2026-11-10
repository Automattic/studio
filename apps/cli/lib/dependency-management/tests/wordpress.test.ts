/** @vitest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadFile } from '@studio/common/lib/download-file';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getWordPressVersionPath, getWpFilesPath } from '../paths';
import { downloadWordPress } from '../wordpress';

vi.mock( '@studio/common/lib/download-file' );
vi.mock( '../paths' );

let root: string;
beforeEach( async () => {
	root = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-wp-cache-' ) );
	vi.mocked( getWordPressVersionPath ).mockImplementation( ( version ) =>
		path.join( root, version )
	);
	vi.mocked( getWpFilesPath ).mockReturnValue( path.join( root, 'wp-files' ) );
	await fs.mkdir( path.join( root, 'latest/wp-includes' ), { recursive: true } );
	await fs.writeFile(
		path.join( root, 'latest/wp-includes/version.php' ),
		"<?php $wp_version = '7.1.4';"
	);
	await fs.writeFile( path.join( root, 'latest/wp-load.php' ), 'cached WordPress' );
	vi.mocked( downloadFile ).mockRejectedValue( new Error( 'Download attempted' ) );
} );

afterEach( async () => {
	await fs.rm( root, { recursive: true, force: true } );
} );

it.each( [ false, true ] )(
	'reuses an identical cached latest version without downloading (symlink: %s)',
	async ( symlink ) => {
		if ( symlink ) {
			await fs.rename( path.join( root, 'latest' ), path.join( root, 'bundled' ) );
			await fs.symlink( path.join( root, 'bundled' ), path.join( root, 'latest' ), 'junction' );
		}
		await downloadWordPress( '7.1.4' );
		expect( await fs.readFile( path.join( root, '7.1.4/wp-load.php' ), 'utf8' ) ).toBe(
			'cached WordPress'
		);
		expect(
			await fs.readFile( path.join( root, '7.1.4/wp-includes/version.php' ), 'utf8' )
		).toContain( "'7.1.4'" );
		await fs.writeFile( path.join( root, 'latest/wp-load.php' ), 'updated latest' );
		expect( await fs.readFile( path.join( root, '7.1.4/wp-load.php' ), 'utf8' ) ).toBe(
			'cached WordPress'
		);
		expect( downloadFile ).not.toHaveBeenCalled();
	}
);

it( 'downloads when the cached latest version does not match', async () => {
	await expect( downloadWordPress( '7.1.3' ) ).rejects.toThrow( 'Download attempted' );
	expect( downloadFile ).toHaveBeenCalledOnce();
} );

it( 'honors an explicit request to download again', async () => {
	await expect( downloadWordPress( '7.1.4', true ) ).rejects.toThrow( 'Download attempted' );
	expect( downloadFile ).toHaveBeenCalledOnce();
} );

it( 'uses matching bundled WordPress when the cached latest version differs', async () => {
	await fs.mkdir( path.join( root, 'wp-files/latest' ), { recursive: true } );
	await fs.rename( path.join( root, 'latest' ), path.join( root, 'wp-files/latest/wordpress' ) );
	await downloadWordPress( '7.1.4' );
	expect( await fs.readFile( path.join( root, '7.1.4/wp-load.php' ), 'utf8' ) ).toBe(
		'cached WordPress'
	);
	expect( downloadFile ).not.toHaveBeenCalled();
} );
