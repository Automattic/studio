/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	getShipItProcessPattern,
	readBundleIdentifier,
	removeStaleShipItTempDirs,
} from 'src/lib/macos-update-install';

describe( 'macos-update-install', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-shipit-test-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'reads the bundle identifier from Info.plist', () => {
		const contents = path.join( tmpDir, 'Studio.app', 'Contents' );
		fs.mkdirSync( contents, { recursive: true } );
		fs.writeFileSync(
			path.join( contents, 'Info.plist' ),
			'<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>com.automattic.studio</string>\n</dict>'
		);
		expect( readBundleIdentifier( path.join( tmpDir, 'Studio.app' ) ) ).toBe(
			'com.automattic.studio'
		);
		expect( readBundleIdentifier( path.join( tmpDir, 'Missing.app' ) ) ).toBeNull();
	} );

	it( 'builds a pgrep pattern that matches ShipIt but not itself', () => {
		const pattern = new RegExp( getShipItProcessPattern( 'com.automattic.studio' ) );
		expect(
			pattern.test(
				'/Users/me/Library/Caches/com.automattic.studio.ShipIt/ShipIt com.automattic.studio.ShipIt /state.plist'
			)
		).toBe( true );
		expect( pattern.test( `sh -c ... ${ pattern.source }` ) ).toBe( false );
	} );

	it( 'removes only stale ShipIt temp copies of this app', async () => {
		const now = Date.now();
		const old = new Date( now - 2 * 60 * 60 * 1000 );
		const make = ( name: string, mtime?: Date ) => {
			const dir = path.join( tmpDir, name );
			fs.mkdirSync( path.join( dir, 'Studio.app' ), { recursive: true } );
			if ( mtime ) fs.utimesSync( dir, mtime, mtime );
			return dir;
		};
		const stale = make( 'com.automattic.studio.ShipIt.AbCdEfGh', old );
		const fresh = make( 'com.automattic.studio.ShipIt.IjKlMnOp' );
		const otherApp = make( 'com.example.other.ShipIt.QrStUvWx', old );

		await removeStaleShipItTempDirs( 'com.automattic.studio', tmpDir, now );

		expect( fs.existsSync( stale ) ).toBe( false );
		expect( fs.existsSync( fresh ) ).toBe( true );
		expect( fs.existsSync( otherApp ) ).toBe( true );
	} );
} );
