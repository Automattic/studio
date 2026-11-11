import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bakedSceneFile, sceneFile } from '../scene.ts';

let temp: string;
afterEach( async () => {
	await rm( temp, { recursive: true, force: true } );
} );

describe( 'sceneFile', () => {
	it( 'prefers the copy baked beside a scene, unless asked for the scene as written', async () => {
		temp = await mkdtemp( path.join( tmpdir(), 'capture-scene-' ) );
		const file = path.join( temp, 'scene.json' );
		await writeFile( file, '{}' );
		expect( sceneFile( file ) ).toBe( file );

		await mkdir( path.join( temp, '.baked' ) );
		await writeFile( bakedSceneFile( file ), '{}' );
		expect( sceneFile( file ) ).toBe( path.join( temp, '.baked', 'scene.json' ) );
		expect( sceneFile( file, undefined, { baked: false } ) ).toBe( file );
	} );
} );
