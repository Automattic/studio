/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeStaleShipItTempDirs } from 'src/lib/macos-update-install';

it( 'removes only stale ShipIt temp copies of this app', async () => {
	const tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-shipit-test-' ) );
	const now = Date.now();
	const old = new Date( now - 2 * 60 * 60 * 1000 );
	const make = ( name: string, mtime?: Date ) => {
		const dir = path.join( tmpDir, name );
		fs.mkdirSync( dir );
		if ( mtime ) fs.utimesSync( dir, mtime, mtime );
		return dir;
	};
	const stale = make( 'com.automattic.studio.ShipIt.AbCdEfGh', old );
	const fresh = make( 'com.automattic.studio.ShipIt.IjKlMnOp' );
	const otherApp = make( 'com.example.other.ShipIt.QrStUvWx', old );

	await removeStaleShipItTempDirs( 'com.automattic.studio', tmpDir, now );

	expect( [ stale, fresh, otherApp ].map( ( dir ) => fs.existsSync( dir ) ) ).toEqual( [
		false,
		true,
		true,
	] );
	fs.rmSync( tmpDir, { recursive: true, force: true } );
} );
