import fs from 'fs/promises';
import os from 'os';
import nodePath from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildPluginFiles, scaffoldPluginInSite } from '../scaffold-plugin';

const FULL_META = {
	slug: 'my-plugin',
	name: 'My Plugin',
	description: 'Does something great.',
	author: 'Shaun',
	version: '0.1.0',
	pluginUri: 'https://example.com/my-plugin',
	authorUri: 'https://example.com',
	license: 'GPLv2 or later',
};

describe( 'buildPluginFiles', () => {
	it( 'renders the full plugin header from the meta', () => {
		const [ mainFile ] = buildPluginFiles( FULL_META );

		expect( mainFile.relativePath ).toBe( 'my-plugin.php' );
		expect( mainFile.contents ).toContain( ' * Plugin Name: My Plugin' );
		expect( mainFile.contents ).toContain( ' * Plugin URI: https://example.com/my-plugin' );
		expect( mainFile.contents ).toContain( ' * Description: Does something great.' );
		expect( mainFile.contents ).toContain( ' * Version: 0.1.0' );
		expect( mainFile.contents ).toContain( ' * Requires at least: 6.0' );
		expect( mainFile.contents ).toContain( ' * Requires PHP: 7.4' );
		expect( mainFile.contents ).toContain( ' * Author: Shaun' );
		expect( mainFile.contents ).toContain( ' * Author URI: https://example.com' );
		expect( mainFile.contents ).toContain( ' * License: GPLv2 or later' );
		expect( mainFile.contents ).toContain( ' * Text Domain: my-plugin' );
		expect( mainFile.contents ).toContain( "defined( 'ABSPATH' )" );
		expect( mainFile.contents ).toContain( "define( 'MY_PLUGIN_VERSION', '0.1.0' );" );
	} );

	it( 'omits header lines for empty optional fields', () => {
		const [ mainFile ] = buildPluginFiles( {
			slug: 'bare-plugin',
			name: 'Bare Plugin',
		} );

		expect( mainFile.contents ).toContain( ' * Plugin Name: Bare Plugin' );
		expect( mainFile.contents ).not.toContain( 'Plugin URI' );
		expect( mainFile.contents ).not.toContain( 'Description:' );
		expect( mainFile.contents ).not.toContain( 'Author' );
		expect( mainFile.contents ).not.toContain( 'License' );
		// Scaffold defaults always present.
		expect( mainFile.contents ).toContain( ' * Requires at least: 6.0' );
		// Version falls back for the constant even without a header line.
		expect( mainFile.contents ).toContain( "define( 'BARE_PLUGIN_VERSION', '0.1.0' );" );
	} );

	it( 'produces the structured file set', () => {
		const files = buildPluginFiles( FULL_META ).map( ( file ) => file.relativePath );
		expect( files ).toEqual( [
			'my-plugin.php',
			'readme.txt',
			'uninstall.php',
			nodePath.join( 'includes', 'index.php' ),
		] );
	} );

	it( 'builds a readme skeleton with the stable tag and license', () => {
		const readme = buildPluginFiles( FULL_META ).find(
			( file ) => file.relativePath === 'readme.txt'
		)!;
		expect( readme.contents ).toContain( '=== My Plugin ===' );
		expect( readme.contents ).toContain( 'Stable tag: 0.1.0' );
		expect( readme.contents ).toContain( 'License: GPLv2 or later' );
		expect( readme.contents ).toContain( '== Description ==' );
	} );

	it( 'strips comment-breaking sequences from header values', () => {
		const [ mainFile ] = buildPluginFiles( {
			slug: 'sneaky',
			name: 'Sneaky */ ?><?php evil()',
		} );
		expect( mainFile.contents ).not.toContain( '*/ ?>' );
		expect( mainFile.contents ).not.toContain( '<?php evil' );
	} );
} );

describe( 'scaffoldPluginInSite', () => {
	let sitePath: string;

	beforeEach( async () => {
		sitePath = await fs.mkdtemp( nodePath.join( os.tmpdir(), 'studio-scaffold-test-' ) );
	} );

	afterEach( async () => {
		await fs.rm( sitePath, { recursive: true, force: true } );
	} );

	it( 'writes the scaffold into wp-content/plugins/<slug>', async () => {
		const pluginDir = await scaffoldPluginInSite( sitePath, FULL_META );

		expect( pluginDir ).toBe( nodePath.join( sitePath, 'wp-content', 'plugins', 'my-plugin' ) );
		const mainFile = await fs.readFile( nodePath.join( pluginDir, 'my-plugin.php' ), 'utf8' );
		expect( mainFile ).toContain( 'Plugin Name: My Plugin' );
		await expect( fs.stat( nodePath.join( pluginDir, 'readme.txt' ) ) ).resolves.toBeTruthy();
		await expect( fs.stat( nodePath.join( pluginDir, 'uninstall.php' ) ) ).resolves.toBeTruthy();
		await expect(
			fs.stat( nodePath.join( pluginDir, 'includes', 'index.php' ) )
		).resolves.toBeTruthy();
	} );

	it( 'refuses to overwrite an existing plugin folder', async () => {
		await scaffoldPluginInSite( sitePath, FULL_META );
		await expect( scaffoldPluginInSite( sitePath, FULL_META ) ).rejects.toThrow( /already exists/ );
	} );

	it( 'rejects invalid slugs', async () => {
		await expect(
			scaffoldPluginInSite( sitePath, { ...FULL_META, slug: '../escape' } )
		).rejects.toThrow( /Invalid plugin slug/ );
	} );
} );
