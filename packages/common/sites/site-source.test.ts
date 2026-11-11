import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSiteSource } from './site-source';

let folder: string;
beforeEach( async () => {
	folder = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-site-source-test-' ) );
} );
afterEach( async () => fs.rm( folder, { recursive: true, force: true } ) );

describe( 'readSiteSource', () => {
	it( 'recognizes WordPress in place even when it contains a blueprint.json', async () => {
		await fs.mkdir( path.join( folder, 'wp-content' ) );
		await fs.mkdir( path.join( folder, 'wp-includes' ) );
		await fs.writeFile( path.join( folder, 'wp-load.php' ), 'existing site' );
		await fs.writeFile( path.join( folder, 'blueprint.json' ), '{}' );
		expect( await readSiteSource( folder ) ).toEqual( {
			path: folder,
			name: path.basename( folder ),
			isEmpty: false,
			isWordPress: true,
		} );
		expect( await fs.readFile( path.join( folder, 'wp-load.php' ), 'utf8' ) ).toBe(
			'existing site'
		);
	} );
	it( 'recognizes a Blueprint file and a Blueprint folder', async () => {
		const source = path.join( folder, 'blueprint.json' );
		await fs.writeFile( source, '{"steps":[]}' );
		for ( const selected of [ source, folder ] ) {
			expect( await readSiteSource( selected ) ).toMatchObject( {
				blueprint: { blueprintJson: { steps: [] }, blueprintJsonPath: source },
				isWordPress: false,
			} );
		}
	} );
	it.each( [ 'backup.wpress', 'export.xml', 'backup.tar.gz' ] )(
		'returns the original file path for %s',
		async ( name ) => {
			const source = path.join( folder, name );
			await fs.writeFile( source, 'source' );
			expect( await readSiteSource( source ) ).toMatchObject( {
				file: { name, path: source },
				isWordPress: false,
			} );
		}
	);
	it( 'treats a ZIP without a Blueprint as a backup', async () => {
		const source = path.join( folder, 'backup.zip' );
		await fs.writeFile( source, Buffer.from( 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64' ) );
		expect( await readSiteSource( source ) ).toMatchObject( {
			file: { path: source, name: 'backup.zip' },
		} );
	} );
	it( 'reports malformed Blueprints and unsupported files', async () => {
		const source = path.join( folder, 'blueprint.json' );
		await fs.writeFile( source, 'broken' );
		await expect( readSiteSource( source ) ).rejects.toThrow( 'valid JSON' );
		const other = path.join( folder, 'other.txt' );
		await fs.writeFile( other, 'text' );
		await expect( readSiteSource( other ) ).rejects.toThrow( 'Choose a blueprint' );
	} );
} );
