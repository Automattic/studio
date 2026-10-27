/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent, shell } from 'electron';
import { existsSync } from 'fs';
import { normalize } from 'path';
import { readSitePath } from '@studio/common/sites/site-path';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { getFileSize, openURL, readBlueprintFile } from 'src/ipc-handlers';

vi.mock( 'fs' );
vi.mock( 'fs/promises', async () => {
	const { fs } = await import( 'memfs' );
	return { default: fs.promises };
} );
vi.mock( '@studio/common/sites/site-path' );

beforeEach( () => {
	vol.reset();
} );

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

describe( 'readBlueprintFile', () => {
	it( 'deletes the temporary deep-link file after reading it', async () => {
		const filePath = normalize( '/mock/path/wp-studio-blueprints/blueprint.json' );
		vol.fromJSON( { [ filePath ]: JSON.stringify( { meta: { title: 'Deep link' } } ) } );

		await expect( readBlueprintFile( mockIpcMainInvokeEvent, filePath ) ).resolves.toEqual( {
			meta: { title: 'Deep link' },
		} );
		expect( existsSync( filePath ) ).toBe( false );
	} );

	it( 'deletes invalid temporary deep-link JSON', async () => {
		const filePath = normalize( '/mock/path/wp-studio-blueprints/invalid.json' );
		vol.fromJSON( { [ filePath ]: '{invalid' } );

		await expect( readBlueprintFile( mockIpcMainInvokeEvent, filePath ) ).rejects.toThrow();
		expect( existsSync( filePath ) ).toBe( false );
	} );
} );

describe( 'getFileSize', () => {
	beforeEach( () => {
		vi.mocked( readSitePath ).mockResolvedValue( '/test' );
	} );

	it( 'returns the file size', async () => {
		vol.fromJSON( { '/test/wp-content/index.php': '<?php' } );

		await expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'index.php' ] )
		).resolves.toBe( 5 );
	} );

	it( 'returns 0 for a dangling symlink instead of throwing', async () => {
		// A broken symlink whose target was never created — mirrors the WP Cloud
		// `advanced-cache.php` drop-in that a reprint pull leaves dangling.
		vol.mkdirSync( '/test/wp-content', { recursive: true } );
		vol.symlinkSync(
			'/test/wordpress/drop-ins/advanced-cache.php',
			'/test/wp-content/advanced-cache.php'
		);
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		await expect(
			getFileSize( mockIpcMainInvokeEvent, 'test-site-id', [ 'wp-content', 'advanced-cache.php' ] )
		).resolves.toBe( 0 );
		expect( warnSpy ).toHaveBeenCalledWith( expect.stringContaining( 'advanced-cache.php' ) );

		warnSpy.mockRestore();
	} );
} );

describe( 'openURL', () => {
	it( 'only hands web URLs to the OS', () => {
		const openExternal = vi.fn().mockResolvedValue( undefined );
		( shell as unknown as { openExternal: typeof openExternal } ).openExternal = openExternal;

		for ( const url of [
			'https://wordpress.com/',
			'http://localhost:8881/',
			'file:///etc/passwd',
			'vscode://file/tmp',
			'smb://host/share',
			'relative/path',
		] ) {
			openURL( mockIpcMainInvokeEvent, url );
		}

		expect( openExternal.mock.calls ).toEqual( [
			[ 'https://wordpress.com/' ],
			[ 'http://localhost:8881/' ],
		] );
	} );
} );
