import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	loadWpEnvConfig,
	WP_ENV_FILE,
	WP_ENV_OVERRIDE_FILE,
	WpEnvError,
} from '@studio/common/lib/wp-env/config';

let projectDir: string;

function writeConfig( fileName: string, contents: unknown ): void {
	fs.writeFileSync(
		path.join( projectDir, fileName ),
		typeof contents === 'string' ? contents : JSON.stringify( contents )
	);
}

beforeEach( () => {
	projectDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wp-env-' ) );
} );

afterEach( () => {
	fs.rmSync( projectDir, { recursive: true, force: true } );
} );

describe( 'loadWpEnvConfig', () => {
	it( 'returns undefined when there is no config file', () => {
		expect( loadWpEnvConfig( projectDir ) ).toBeUndefined();
	} );

	it( 'loads a minimal config', () => {
		writeConfig( WP_ENV_FILE, { plugins: [ '.' ] } );

		const loaded = loadWpEnvConfig( projectDir );
		expect( loaded?.config.plugins ).toEqual( [ '.' ] );
		expect( loaded?.warnings ).toEqual( [] );
	} );

	it( 'throws a WpEnvError on invalid JSON', () => {
		writeConfig( WP_ENV_FILE, '{ not json' );
		expect( () => loadWpEnvConfig( projectDir ) ).toThrow( WpEnvError );
	} );

	it( 'throws a WpEnvError on schema violations', () => {
		writeConfig( WP_ENV_FILE, { plugins: 'not-an-array' } );
		expect( () => loadWpEnvConfig( projectDir ) ).toThrow( WpEnvError );
	} );

	it( 'replaces fields but merges config and mappings from the override file', () => {
		writeConfig( WP_ENV_FILE, {
			plugins: [ './plugin-a' ],
			config: { KEY_A: 'a', SHARED: 'base' },
			mappings: { 'wp-content/mu-plugins': './mu' },
		} );
		writeConfig( WP_ENV_OVERRIDE_FILE, {
			plugins: [ './plugin-b' ],
			config: { KEY_B: 'b', SHARED: 'override' },
			mappings: { 'wp-content/uploads': './uploads' },
		} );

		const loaded = loadWpEnvConfig( projectDir );
		expect( loaded?.config.plugins ).toEqual( [ './plugin-b' ] );
		expect( loaded?.config.config ).toEqual( { KEY_A: 'a', KEY_B: 'b', SHARED: 'override' } );
		expect( loaded?.config.mappings ).toEqual( {
			'wp-content/mu-plugins': './mu',
			'wp-content/uploads': './uploads',
		} );
	} );

	it( 'applies env.development over root fields', () => {
		writeConfig( WP_ENV_FILE, {
			themes: [ './base-theme' ],
			config: { ROOT: true },
			env: {
				development: {
					themes: [ './dev-theme' ],
					config: { DEV: true },
				},
			},
		} );

		const loaded = loadWpEnvConfig( projectDir );
		expect( loaded?.config.themes ).toEqual( [ './dev-theme' ] );
		expect( loaded?.config.config ).toEqual( { ROOT: true, DEV: true } );
	} );

	it( 'warns about unsupported fields instead of failing', () => {
		writeConfig( WP_ENV_FILE, {
			multisite: true,
			lifecycleScripts: { afterStart: 'echo hi' },
			env: { tests: { port: 8889 } },
		} );

		const loaded = loadWpEnvConfig( projectDir );
		expect( loaded?.warnings ).toHaveLength( 3 );
		expect( loaded?.warnings.join( '\n' ) ).toContain( 'multisite' );
		expect( loaded?.warnings.join( '\n' ) ).toContain( 'lifecycleScripts' );
		expect( loaded?.warnings.join( '\n' ) ).toContain( 'env.tests' );
	} );
} );
