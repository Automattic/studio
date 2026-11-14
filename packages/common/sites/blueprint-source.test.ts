import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBlueprintSource } from './blueprint-source';

let directory: string;
beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-source-test-' ) );
} );
afterEach( async () => {
	await fs.rm( directory, { recursive: true, force: true } );
} );

describe( 'readBlueprintSource', () => {
	it( 'reads a Blueprint file or folder without changing it', async () => {
		const filePath = path.join( directory, 'blueprint.json' );
		await fs.writeFile( filePath, '{}' );
		expect( await readBlueprintSource( directory ) ).toEqual( {} );
		expect( await readBlueprintSource( filePath ) ).toEqual( {} );
		expect( await fs.readFile( filePath, 'utf8' ) ).toBe( '{}' );
	} );

	it( 'leaves ordinary folders to the site folder flow', async () => {
		expect( await readBlueprintSource( directory ) ).toBeNull();
	} );

	it( 'reports malformed Blueprint JSON', async () => {
		await fs.writeFile( path.join( directory, 'blueprint.json' ), 'broken' );
		await expect( readBlueprintSource( directory ) ).rejects.toThrow( 'valid JSON' );
	} );
} );
