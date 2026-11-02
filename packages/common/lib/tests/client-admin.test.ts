import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getClientAdminLogin, getClientAdminManifestPath } from '../client-admin';

describe( 'getClientAdminLogin', () => {
	let sitePath: string;

	const writeManifest = ( contents: string ) => {
		const file = getClientAdminManifestPath( sitePath );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, contents );
	};

	beforeEach( () => {
		sitePath = mkdtempSync( path.join( os.tmpdir(), 'client-admin-' ) );
	} );

	afterEach( () => {
		rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'reads the login of a site with a curated wp-admin', () => {
		writeManifest( JSON.stringify( { client: { login: 'maria' } } ) );
		expect( getClientAdminLogin( sitePath ) ).toBe( 'maria' );
	} );

	it( 'finds nothing on any other site, so its links stay hidden', () => {
		expect( getClientAdminLogin( sitePath ) ).toBeUndefined();
	} );

	it( 'finds nothing in a damaged manifest', () => {
		writeManifest( '{ not json' );
		expect( getClientAdminLogin( sitePath ) ).toBeUndefined();
	} );
} );
