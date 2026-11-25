import fs from 'fs';
import os from 'os';
import path from 'path';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';

describe( 'lockFileAsync', () => {
	let lockPath: string;

	beforeEach( () => {
		lockPath = path.join( fs.mkdtempSync( path.join( os.tmpdir(), 'lockfile-test-' ) ), 'a.lock' );
	} );

	afterEach( () => {
		fs.rmSync( path.dirname( lockPath ), { recursive: true, force: true } );
	} );

	it( 'waits for the holder to release the lock', async () => {
		const events: string[] = [];
		await lockFileAsync( lockPath, { wait: 1000 } );
		const second = lockFileAsync( lockPath, { wait: 5000 } ).then( () => events.push( 'second' ) );
		await new Promise( ( resolve ) => setTimeout( resolve, 300 ) );
		events.push( 'first released' );
		await unlockFileAsync( lockPath );
		await second;
		await unlockFileAsync( lockPath );

		expect( events ).toEqual( [ 'first released', 'second' ] );
	} );

	it.each( [ 0, 300 ] )( 'gives up after a wait time of %i ms', async ( wait ) => {
		await lockFileAsync( lockPath, { wait: 1000 } );

		await expect( lockFileAsync( lockPath, { wait } ) ).rejects.toMatchObject( {
			code: 'ELOCKED',
		} );
		await unlockFileAsync( lockPath );
	} );

	it.each( [ 'file', 'directory' ] )(
		'takes over a stale %s lock left by a process that died',
		async ( kind ) => {
			if ( kind === 'file' ) {
				fs.writeFileSync( lockPath, '' );
			} else {
				fs.mkdirSync( lockPath );
			}
			const minuteAgo = new Date( Date.now() - 60_000 );
			fs.utimesSync( lockPath, minuteAgo, minuteAgo );

			await lockFileAsync( lockPath, { wait: 0 } );
			await unlockFileAsync( lockPath );

			expect( fs.existsSync( lockPath ) ).toBe( false );
		}
	);
} );
