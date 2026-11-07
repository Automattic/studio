import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStaffAdminLogin, getCurateAdminManifestPath } from '../curate-admin';

describe( 'getStaffAdminLogin', () => {
	let sitePath: string;

	const writeManifest = ( contents: string ) => {
		const file = getCurateAdminManifestPath( sitePath );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, contents );
	};

	beforeEach( () => {
		sitePath = mkdtempSync( path.join( os.tmpdir(), 'curate-admin-' ) );
	} );

	afterEach( () => {
		rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'reads the login of a site with a curated wp-admin', () => {
		writeManifest( JSON.stringify( { staff: { login: 'maria' } } ) );
		expect( getStaffAdminLogin( sitePath ) ).toBe( 'maria' );
	} );

	it( 'finds nothing on any other site, so its links stay hidden', () => {
		expect( getStaffAdminLogin( sitePath ) ).toBeUndefined();
	} );

	it( 'finds nothing in a damaged manifest', () => {
		writeManifest( '{ not json' );
		expect( getStaffAdminLogin( sitePath ) ).toBeUndefined();
	} );
} );
