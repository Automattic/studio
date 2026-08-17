import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { measureSiteStorage } from './storage-usage';

const temporaryDirectories: string[] = [];

async function createSite(): Promise< string > {
	const sitePath = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-storage-usage-' ) );
	temporaryDirectories.push( sitePath );
	return sitePath;
}

async function createFile( sitePath: string, relativePath: string, size: number ): Promise< void > {
	const filePath = path.join( sitePath, relativePath );
	await fs.mkdir( path.dirname( filePath ), { recursive: true } );
	await fs.writeFile( filePath, Buffer.alloc( size ) );
}

afterEach( async () => {
	await Promise.all(
		temporaryDirectories.splice( 0 ).map( ( directory ) => fs.rm( directory, { recursive: true } ) )
	);
} );

describe( 'measureSiteStorage', () => {
	it( 'groups files into the storage categories shown in the UI', async () => {
		const sitePath = await createSite();
		await Promise.all( [
			createFile( sitePath, 'wp-content/uploads/image.jpg', 400 ),
			createFile( sitePath, 'wp-content/plugins/plugin/index.php', 200 ),
			createFile( sitePath, 'wp-content/themes/theme/style.css', 100 ),
			createFile( sitePath, 'wp-content/database/.ht.sqlite', 50 ),
			createFile( sitePath, 'wp-admin/index.php', 25 ),
			createFile( sitePath, 'wp-config.php', 25 ),
		] );

		await expect( measureSiteStorage( sitePath ) ).resolves.toEqual( {
			total: 800,
			uploads: 400,
			plugins: 200,
			themes: 100,
			database: 50,
			other: 50,
		} );
	} );

	it( 'does not follow symbolic links', async () => {
		const sitePath = await createSite();
		const outsidePath = await createSite();
		await createFile( outsidePath, 'large-file.bin', 1024 );
		await fs.symlink( outsidePath, path.join( sitePath, 'linked-content' ) );

		await expect( measureSiteStorage( sitePath ) ).resolves.toEqual( {
			total: 0,
			uploads: 0,
			plugins: 0,
			themes: 0,
			database: 0,
			other: 0,
		} );
	} );

	it( 'returns zero usage when the site path cannot be read', async () => {
		await expect( measureSiteStorage( '/path/that/does/not/exist' ) ).resolves.toEqual( {
			total: 0,
			uploads: 0,
			plugins: 0,
			themes: 0,
			database: 0,
			other: 0,
		} );
	} );
} );
