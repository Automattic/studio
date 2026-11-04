import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
	extractBlueprintBundle,
	cleanupBlueprintTempDir,
} from '@studio/common/sites/blueprint-extract';
import { ZipArchive } from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';

describe( 'extractBlueprintBundle', () => {
	const temporaryDirectories: string[] = [];
	afterEach( async () => {
		await Promise.all(
			temporaryDirectories
				.splice( 0 )
				.map( ( directory ) => fs.rm( directory, { recursive: true, force: true } ) )
		);
	} );

	async function bundle( entries: Record< string, string >, filename = 'a different-name.zip' ) {
		const directory = await fs.mkdtemp( path.join( os.tmpdir(), 'blueprint-test-' ) );
		temporaryDirectories.push( directory );
		const zipPath = path.join( directory, filename );
		const archive = new ZipArchive();
		const writing = pipeline( archive, createWriteStream( zipPath ) );
		for ( const [ name, contents ] of Object.entries( entries ) )
			archive.append( contents, { name } );
		await archive.finalize();
		await writing;
		return zipPath;
	}

	it.each( [ '', 'folder with spaces/', 'different-folder-name/' ] )(
		'loads a Blueprint at %s and keeps resources relative to it',
		async ( prefix ) => {
			const blueprint = {
				meta: { title: 'Fashion Magazine', author: 'Studio' },
				siteOptions: { blogname: 'SYSTEM' },
			};
			const zipPath = await bundle( {
				[ prefix + 'blueprint.json' ]: JSON.stringify( blueprint ),
				[ prefix + 'theme.zip' ]: 'theme data',
			} );
			const extracted = await extractBlueprintBundle( zipPath );
			try {
				expect( extracted.blueprintJson ).toEqual( blueprint );
				expect(
					await fs.readFile(
						path.join( path.dirname( extracted.blueprintJsonPath ), 'theme.zip' ),
						'utf8'
					)
				).toBe( 'theme data' );
			} finally {
				await cleanupBlueprintTempDir( extracted.tempDir );
			}
			await expect( fs.access( extracted.tempDir ) ).rejects.toThrow();
		}
	);

	it( 'prefers a root Blueprint over nested ones', async () => {
		const zipPath = await bundle( {
			'blueprint.json': '{"siteOptions":{"blogname":"Root"}}',
			'nested/blueprint.json': '{}',
		} );
		const extracted = await extractBlueprintBundle( zipPath );
		try {
			expect( extracted.blueprintJson.siteOptions?.blogname ).toBe( 'Root' );
		} finally {
			await cleanupBlueprintTempDir( extracted.tempDir );
		}
	} );

	it.each( [
		[ { 'theme.zip': 'data' }, /No blueprint.json/ ],
		[ { 'one/blueprint.json': '{}', 'two/blueprint.json': '{}' }, /Multiple Blueprints/ ],
		[ { 'one/two/blueprint.json': '{}' }, /No blueprint.json/ ],
		[ { 'blueprint.json': 'invalid JSON' }, /JSON/ ],
	] as const )( 'rejects invalid or ambiguous bundles', async ( entries, message ) => {
		await expect( extractBlueprintBundle( await bundle( entries ) ) ).rejects.toThrow( message );
	} );
} );
