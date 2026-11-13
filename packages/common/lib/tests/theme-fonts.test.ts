import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selfHostThemeJsonFonts } from '../theme-fonts';
import type { AddressInfo } from 'node:net';

// Google Fonts as a theme's browser meets it: a css2 stylesheet that names its woff2 files.
const FONT = Buffer.from( 'wOF2 font data' );

describe( 'selfHostThemeJsonFonts', () => {
	let server: http.Server;
	let origin: string;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			if ( request.url?.startsWith( '/css2' ) ) {
				response.writeHead( 200, { 'content-type': 'text/css; charset=utf-8' } );
				response.end(
					[ 'normal', 'italic' ]
						.map(
							( style ) =>
								`@font-face { font-family: 'Newsreader'; font-style: ${ style }; font-weight: 400 700; src: url(${ origin }/newsreader-${ style }.woff2) format('woff2'); }`
						)
						.join( '\n' )
				);
				return;
			}
			response.writeHead( 200, { 'content-type': 'font/woff2' } );
			response.end( FONT );
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		origin = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );
	afterAll( () => server.close() );

	// eval-compare's Lotus Flow run: a fontFace naming the css2 stylesheet as its file
	// got the stylesheet saved as assets/fonts/serif/css2.
	it( 'downloads the font files a stylesheet named as a fontFace src declares', async () => {
		const themeDir = await mkdtemp( path.join( tmpdir(), 'theme-fonts-' ) );
		const stylesheet = `${ origin }/css2?family=Newsreader:ital,wght@0,400..700;1,400..700`;
		await writeFile( path.join( themeDir, 'style.css' ), '/* Theme Name: Lotus */' );
		await writeFile(
			path.join( themeDir, 'theme.json' ),
			JSON.stringify( {
				version: 3,
				settings: {
					typography: {
						fontFamilies: [
							{
								slug: 'serif',
								name: 'Newsreader',
								fontFamily: 'Newsreader, Georgia, serif',
								fontFace: [ 'normal', 'italic' ].map( ( fontStyle ) => ( {
									fontFamily: 'Newsreader',
									fontStyle,
									fontWeight: '400 700',
									src: [ stylesheet ],
								} ) ),
							},
						],
					},
				},
			} )
		);

		const result = await selfHostThemeJsonFonts( themeDir );

		const themeJson = JSON.parse( await readFile( path.join( themeDir, 'theme.json' ), 'utf8' ) );
		const faces = themeJson.settings.typography.fontFamilies[ 0 ].fontFace;
		expect( result.downloaded ).toEqual( [ 'Newsreader' ] );
		expect( faces.map( ( face: { fontStyle: string; src: string[] } ) => face.src ) ).toEqual( [
			[ 'file:./assets/fonts/newsreader/newsreader-400-700.woff2' ],
			[ 'file:./assets/fonts/newsreader/newsreader-400-700-italic.woff2' ],
		] );
		const dir = path.join( themeDir, 'assets', 'fonts', 'newsreader' );
		expect( ( await readdir( dir ) ).sort() ).toEqual( [
			'newsreader-400-700-italic.woff2',
			'newsreader-400-700.woff2',
		] );
		expect( await readFile( path.join( dir, 'newsreader-400-700.woff2' ) ) ).toEqual( FONT );
	} );
} );
