import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { themeJsonFileRead } from '@studio/agent/node/theme-json-files';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to read themes with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'what WordPress makes of a theme.json just written', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	let file: string;
	const read = async ( json: object ) => {
		writeFileSync( file, JSON.stringify( json ) );
		return ( await themeJsonFileRead( host, site, file, 'theme.json' ) ).problem;
	};
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'theme-json-files-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root );
		host = liveHost( site );
		const dir = path.join( root, 'wp-content/themes/gym' );
		mkdirSync( dir, { recursive: true } );
		file = path.join( dir, 'theme.json' );
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	// port c-2 climbing-gym: a "spacingScale" of 1.4 failed every page once the theme was active.
	it( 'says what the read throws, and nothing once the value has its form', async () => {
		expect( await read( { version: 3, settings: { spacing: { spacingScale: 1.4 } } } ) ).toMatch(
			/^WordPress fails reading theme\.json as new WP_Theme_JSON\( \$decoded \) .*: TypeError: array_keys\(\): Argument #1 \(\$array\) must be of type array, float given in wp-includes\/class-wp-theme-json\.php:\d+\./
		);
		// The theme active, as the theme whose read fails each request.
		writeFileSync( path.join( path.dirname( file ), 'style.css' ), '/*\nTheme Name: Gym\n*/\n' );
		mkdirSync( path.join( path.dirname( file ), 'templates' ), { recursive: true } );
		writeFileSync( path.join( path.dirname( file ), 'templates/index.html' ), '' );
		await host.sites.wpCli( site, [ 'theme', 'activate', 'gym' ] );
		expect( await read( { version: 3, settings: { spacing: { spacingScale: 1.4 } } } ) ).toMatch(
			/^WordPress fails reading theme\.json .*TypeError: array_keys/
		);
		expect(
			await read( { version: 3, settings: { spacing: { spacingScale: { steps: 0 } } } } )
		).toBeUndefined();
	}, 60000 );
} );
