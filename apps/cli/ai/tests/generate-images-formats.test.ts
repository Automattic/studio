import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateImagesTool } from 'cli/ai/tools/generate-images';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { SiteData } from 'cli/lib/cli-config/core';

// A real WordPress install to save the images with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;
const site = { id: 'formats', name: 'Formats' } as SiteData;

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: async () => ( { sites: [ site ] } ),
} ) );
// The image model's PNG, truecolor as it delivers: one core ships.
vi.mock( 'cli/ai/image-generation', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/image-generation') >() ),
	isImageGenerationAvailable: async () => true,
	generateImages: async ( requests: unknown[] ) =>
		requests.map( () => ( {
			ok: true,
			bytes: readFileSync( path.join( WORDPRESS!, 'wp-includes/images/rss-2x.png' ) ),
		} ) ),
} ) );

const JPEG = 'ffd8ff';
const PNG = '89504e47';
const WEBP = '52494646';

describe.runIf( WORDPRESS )(
	'generate_images saves each image in the format its path names',
	() => {
		beforeAll( () => {
			site.path = mkdtempSync( path.join( STUDIO_SITES_ROOT, 'studio-test-formats-' ) );
			cpSync( WORDPRESS!, site.path, { recursive: true } );
		} );
		afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

		const generate = async ( file: string ) => {
			const result = await generateImagesTool.rawHandler( {
				images: [ { path: path.join( site.path, file ), subject: 'a bench' } ],
			} as never );
			const [ content ] = result.content;
			return {
				text: content.type === 'text' ? content.text : '',
				failure: await result.pending,
			};
		};
		const magic = ( file: string, length: number ) =>
			readFileSync( file ).subarray( 0, length ).toString( 'hex' );

		it.each< { file: string; signature: string } >( [
			{ file: 'wp-content/themes/twentytwentyfive/assets/images/a.png', signature: PNG },
			{ file: 'wp-content/themes/twentytwentyfive/assets/images/b.jpg', signature: JPEG },
			{ file: 'wp-content/themes/twentytwentyfive/assets/images/c.JPEG', signature: JPEG },
			{ file: 'wp-content/themes/twentytwentyfive/assets/images/d.webp', signature: WEBP },
		] )(
			'$file',
			async ( { file, signature } ) => {
				const { failure } = await generate( file );

				expect( failure ).toBeUndefined();
				const saved = path.join( site.path, file );
				expect( magic( saved, signature.length / 2 ) ).toBe( signature );
				expect(
					readdirSync( path.dirname( saved ) ).filter( ( name ) => name.startsWith( '.' ) )
				).toEqual( [] );
			},
			120000
		);

		it( 'adds a .jpg under uploads to the media library as a JPEG', async () => {
			const { text, failure } = await generate( 'wp-content/uploads/hero.jpg' );

			expect( failure ).toBeUndefined();
			const [ , file, id ] = text.match( /- (\S+), attachment ID (\d+)/ )!;
			expect( magic( file, 3 ) ).toBe( JPEG );
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
			const row = db
				.prepare( 'SELECT post_mime_type FROM wp_posts WHERE ID = ?' )
				.get( Number( id ) );
			db.close();
			expect( row ).toEqual( { post_mime_type: 'image/jpeg' } );
		}, 120000 );

		it( 'reports, as WordPress gives it, a format its image editor does not save', async () => {
			const file = 'wp-content/themes/twentytwentyfive/assets/images/e.txt';
			const { failure } = await generate( file );

			expect( failure ).toContain( 'FAILED ' + path.join( site.path, file ) );
			expect( failure ).toContain( "WordPress's image editor does not save .txt files" );
			expect( existsSync( path.join( site.path, file ) ) ).toBe( false );
			expect(
				readdirSync( path.dirname( path.join( site.path, file ) ) ).filter( ( name ) =>
					name.startsWith( '.' )
				)
			).toEqual( [] );
		}, 120000 );

		it( 'removes the attachment it reserved for an image WordPress does not save', async () => {
			const { text, failure } = await generate( 'wp-content/uploads/notes.txt' );

			expect( failure ).toContain( "WordPress's image editor does not save .txt files" );
			const [ , id ] = text.match( /attachment ID (\d+)/ )!;
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
			const row = db.prepare( 'SELECT ID FROM wp_posts WHERE ID = ?' ).get( Number( id ) );
			db.close();
			expect( row ).toBeUndefined();
		}, 120000 );

		it( 'reports a .jpg in no site, whose WordPress would save it', async () => {
			const dir = mkdtempSync( path.join( STUDIO_SITES_ROOT, 'studio-test-no-site-' ) );
			try {
				const result = await generateImagesTool.rawHandler( {
					images: [ { path: path.join( dir, 'a.jpg' ), subject: 'a bench' } ],
				} as never );

				expect( await result.pending ).toContain( 'it is in no Studio site' );
				expect( readdirSync( dir ) ).toEqual( [] );
			} finally {
				rmSync( dir, { recursive: true, force: true } );
			}
		} );
	}
);
