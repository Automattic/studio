import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canUseExistingCore } from 'cli/lib/pull/local-core';

describe( 'canUseExistingCore', () => {
	let root: string;
	let sitePath: string;

	const writeCore = ( directory: string, version: string ) => {
		fs.mkdirSync( path.join( directory, 'wp-includes' ), { recursive: true } );
		fs.writeFileSync(
			path.join( directory, 'wp-includes', 'version.php' ),
			`<?php\n$wp_version = '${ version }';\n`
		);
	};

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-local-core-' ) );
		sitePath = path.join( root, 'site' );
		fs.mkdirSync( sitePath );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'keeps core at the remote version', () => {
		writeCore( sitePath, '7.1.4' );
		expect( canUseExistingCore( sitePath, '7.1.4' ) ).toBe( true );
	} );

	it( 'pulls core when the versions differ', () => {
		writeCore( sitePath, '7.1.3' );
		expect( canUseExistingCore( sitePath, '7.1.4' ) ).toBe( false );
	} );

	it( 'pulls core when the remote version is unknown', () => {
		writeCore( sitePath, '7.1.4' );
		expect( canUseExistingCore( sitePath, null ) ).toBe( false );
	} );

	it( 'pulls core when the site has none', () => {
		expect( canUseExistingCore( sitePath, '7.1.4' ) ).toBe( false );
	} );

	it( 'pulls core when the site links it into a pulled tree', () => {
		const pulledCore = path.join( root, 'raw' );
		writeCore( pulledCore, '7.1.4' );
		fs.symlinkSync( path.join( pulledCore, 'wp-includes' ), path.join( sitePath, 'wp-includes' ) );
		expect( canUseExistingCore( sitePath, '7.1.4' ) ).toBe( false );
	} );
} );
