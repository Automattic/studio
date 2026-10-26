import fs from 'fs';
import os from 'os';
import path from 'path';
import { listLocalFileTree } from '@studio/common/lib/sync/local-file-tree';

describe( 'listLocalFileTree', () => {
	let tempDir: string;
	let sitePath: string;

	beforeEach( () => {
		tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'local-file-tree-' ) );
		sitePath = path.join( tempDir, 'site' );
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins' ), { recursive: true } );
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'lists a symlinked directory as a directory marked as a symlink', async () => {
		fs.mkdirSync( path.join( tempDir, 'target' ) );
		fs.symlinkSync(
			path.join( tempDir, 'target' ),
			path.join( sitePath, 'wp-content', 'plugins', 'linked' ),
			'junction'
		);

		await expect( listLocalFileTree( sitePath, 'wp-content/plugins' ) ).resolves.toEqual( [
			{ name: 'linked', isDirectory: true, isSymlink: true, path: 'wp-content/plugins/linked' },
		] );
	} );

	it( 'leaves out a dangling symlink and keeps its siblings', async () => {
		fs.symlinkSync(
			path.join( tempDir, 'missing' ),
			path.join( sitePath, 'wp-content', 'plugins', 'broken' ),
			'junction'
		);
		fs.writeFileSync( path.join( sitePath, 'wp-content', 'plugins', 'hello.php' ), '' );

		const entries = await listLocalFileTree( sitePath, 'wp-content/plugins' );

		expect( entries.map( ( entry ) => entry.name ) ).toEqual( [ 'hello.php' ] );
	} );
} );
