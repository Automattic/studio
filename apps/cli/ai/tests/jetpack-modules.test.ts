import { cpSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { jetpackModules } from '@studio/agent/node/jetpack-modules';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { StudioAgentHost } from '@studio/agent/node';

// A real WordPress install, on Twenty Twenty-Five, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'jetpackModules', () => {
	let root: string;
	const site = () => liveSite( root, 'Site' );
	let host: StudioAgentHost;
	const wp = async ( ...args: string[] ) => ( await host.sites.wpCli( site(), args ) ).stdout;
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'jetpack-modules-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		host = liveHost( site() );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'activates the default modules Jetpack leaves off on a site that is not connected, once', async () => {
		const before = await jetpackModules.read( root, undefined, host );
		await wp( 'plugin', 'install', 'jetpack', '--activate' );
		const activated = await jetpackModules.read( root, undefined, host );
		const { reports } = await jetpackModules.check( site(), before, activated, host );
		expect( reports ).toEqual( [
			{
				key: 'jetpack modules',
				summary: expect.stringContaining(
					'Studio activated the default modules that need no connection, as Jetpack::activate_default_modules() does: blocks, contact-form'
				),
			},
		] );
		expect(
			JSON.parse( await wp( 'option', 'get', 'jetpack_active_modules', '--format=json' ) )
		).toEqual( expect.arrayContaining( [ 'blocks', 'contact-form' ] ) );
		// Set, even to none, the site's modules are its own.
		await wp( 'jetpack', 'module', 'deactivate', 'contact-form' );
		await wp( 'jetpack', 'module', 'deactivate', 'blocks' );
		const after = await jetpackModules.read( root, undefined, host );
		expect( after ).toEqual( {} );
		expect( ( await jetpackModules.check( site(), activated, after, host ) ).reports ).toEqual(
			[]
		);
	}, 120000 );
} );
