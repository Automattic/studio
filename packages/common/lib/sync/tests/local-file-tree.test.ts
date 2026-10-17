import fs from 'fs';
import os from 'os';
import path from 'path';
import { listLocalFileTree } from '@studio/common/lib/sync/local-file-tree';

describe( 'listLocalFileTree', () => {
	let sitePath: string;
	let target: string;

	beforeEach( () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'local-file-tree-site-' ) );
		target = fs.mkdtempSync( path.join( os.tmpdir(), 'local-file-tree-target-' ) );
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins' ), { recursive: true } );
	} );

	afterEach( () => {
		fs.rmSync( sitePath, { recursive: true, force: true } );
		fs.rmSync( target, { recursive: true, force: true } );
	} );

	it( 'lists a symlinked directory as a directory marked as a symlink', async () => {
		fs.symlinkSync(
			target,
			path.join( sitePath, 'wp-content', 'plugins', 'linked-plugin' ),
			'junction'
		);
		fs.mkdirSync( path.join( sitePath, 'wp-content', 'plugins', 'regular-plugin' ) );

		const entries = await listLocalFileTree( sitePath, 'wp-content/plugins' );

		expect( entries.sort( ( a, b ) => a.name.localeCompare( b.name ) ) ).toEqual( [
			{
				name: 'linked-plugin',
				isDirectory: true,
				isSymlink: true,
				path: 'wp-content/plugins/linked-plugin',
			},
			{
				name: 'regular-plugin',
				isDirectory: true,
				path: 'wp-content/plugins/regular-plugin',
			},
		] );
	} );

	it( 'leaves out a dangling symlink', async () => {
		fs.symlinkSync(
			path.join( target, 'missing' ),
			path.join( sitePath, 'wp-content', 'plugins', 'broken' ),
			'junction'
		);

		await expect( listLocalFileTree( sitePath, 'wp-content/plugins' ) ).resolves.toEqual( [] );
	} );
} );
