import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeThemeThumbnail } from '@studio/agent/node/site-file-guards';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';

const host = createFakeHost();

// The design board each capture was given.
const boards: string[] = [];

vi.mock( '@studio/agent/node/tools/screenshot-helpers', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/tools/screenshot-helpers') >() ),
	captureScreenshotBuffer: async ( url: string ) => {
		boards.push( readFileSync( new URL( url ), 'utf8' ) );
		return { buffer: Buffer.from( 'png' ), mimeType: 'image/png' };
	},
} ) );

const themeJson = ( colors: string[], styles: object = {} ) =>
	JSON.stringify( {
		version: 3,
		settings: {
			color: {
				palette: colors.map( ( color, i ) => ( { slug: `c${ i }`, name: `C${ i }`, color } ) ),
			},
		},
		styles: { typography: { fontFamily: 'Figtree, sans-serif' }, ...styles },
	} );

describe( "a theme's thumbnail, once the files that make it a theme are written", () => {
	let themes: string;
	beforeAll( () => {
		themes = path.join(
			mkdtempSync( path.join( os.tmpdir(), 'thumbnail-' ) ),
			'wp-content/themes'
		);
		mkdirSync( path.join( themes, 'parent' ), { recursive: true } );
		writeFileSync(
			path.join( themes, 'parent/theme.json' ),
			themeJson( [ '#112233', '#445566' ] )
		);
	} );
	afterAll( () =>
		rmSync( path.dirname( path.dirname( themes ) ), { recursive: true, force: true } )
	);

	it.each< { name: string; files: Record< string, string >; written: string; colors?: string[] } >(
		[
			{
				name: "is a child theme's, from its parent's theme.json",
				files: { 'style.css': '/*\nTheme Name: Child\nTemplate: parent\n*/' },
				written: 'style.css',
				colors: [ '#112233', '#445566' ],
			},
			{
				name: "is a child theme's, whose palette replaces its parent's",
				files: {
					'style.css': '/*\nTemplate: parent\n*/',
					'theme.json': themeJson( [ '#aa0000', '#00bb00' ] ),
				},
				written: 'theme.json',
				colors: [ '#aa0000', '#00bb00' ],
			},
			{
				name: "is a child theme's, whose styles keep its parent's palette",
				files: {
					'style.css': '/*\nTemplate: parent\n*/',
					'theme.json': JSON.stringify( { version: 3, styles: { color: { text: '#000000' } } } ),
				},
				written: 'theme.json',
				colors: [ '#112233', '#445566' ],
			},
			{
				name: 'is not made for a theme with no theme.json to draw',
				files: { 'style.css': '/*\nTheme Name: Classic\n*/' },
				written: 'style.css',
			},
			{
				name: 'is not made for a theme with a screenshot',
				files: { 'style.css': '/*\nTemplate: parent\n*/', 'screenshot.jpg': 'jpg' },
				written: 'style.css',
			},
			{
				name: 'is made on a write to its other files, when an earlier write made none',
				files: { 'style.css': '/*\nTemplate: parent\n*/', 'templates/index.html': '' },
				written: 'templates/index.html',
				colors: [ '#112233', '#445566' ],
			},
		]
	)(
		'$name',
		async ( { name, files, written, colors } ) => {
			const slug = `studio-test-${ name.replace( /\W+/g, '-' ) }`;
			const dir = path.join( themes, slug );
			for ( const [ file, text ] of Object.entries( files ) ) {
				mkdirSync( path.dirname( path.join( dir, file ) ), { recursive: true } );
				writeFileSync( path.join( dir, file ), text );
			}
			boards.length = 0;
			const notes = await writeThemeThumbnail( host, {
				siteRoot: path.dirname( path.dirname( themes ) ),
				relativePath: `wp-content/themes/${ slug }/${ written }`,
				theme: { slug, dir, file: written },
			} );
			expect( existsSync( path.join( dir, 'screenshot.png' ) ) ).toBe( Boolean( colors ) );
			expect( notes ).toHaveLength( colors ? 1 : 0 );
			expect( boards ).toHaveLength( colors ? 1 : 0 );
			for ( const color of colors ?? [] ) {
				expect( boards[ 0 ].toLowerCase() ).toContain( color );
			}
			for ( const color of [ '#112233', '#aa0000' ].filter(
				( c ) => colors && ! colors.includes( c )
			) ) {
				expect( boards[ 0 ].toLowerCase() ).not.toContain( color );
			}
		},
		60_000
	);

	it( 'is made once for writes to one theme that run at once', async () => {
		const slug = 'studio-test-at-once';
		const dir = path.join( themes, slug );
		mkdirSync( dir, { recursive: true } );
		writeFileSync( path.join( dir, 'style.css' ), '/*\nTemplate: parent\n*/' );
		writeFileSync( path.join( dir, 'theme.json' ), themeJson( [ '#aa0000' ] ) );
		boards.length = 0;
		const write = ( file: string ) =>
			writeThemeThumbnail( host, {
				siteRoot: path.dirname( path.dirname( themes ) ),
				relativePath: `wp-content/themes/${ slug }/${ file }`,
				theme: { slug, dir, file },
			} );
		const notes = await Promise.all( [ write( 'style.css' ), write( 'theme.json' ) ] );
		expect( notes.flat() ).toHaveLength( 1 );
		expect( boards ).toHaveLength( 1 );
		// And again once it is made, should its screenshot go.
		rmSync( path.join( dir, 'screenshot.png' ) );
		expect( await write( 'theme.json' ) ).toHaveLength( 1 );
	}, 60_000 );
} );
