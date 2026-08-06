/**
 * @vitest-environment node
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureSiteStorage } from './storage-usage';

describe( 'measureSiteStorage', () => {
	let siteRoot: string;

	beforeEach( async () => {
		siteRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-storage-' ) );
	} );

	afterEach( async () => {
		await fs.rm( siteRoot, { recursive: true, force: true } );
	} );

	async function writeFile( relativePath: string, bytes: number ): Promise< void > {
		const filePath = path.join( siteRoot, relativePath );
		await fs.mkdir( path.dirname( filePath ), { recursive: true } );
		await fs.writeFile( filePath, Buffer.alloc( bytes ) );
	}

	it( 'splits a site into the buckets it is made of', async () => {
		await writeFile( 'wp-content/uploads/2026/06/photo.jpg', 400 );
		await writeFile( 'wp-content/plugins/akismet/akismet.php', 200 );
		await writeFile( 'wp-content/themes/twentytwentysix/style.css', 100 );
		await writeFile( 'wp-content/database/.ht.sqlite', 50 );
		await writeFile( 'wp-load.php', 25 );
		// Not one of the named buckets, and not under wp-content either.
		await writeFile( 'wp-includes/version.php', 25 );

		const usage = await measureSiteStorage( siteRoot );

		expect( usage ).toEqual( {
			total: 800,
			uploads: 400,
			plugins: 200,
			themes: 100,
			database: 50,
			other: 50,
		} );
	} );

	it( 'always adds up: the buckets sum to the total', async () => {
		await writeFile( 'wp-content/uploads/a.bin', 10 );
		await writeFile( 'wp-content/mu-plugins/loader.php', 20 );
		await writeFile( 'index.php', 30 );

		const { total, ...parts } = await measureSiteStorage( siteRoot );

		expect( Object.values( parts ).reduce( ( sum, bytes ) => sum + bytes, 0 ) ).toBe( total );
	} );

	it( 'reports zeroes for a path that does not exist', async () => {
		const usage = await measureSiteStorage( path.join( siteRoot, 'missing' ) );

		expect( usage.total ).toBe( 0 );
	} );
} );
