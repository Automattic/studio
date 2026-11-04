import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupBlueprintTempDir } from './blueprint-extract';
import { readBlueprintSource } from './blueprint-source';

let directory: string;
beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-source-test-' ) );
} );
afterEach( async () => {
	await fs.rm( directory, { recursive: true, force: true } );
} );

describe( 'readBlueprintSource', () => {
	it( 'loads a Blueprint folder without changing its source files', async () => {
		const filePath = path.join( directory, 'blueprint.json' );
		await fs.writeFile( filePath, '{}' );
		expect( await readBlueprintSource( directory ) ).toEqual( {
			blueprintJson: {},
			blueprintJsonPath: filePath,
		} );
		expect( await readBlueprintSource( filePath ) ).toEqual( {
			blueprintJson: {},
			blueprintJsonPath: filePath,
		} );
		expect( await fs.readFile( filePath, 'utf8' ) ).toBe( '{}' );
	} );
	it( 'leaves ordinary folders to the site folder flow', async () => {
		expect( await readBlueprintSource( directory ) ).toBeNull();
	} );
	it( 'reports malformed Blueprint JSON', async () => {
		await fs.writeFile( path.join( directory, 'blueprint.json' ), 'broken' );
		await expect( readBlueprintSource( directory ) ).rejects.toThrow( 'valid JSON' );
	} );
	it( 'preserves the asset base of a ZIP with one enclosing folder', async () => {
		const filePath = path.join( directory, 'formwork.zip' );
		await fs.writeFile(
			filePath,
			Buffer.from(
				'UEsDBBQAAAAIAPKRY13V8OaSIwAAACEAAAAXAAAAZm9ybXdvcmsvYmx1ZXByaW50Lmpzb26rVspNLUlUsqpWKsksyUlVslJyKs1LyUlNUSjOLElVqq0FAFBLAwQUAAAACADykWNdZykovQgAAAAGAAAAFAAAAGZvcm13b3JrL2NvbnRlbnQueG1ssykqLta3AwBQSwECFAMUAAAACADykWNd1fDmkiMAAAAhAAAAFwAAAAAAAAAAAAAAgAEAAAAAZm9ybXdvcmsvYmx1ZXByaW50Lmpzb25QSwECFAMUAAAACADykWNdZykovQgAAAAGAAAAFAAAAAAAAAAAAAAAgAFYAAAAZm9ybXdvcmsvY29udGVudC54bWxQSwUGAAAAAAIAAgCHAAAAkgAAAAAA',
				'base64'
			)
		);
		const source = await readBlueprintSource( filePath );
		try {
			expect( source?.blueprintJson ).toEqual( { meta: { title: 'Bundled site' } } );
			expect( source?.blueprintJsonPath ).toBe(
				path.join( source!.tempDir!, 'formwork', 'blueprint.json' )
			);
			expect(
				await fs.readFile(
					path.join( path.dirname( source!.blueprintJsonPath ), 'content.xml' ),
					'utf8'
				)
			).toBe( '<rss/>' );
		} finally {
			if ( source?.tempDir ) await cleanupBlueprintTempDir( source.tempDir );
		}
	} );
} );
