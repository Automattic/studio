import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openBlueprint } from './node';

// formwork/blueprint.json ({ "landingPage": "/formwork" }) and formwork/content.xml.
const BUNDLE = Buffer.from(
	'UEsDBAoAAAAAAFpFbF0AAAAAAAAAAAAAAAAJAAAAZm9ybXdvcmsvUEsDBAoAAAAAAFpFbF3OS9pxGwAAABsAAAAXAAAAZm9ybXdvcmsvYmx1ZXByaW50Lmpzb257ImxhbmRpbmdQYWdlIjoiL2Zvcm13b3JrIn1QSwMECgAAAAAAWkVsXWcpKL0GAAAABgAAABQAAABmb3Jtd29yay9jb250ZW50LnhtbDxyc3MvPlBLAQIeAwoAAAAAAFpFbF0AAAAAAAAAAAAAAAAJAAAAAAAAAAAAEADtQQAAAABmb3Jtd29yay9QSwECHgMKAAAAAABaRWxdzkvacRsAAAAbAAAAFwAAAAAAAAABAAAApIEnAAAAZm9ybXdvcmsvYmx1ZXByaW50Lmpzb25QSwECHgMKAAAAAABaRWxdZykovQYAAAAGAAAAFAAAAAAAAAABAAAApIF3AAAAZm9ybXdvcmsvY29udGVudC54bWxQSwUGAAAAAAMAAwC+AAAArwAAAAAA',
	'base64'
);
const library = {
	slug: 'formwork',
	title: 'Formwork',
	excerpt: '',
	image: '',
	playgroundUrl: '',
	blueprint: { landingPage: '/library-copy' },
};

let directory: string;
beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-open-blueprint-test-' ) );
} );
afterEach( async () => {
	vi.restoreAllMocks();
	await fs.rm( directory, { recursive: true, force: true } );
} );

function serve( body: Buffer | string, ok = true ) {
	return vi.spyOn( globalThis, 'fetch' ).mockResolvedValue(
		new Response( typeof body === 'string' ? body : new Uint8Array( body ), {
			status: ok ? 200 : 404,
		} )
	);
}

async function expectBundle( source: Parameters< typeof openBlueprint >[ 0 ] ) {
	let blueprintPath: string;
	{
		await using opened = await openBlueprint( source );
		blueprintPath = opened.path;
		expect( opened.blueprint ).toEqual( { landingPage: '/formwork' } );
		expect( path.relative( path.dirname( path.dirname( blueprintPath ) ), blueprintPath ) ).toBe(
			path.join( 'formwork', 'blueprint.json' )
		);
		expect(
			await fs.readFile( path.join( path.dirname( blueprintPath ), 'content.xml' ), 'utf8' )
		).toBe( '<rss/>' );
	}
	await expect( fs.access( blueprintPath ) ).rejects.toThrow();
}

describe( 'openBlueprint', () => {
	it( 'opens a .json file and a folder in place', async () => {
		const filePath = path.join( directory, 'blueprint.json' );
		await fs.writeFile( filePath, '{"landingPage":"/shop"}' );

		for ( const source of [ filePath, directory ] ) {
			await using opened = await openBlueprint( source );
			expect( opened ).toMatchObject( { blueprint: { landingPage: '/shop' }, path: filePath } );
		}
		expect( await fs.readFile( filePath, 'utf8' ) ).toBe( '{"landingPage":"/shop"}' );
	} );

	it( 'unpacks a zip bundle and removes it once disposed', async () => {
		const zipPath = path.join( directory, 'formwork.zip' );
		await fs.writeFile( zipPath, BUNDLE );
		await expectBundle( zipPath );
	} );

	it( 'opens a Blueprint or a bundle from a URL', async () => {
		serve( '{"landingPage":"/shop"}' );
		{
			await using opened = await openBlueprint( 'https://example.com/blueprint.json' );
			expect( opened.blueprint ).toEqual( { landingPage: '/shop' } );
			expect( JSON.parse( await fs.readFile( opened.path, 'utf8' ) ) ).toEqual( opened.blueprint );
		}
		serve( BUNDLE );
		await expectBundle( 'https://example.com/formwork.zip' );
	} );

	it( 'opens a Library slug or entry, preferring its bundle', async () => {
		serve( BUNDLE );
		await expectBundle( { ...library, bundleUrl: 'https://example.com/formwork.zip' } );

		vi.spyOn( globalThis, 'fetch' ).mockResolvedValue(
			new Response( JSON.stringify( { blueprints: [ { ...library, playground_url: '' } ] } ) )
		);
		await using opened = await openBlueprint( 'formwork' );
		expect( opened.blueprint ).toEqual( { landingPage: '/library-copy' } );
	} );

	it( 'reports a missing file, an unknown slug and an invalid Blueprint', async () => {
		await expect( openBlueprint( path.join( directory, 'missing.json' ) ) ).rejects.toThrow(
			'Blueprint file not found'
		);
		serve( JSON.stringify( { blueprints: [] } ) );
		await expect( openBlueprint( 'unknown' ) ).rejects.toThrow(
			'not a Blueprint file, URL or Library slug'
		);
		await fs.writeFile( path.join( directory, 'blueprint.json' ), '{"name":"package"}' );
		await expect( openBlueprint( directory ) ).rejects.toThrow( 'not a valid Blueprint property' );
	} );
} );
