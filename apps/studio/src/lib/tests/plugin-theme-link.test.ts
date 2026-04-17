/**
 * @vitest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	linkExtension,
	listLinkedExtensions,
	PluginThemeLinkError,
	unlinkExtension,
} from 'src/lib/plugin-theme-link';

const PLUGIN_HEADER = '<?php\n/** Plugin Name: Test Plugin */\n';
const THEME_HEADER = '/*\nTheme Name: Test Theme\n*/\n';

let tempDir: string;
let sitePath: string;

async function makePluginSource( name: string ): Promise< string > {
	const dir = path.join( tempDir, 'sources', name );
	await fs.promises.mkdir( dir, { recursive: true } );
	await fs.promises.writeFile( path.join( dir, `${ name }.php` ), PLUGIN_HEADER );
	return dir;
}

async function makeThemeSource( name: string ): Promise< string > {
	const dir = path.join( tempDir, 'sources', name );
	await fs.promises.mkdir( dir, { recursive: true } );
	await fs.promises.writeFile( path.join( dir, 'style.css' ), THEME_HEADER );
	return dir;
}

beforeEach( async () => {
	tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-plugin-link-' ) );
	sitePath = path.join( tempDir, 'site' );
	await fs.promises.mkdir( path.join( sitePath, 'wp-content', 'plugins' ), { recursive: true } );
	await fs.promises.mkdir( path.join( sitePath, 'wp-content', 'themes' ), { recursive: true } );
} );

afterEach( async () => {
	await fs.promises.rm( tempDir, { recursive: true, force: true } );
} );

describe( 'linkExtension (plugin)', () => {
	it( 'creates a symlink for a valid plugin source', async () => {
		const source = await makePluginSource( 'my-plugin' );
		const result = await linkExtension( 'plugin', sitePath, source );

		expect( result ).toEqual( {
			name: 'my-plugin',
			sourcePath: source,
			alreadyLinked: false,
		} );

		const target = path.join( sitePath, 'wp-content', 'plugins', 'my-plugin' );
		const stats = await fs.promises.lstat( target );
		expect( stats.isSymbolicLink() ).toBe( true );
	} );

	it( 'returns alreadyLinked=true when relinking the same source', async () => {
		const source = await makePluginSource( 'my-plugin' );
		await linkExtension( 'plugin', sitePath, source );
		const result = await linkExtension( 'plugin', sitePath, source );
		expect( result.alreadyLinked ).toBe( true );
	} );

	it( 'rejects a directory without a Plugin Name header', async () => {
		const dir = path.join( tempDir, 'sources', 'bad-plugin' );
		await fs.promises.mkdir( dir, { recursive: true } );
		await fs.promises.writeFile( path.join( dir, 'index.php' ), '<?php echo "hi";' );

		await expect( linkExtension( 'plugin', sitePath, dir ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
	} );

	it( 'rejects a non-existent source', async () => {
		await expect(
			linkExtension( 'plugin', sitePath, path.join( tempDir, 'missing' ) )
		).rejects.toBeInstanceOf( PluginThemeLinkError );
	} );
} );

describe( 'linkExtension (theme)', () => {
	it( 'creates a symlink for a valid theme source', async () => {
		const source = await makeThemeSource( 'my-theme' );
		const result = await linkExtension( 'theme', sitePath, source );
		expect( result.name ).toBe( 'my-theme' );

		const target = path.join( sitePath, 'wp-content', 'themes', 'my-theme' );
		const stats = await fs.promises.lstat( target );
		expect( stats.isSymbolicLink() ).toBe( true );
	} );

	it( 'rejects a directory without style.css', async () => {
		const dir = path.join( tempDir, 'sources', 'bad-theme' );
		await fs.promises.mkdir( dir, { recursive: true } );
		await expect( linkExtension( 'theme', sitePath, dir ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
	} );
} );

describe( 'listLinkedExtensions', () => {
	it( 'lists only symlinked plugins', async () => {
		const linkedSource = await makePluginSource( 'linked-plugin' );
		await linkExtension( 'plugin', sitePath, linkedSource );

		// Create a regular (non-symlink) plugin directory
		const regularDir = path.join( sitePath, 'wp-content', 'plugins', 'regular-plugin' );
		await fs.promises.mkdir( regularDir, { recursive: true } );

		const linked = await listLinkedExtensions( 'plugin', sitePath );
		expect( linked ).toHaveLength( 1 );
		expect( linked[ 0 ] ).toEqual( {
			name: 'linked-plugin',
			sourcePath: linkedSource,
		} );
	} );

	it( 'returns empty array when plugins dir does not exist', async () => {
		const emptyPath = path.join( tempDir, 'no-site' );
		const linked = await listLinkedExtensions( 'plugin', emptyPath );
		expect( linked ).toEqual( [] );
	} );
} );

describe( 'unlinkExtension', () => {
	it( 'removes the symlink only, preserving source', async () => {
		const source = await makePluginSource( 'my-plugin' );
		await linkExtension( 'plugin', sitePath, source );

		const result = await unlinkExtension( 'plugin', sitePath, 'my-plugin' );
		expect( result ).toEqual( { name: 'my-plugin', sourcePath: source } );

		const target = path.join( sitePath, 'wp-content', 'plugins', 'my-plugin' );
		await expect( fs.promises.lstat( target ) ).rejects.toThrow();
		const sourceStats = await fs.promises.stat( source );
		expect( sourceStats.isDirectory() ).toBe( true );
	} );

	it( 'rejects path traversal in name', async () => {
		await expect( unlinkExtension( 'plugin', sitePath, '../evil' ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
		await expect( unlinkExtension( 'plugin', sitePath, 'a/b' ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
	} );

	it( 'refuses to unlink a non-symlink directory', async () => {
		const dir = path.join( sitePath, 'wp-content', 'plugins', 'real-plugin' );
		await fs.promises.mkdir( dir, { recursive: true } );

		await expect( unlinkExtension( 'plugin', sitePath, 'real-plugin' ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
	} );

	it( 'reports missing plugin clearly', async () => {
		await expect( unlinkExtension( 'plugin', sitePath, 'nonexistent' ) ).rejects.toBeInstanceOf(
			PluginThemeLinkError
		);
	} );
} );
