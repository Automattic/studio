import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SITE_RUNTIME_NATIVE_PHP, SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { WP_ENV_FILE, WpEnvError } from '@studio/common/lib/wp-env/config';
import { wpEnvToSiteConfig } from '@studio/common/lib/wp-env/site-config';

let workDir: string;
let projectDir: string;
let siteDir: string;

function writeWpEnv( contents: unknown ): void {
	fs.writeFileSync( path.join( projectDir, WP_ENV_FILE ), JSON.stringify( contents ) );
}

function makePlugin( dirName: string, mainFileName = `${ dirName }.php` ): string {
	const pluginDir = path.join( projectDir, dirName );
	fs.mkdirSync( pluginDir, { recursive: true } );
	fs.writeFileSync(
		path.join( pluginDir, mainFileName ),
		`<?php\n/**\n * Plugin Name: ${ dirName }\n */\n`
	);
	return pluginDir;
}

function makeDir( dirName: string ): string {
	const dir = path.join( projectDir, dirName );
	fs.mkdirSync( dir, { recursive: true } );
	return dir;
}

beforeEach( () => {
	workDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wp-env-' ) );
	projectDir = path.join( workDir, 'project' );
	siteDir = path.join( workDir, 'site' );
	fs.mkdirSync( projectDir );
	fs.mkdirSync( siteDir );
} );

afterEach( () => {
	fs.rmSync( workDir, { recursive: true, force: true } );
} );

describe( 'wpEnvToSiteConfig', () => {
	it( 'returns undefined when the project has no .wp-env.json', async () => {
		await expect(
			wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND )
		).resolves.toBeUndefined();
	} );

	describe( 'sandbox runtime', () => {
		it( 'mounts a plugin over the site directory and activates it via its main file', async () => {
			const pluginDir = makePlugin( 'my-plugin', 'entry.php' );
			fs.writeFileSync( path.join( pluginDir, 'helpers.php' ), '<?php // no header\n' );
			writeWpEnv( { plugins: [ './my-plugin' ] } );

			const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

			expect( result?.startOptions.mounts ).toEqual( [
				{ hostPath: pluginDir, vfsPath: '/wordpress/wp-content/plugins/my-plugin' },
			] );
			expect( result?.startOptions.blueprint ).toEqual( {
				steps: [ { step: 'activatePlugin', pluginPath: 'my-plugin/entry.php' } ],
			} );
			expect(
				JSON.parse( fs.readFileSync( result!.startOptions.blueprintUri!, 'utf-8' ) )
			).toEqual( result?.startOptions.blueprint );
		} );

		it( 'supports "." as the project itself', async () => {
			fs.writeFileSync(
				path.join( projectDir, 'main.php' ),
				'<?php\n/**\n * Plugin Name: Project\n */\n'
			);
			writeWpEnv( { plugins: [ '.' ] } );

			const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

			expect( result?.startOptions.mounts ).toEqual( [
				{ hostPath: projectDir, vfsPath: '/wordpress/wp-content/plugins/project' },
			] );
		} );

		it( 'mounts children individually when the destination already exists in the site', async () => {
			const muDir = makeDir( 'mu' );
			fs.writeFileSync( path.join( muDir, 'mu-spike.php' ), '<?php\n' );
			// Simulates Studio's SQLite integration pre-existing in mu-plugins.
			fs.mkdirSync(
				path.join( siteDir, 'wp-content', 'mu-plugins', 'sqlite-database-integration' ),
				{
					recursive: true,
				}
			);
			writeWpEnv( { mappings: { 'wp-content/mu-plugins': './mu' } } );

			const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

			// Mounting the whole dir would shadow the SQLite integration.
			expect( result?.startOptions.mounts ).toEqual( [
				{
					hostPath: path.join( muDir, 'mu-spike.php' ),
					vfsPath: '/wordpress/wp-content/mu-plugins/mu-spike.php',
				},
			] );
		} );

		it( 'maps themes and mappings without activation steps', async () => {
			const themeDir = makeDir( 'my-theme' );
			const muDir = makeDir( 'mu' );
			writeWpEnv( {
				themes: [ './my-theme' ],
				mappings: { 'wp-content/mu-plugins': './mu' },
			} );

			const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

			expect( result?.startOptions.mounts ).toEqual( [
				{ hostPath: themeDir, vfsPath: '/wordpress/wp-content/themes/my-theme' },
				{ hostPath: muDir, vfsPath: '/wordpress/wp-content/mu-plugins' },
			] );
			expect( result?.startOptions.blueprint ).toBeUndefined();
		} );
	} );

	describe( 'native runtime', () => {
		it( 'symlinks a plugin into the site directory', async () => {
			const pluginDir = makePlugin( 'my-plugin' );
			writeWpEnv( { plugins: [ './my-plugin' ] } );

			const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_NATIVE_PHP );

			const linkPath = path.join( siteDir, 'wp-content', 'plugins', 'my-plugin' );
			expect( fs.lstatSync( linkPath ).isSymbolicLink() ).toBe( true );
			expect( fs.realpathSync( linkPath ) ).toBe( fs.realpathSync( pluginDir ) );
			expect( result?.startOptions.mounts ).toBeUndefined();
			expect( result?.startOptions.blueprint ).toEqual( {
				steps: [ { step: 'activatePlugin', pluginPath: 'my-plugin/my-plugin.php' } ],
			} );
		} );

		it( 'is idempotent and replaces links pointing at a different target', async () => {
			const pluginDir = makePlugin( 'my-plugin' );
			const otherTarget = makeDir( 'other' );
			const linkPath = path.join( siteDir, 'wp-content', 'plugins', 'my-plugin' );
			fs.mkdirSync( path.dirname( linkPath ), { recursive: true } );
			fs.symlinkSync( otherTarget, linkPath, 'dir' );
			writeWpEnv( { plugins: [ './my-plugin' ] } );

			await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_NATIVE_PHP );
			await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_NATIVE_PHP );

			expect( fs.realpathSync( linkPath ) ).toBe( fs.realpathSync( pluginDir ) );
		} );

		it( 'merges children into an existing real directory instead of replacing it', async () => {
			const muDir = makeDir( 'mu' );
			fs.writeFileSync( path.join( muDir, 'mu-spike.php' ), '<?php\n' );
			// Simulates Studio's SQLite integration pre-existing in mu-plugins.
			const destination = path.join( siteDir, 'wp-content', 'mu-plugins' );
			fs.mkdirSync( path.join( destination, 'sqlite-database-integration' ), {
				recursive: true,
			} );
			writeWpEnv( { mappings: { 'wp-content/mu-plugins': './mu' } } );

			await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_NATIVE_PHP );

			// Pre-existing content is untouched, host children are linked in.
			expect(
				fs.lstatSync( path.join( destination, 'sqlite-database-integration' ) ).isDirectory()
			).toBe( true );
			expect( fs.lstatSync( path.join( destination, 'mu-spike.php' ) ).isSymbolicLink() ).toBe(
				true
			);
		} );

		it( 'refuses to overwrite a real file', async () => {
			const muDir = makeDir( 'mu' );
			fs.writeFileSync( path.join( muDir, 'mu-spike.php' ), '<?php // project version\n' );
			const destination = path.join( siteDir, 'wp-content', 'mu-plugins' );
			fs.mkdirSync( destination, { recursive: true } );
			fs.writeFileSync( path.join( destination, 'mu-spike.php' ), '<?php // site version\n' );
			writeWpEnv( { mappings: { 'wp-content/mu-plugins': './mu' } } );

			await expect(
				wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_NATIVE_PHP )
			).rejects.toThrow( WpEnvError );
		} );
	} );

	it( 'links a plugin without a detectable main file and warns instead of activating', async () => {
		const dir = makeDir( 'headerless' );
		fs.writeFileSync( path.join( dir, 'index.php' ), '<?php // nothing\n' );
		writeWpEnv( { plugins: [ './headerless' ] } );

		const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

		expect( result?.startOptions.mounts ).toHaveLength( 1 );
		expect( result?.startOptions.blueprint ).toBeUndefined();
		expect( result?.warnings.join( '\n' ) ).toContain( 'not activated' );
	} );

	it( 'emits a defineWpConfigConsts step for user constants, skipping Studio-managed ones', async () => {
		writeWpEnv( {
			config: { MY_CONST: 'value', MY_FLAG: true, WP_DEBUG: true, SKIPPED: null },
		} );

		const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );

		expect( result?.startOptions.blueprint ).toEqual( {
			steps: [ { step: 'defineWpConfigConsts', consts: { MY_CONST: 'value', MY_FLAG: true } } ],
		} );
		expect( result?.warnings.join( '\n' ) ).toContain( 'WP_DEBUG' );
	} );

	it( 'passes phpVersion and port through and validates the PHP version', async () => {
		writeWpEnv( { phpVersion: '8.2', port: 8888 } );

		const result = await wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );
		expect( result?.phpVersion ).toBe( '8.2' );
		expect( result?.preferredPort ).toBe( 8888 );

		writeWpEnv( { phpVersion: '5.6' } );
		await expect(
			wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND )
		).rejects.toThrow( /not supported by Studio/ );
	} );

	it( 'rejects remote sources with a clear error', async () => {
		writeWpEnv( { plugins: [ 'WordPress/gutenberg#trunk' ] } );

		await expect(
			wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND )
		).rejects.toThrow( /Remote wp-env sources are not supported/ );
	} );

	it( 'rejects missing local paths', async () => {
		writeWpEnv( { plugins: [ './missing' ] } );

		await expect(
			wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND )
		).rejects.toThrow( WpEnvError );
	} );

	describe( 'core resolution', () => {
		async function resolveCore( core: unknown ) {
			writeWpEnv( { core } );
			return wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND );
		}

		it( 'treats core: null as no version preference', async () => {
			const result = await resolveCore( null );
			expect( result?.wpVersion ).toBeUndefined();
		} );

		it( 'maps WordPress/WordPress (trunk) to nightly with a warning', async () => {
			for ( const core of [
				'WordPress/WordPress',
				'WordPress/WordPress#master',
				'WordPress/WordPress#trunk',
			] ) {
				const result = await resolveCore( core );
				expect( result?.wpVersion ).toBe( 'nightly' );
				expect( result?.warnings.join( '\n' ) ).toContain( 'nightly' );
			}
		} );

		it( 'maps WordPress/WordPress release tags to versions', async () => {
			expect( ( await resolveCore( 'WordPress/WordPress#6.4.2' ) )?.wpVersion ).toBe( '6.4.2' );
			expect( ( await resolveCore( 'WordPress/WordPress#v6.4' ) )?.wpVersion ).toBe( '6.4' );
			expect( ( await resolveCore( 'WordPress/WordPress#6.5-RC1' ) )?.wpVersion ).toBe( '6.5-RC1' );
		} );

		it( 'maps wordpress.org zips to versions', async () => {
			expect(
				( await resolveCore( 'https://wordpress.org/wordpress-5.4-beta2.zip' ) )?.wpVersion
			).toBe( '5.4-beta2' );
			expect(
				( await resolveCore( 'https://wordpress.org/nightly-builds/wordpress-latest.zip' ) )
					?.wpVersion
			).toBe( 'nightly' );
		} );

		it( 'rejects unsupported core sources', async () => {
			for ( const core of [
				'./local-core',
				'~/wordpress-develop',
				'someone/fork#trunk',
				'WordPress/WordPress#some-branch',
				'WordPress/gutenberg/subdir',
				'ssh://git@github.com/WordPress/WordPress.git',
				'https://example.com/custom-build.zip',
			] ) {
				await expect( resolveCore( core ) ).rejects.toThrow( /not supported yet/ );
			}
		} );
	} );

	it( 'rejects mappings destinations that escape the WordPress root', async () => {
		makeDir( 'mu' );
		writeWpEnv( { mappings: { '../outside': './mu' } } );

		await expect(
			wpEnvToSiteConfig( projectDir, siteDir, SITE_RUNTIME_PLAYGROUND )
		).rejects.toThrow( WpEnvError );
	} );
} );
