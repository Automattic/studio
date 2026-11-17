import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSiteFile } from '@studio/agent/node/site-file';
import {
	blockMarkupNotes,
	clearThemePatternCache,
	quoteFontFamilies,
	selfHostFonts,
} from '@studio/agent/node/site-file-guards';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';
import { lintThemeCss } from '@studio/agent/node/theme-css-notes';

let site: string;

function write( relativePath: string, content: string ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	return file;
}

beforeEach( () => {
	site = mkdtempSync( path.join( os.tmpdir(), 'studio-guards-' ) );
	mkdirSync( path.join( site, 'wp-includes' ) );
	write( 'wp-content/themes/twentytwentyfive/style.css', '/* Theme Name: Twenty Twenty-Five */' );
	write(
		'wp-content/themes/mine/style.css',
		'/* Theme Name: Mine\nDescription: A custom block theme scaffolded by Studio Code. */'
	);
} );

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

describe( 'theme CSS lint', () => {
	// eval30 pileon: a paragraph in a column, which no auto margins place, was
	// noted from the stylesheet's text on every write. Where a class's blocks
	// sit is checked against WordPress's blocks (inline-block-classes.ts).
	it( 'leaves an inline-level display on a class to the check of where its blocks sit', () => {
		expect(
			lintThemeCss(
				'.eyebrow { display: inline-block; padding: 4px 12px; } .badge span { display: inline }'
			)
		).toEqual( [] );
	} );

	it.each( [
		[ '.hero { width: 100vw; margin-left: calc(50% - 50vw) }', 1 ],
		[ '.hero { width: 100dvw }', 1 ],
		[ '.hero { max-width: 100vw }', 0 ],
		[ '.hero { width: 100% }', 0 ],
	] )( 'flags a viewport-width breakout in %s: %d', ( css, count ) => {
		expect( lintThemeCss( css ) ).toHaveLength( count );
	} );

	it( 'flags box styles on the button wrapper, not the link', () => {
		expect( lintThemeCss( '.wp-block-button { padding: 1rem }' ) ).toHaveLength( 1 );
		expect( lintThemeCss( '.wp-block-button .wp-element-button { padding: 1rem }' ) ).toEqual( [] );
	} );
} );

describe( 'clearThemePatternCache', () => {
	it( 'clears the cache of the theme whose pattern file changed, and only then', async () => {
		const host = createFakeHostWithSites( [ { path: site } ] );
		write( 'wp-includes/version.php', '' );
		write( 'wp-content/index.php', '' );
		await clearThemePatternCache(
			host,
			resolveSiteFile( path.join( site, 'wp-content/themes/acme/style.css' ) )!
		);
		expect( host.sites.wpCli ).not.toHaveBeenCalled();
		await clearThemePatternCache(
			host,
			resolveSiteFile( path.join( site, 'wp-content/themes/acme/patterns/hero.php' ) )!
		);
		expect( host.sites.wpCli ).toHaveBeenCalledWith( expect.objectContaining( { path: site } ), [
			'eval',
			'wp_get_theme( "acme" )->delete_pattern_cache();',
		] );
	} );
} );

describe( 'block markup notes', () => {
	const trapped =
		'<!-- wp:group {"layout":{"type":"constrained"}} --><div><!-- wp:group {"layout":{"type":"constrained"}} --><div><!-- wp:cover {"align":"full"} --><div></div><!-- /wp:cover --></div><!-- /wp:group --></div><!-- /wp:group -->';

	// A draft is block markup wherever it is written; a file that does not open with a block is not.
	it.each( [
		[ 'wp-content/uploads/home.tmp.html', trapped, 1 ],
		[ 'tmp/page-home.html', trapped, 1 ],
		[ 'notes.md', `Draft:\n${ trapped }`, 0 ],
		// And a button that opens nothing is a note of its own.
		[
			'tmp/shop.html',
			`${ trapped }<!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Add</a></div><!-- /wp:button -->`,
			2,
		],
	] )( '%s gets %s note(s)', ( relativePath, content, count ) => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'studio-markup-' ) );
		mkdirSync( path.join( root, 'wp-includes' ) );
		mkdirSync( path.join( root, 'wp-content' ) );
		mkdirSync( path.dirname( path.join( root, relativePath ) ), { recursive: true } );
		writeFileSync( path.join( root, relativePath ), content );
		const file = resolveSiteFile( path.join( root, relativePath ) )!;
		expect( blockMarkupNotes( file ) ).toHaveLength( count );
		rmSync( root, { recursive: true, force: true } );
	} );
} );

// eval19 branch run 4: "Source Sans 3", unquoted, and the body text showed in Times.
describe.runIf( existsSync( chromium.executablePath() ) )( 'theme font family names', () => {
	it( 'quotes the names CSS reads only quoted, so the browser takes the font', async () => {
		const families = [
			'Source Sans 3',
			"'Fraunces', serif",
			'Plus Jakarta Sans, sans-serif',
			'system-ui, -apple-system, Segoe UI, sans-serif',
		];
		const themeJson = write(
			'wp-content/themes/mine/theme.json',
			JSON.stringify( {
				settings: {
					typography: {
						fontFamilies: families.map( ( fontFamily, i ) => ( { slug: `f${ i }`, fontFamily } ) ),
					},
				},
				styles: {
					typography: { fontFamily: 'var:preset|font-family|f0' },
					elements: { h1: { typography: { fontFamily: 'Source Serif 4, serif' } } },
				},
			} )
		);
		await quoteFontFamilies( resolveSiteFile( themeJson )! );
		const json = JSON.parse( readFileSync( themeJson, 'utf8' ) );
		const quoted = [
			...json.settings.typography.fontFamilies.map(
				( family: { fontFamily: string } ) => family.fontFamily
			),
			json.styles.elements.h1.typography.fontFamily,
		];
		expect( quoted ).toEqual( [
			'"Source Sans 3"',
			"'Fraunces', serif",
			'"Plus Jakarta Sans", sans-serif',
			'system-ui, -apple-system, "Segoe UI", sans-serif',
			'"Source Serif 4", serif',
		] );
		expect( json.styles.typography.fontFamily ).toBe( 'var:preset|font-family|f0' );
		// The browser's CSS parser takes each as written now, and not the first as it was.
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();
			const valid = ( values: string[] ) =>
				page.evaluate(
					( list ) => list.map( ( value ) => CSS.supports( 'font-family', value ) ),
					values
				);
			expect( await valid( quoted ) ).toEqual( quoted.map( () => true ) );
			expect( await valid( [ families[ 0 ] ] ) ).toEqual( [ false ] );
		} finally {
			await browser.close();
		}
	} );
} );

describe( 'self-hosted theme fonts', () => {
	afterEach( () => vi.unstubAllGlobals() );

	it( "downloads each family's first font from Google Fonts, and names the fonts it does not serve", async () => {
		const requested: string[] = [];
		vi.stubGlobal( 'fetch', async ( url: string ) => {
			requested.push( url );
			if ( url.includes( 'family=Manrope:' ) ) {
				return new Response(
					[ 400, 700 ]
						.map(
							( weight ) =>
								`/* latin */ @font-face { font-family: 'Manrope'; font-style: normal; font-weight: ${ weight }; src: url(https://fonts.gstatic.com/manrope.woff2) format('woff2'); }`
						)
						.join( '\n' )
				);
			}
			if ( url === 'https://fonts.gstatic.com/manrope.woff2' ) {
				return new Response( 'woff2' );
			}
			return new Response( '', { status: 400 } );
		} );
		const themeJson = write(
			'wp-content/themes/mine/theme.json',
			JSON.stringify( {
				settings: {
					typography: {
						fontFamilies: [
							// A key the schema has no place for (eval29 redo port 3).
							{ name: 'Body', slug: 'body', fontFamily: 'Manrope, sans-serif', google: 'Manrope' },
							{ name: 'System Sans', slug: 'system', fontFamily: '-apple-system, sans-serif' },
							// Studio declares no fontFace for it, so leaves it as written.
							{ name: 'Held', slug: 'held', fontFamily: 'Held', fontFace: [ {} ], google: 'Held' },
						],
					},
				},
				styles: { elements: { h1: { typography: { fontWeight: '700' } } } },
			} )
		);

		expect( await selfHostFonts( resolveSiteFile( themeJson )! ) ).toEqual( [
			'Studio downloaded the font files of Body from Google Fonts into wp-content/themes/mine/assets/fonts and declared them as their fontFace in theme.json.',
			'Studio removed settings.typography.fontFamilies.0.google from wp-content/themes/mine/theme.json with the fontFace it declared, as the theme.json schema has no such key for a font family (WP_Theme_JSON::FONT_FAMILY_SCHEMA in wp-includes/class-wp-theme-json.php) and WordPress removes it as it reads the file.',
			"System Sans in wp-content/themes/mine/theme.json asks first for -apple-system, which Google Fonts does not serve (https://fonts.googleapis.com/css2?family=-apple-system:wght@400;700&display=swap responded with HTTP 400), so the font each visitor sees is whichever their device has. Twenty Twenty-Five ships each family's files in the theme and declares them as its fontFace: put -apple-system's files in wp-content/themes/mine/assets/fonts and declare them, or choose a Google Fonts family, which Studio downloads.",
		] );
		expect( requested ).toEqual( [
			'https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap',
			'https://fonts.gstatic.com/manrope.woff2',
			'https://fonts.googleapis.com/css2?family=-apple-system:wght@400;700&display=swap',
		] );
		const families = JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography
			.fontFamilies;
		expect( Object.keys( families[ 0 ] ) ).toEqual( [ 'name', 'slug', 'fontFamily', 'fontFace' ] );
		expect( families[ 2 ].google ).toBe( 'Held' );
		expect( families[ 0 ].fontFace ).toEqual( [
			{
				fontFamily: 'Manrope',
				fontStyle: 'normal',
				fontWeight: '400 700',
				src: [ 'file:./assets/fonts/manrope/manrope-400-700-latin.woff2' ],
			},
		] );
		expect(
			readFileSync(
				path.join(
					site,
					'wp-content/themes/mine/assets/fonts/manrope/manrope-400-700-latin.woff2'
				),
				'utf8'
			)
		).toBe( 'woff2' );
	} );

	// WordPress takes each src as a bare URL and drops one whose extension is not
	// a font format (WP_Font_Face::order_src()), so a CSS url() source loads nothing.
	it.each( [
		'https://fonts.gstatic.com/s/nunito/v26/XRXV.woff2',
		"url(https://fonts.gstatic.com/s/nunito/v26/XRXV.woff2) format('woff2')",
	] )( 'downloads the font file a fontFace names by URL into the theme: %s', async ( src ) => {
		vi.stubGlobal( 'fetch', async () => new Response( 'woff2' ) );
		const themeJson = write(
			'wp-content/themes/mine/theme.json',
			JSON.stringify( {
				settings: {
					typography: {
						fontFamilies: [
							{
								name: 'Nunito',
								slug: 'nunito',
								fontFamily: 'Nunito, sans-serif',
								google: 'Nunito',
								fontFace: [
									{
										fontFamily: 'Nunito',
										src,
									},
								],
							},
						],
					},
				},
			} )
		);

		expect( await selfHostFonts( resolveSiteFile( themeJson )! ) ).toHaveLength( 2 );
		expect(
			JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontFamilies[ 0 ]
		).toEqual( {
			name: 'Nunito',
			slug: 'nunito',
			fontFamily: 'Nunito, sans-serif',
			fontFace: [ { fontFamily: 'Nunito', src: 'file:./assets/fonts/nunito/XRXV.woff2' } ],
		} );
	} );

	it( 'downloads a family whose fontFace names files the browser cannot load', async () => {
		const requested: string[] = [];
		vi.stubGlobal( 'fetch', async ( url: string ) => {
			requested.push( url );
			if ( url.includes( 'offline.example.com' ) ) {
				throw new TypeError( 'fetch failed' );
			}
			if ( url.includes( 'gone' ) ) {
				return new Response( '', { status: 404 } );
			}
			return url.includes( 'googleapis' )
				? new Response(
						"/* latin */ @font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/fraunces.woff2) format('woff2'); }"
				  )
				: new Response( 'woff2' );
		} );
		const face = ( file: string ) => [
			{ fontFamily: 'F', src: [ `file:./assets/fonts/${ file }` ] },
		];
		const at = ( src: string ) => [ { fontFamily: 'F', src: [ src ] } ];
		// A font file another host serves is downloaded into the theme.
		const remote = at( 'https://cdn.example.com/files/remote.woff2' );
		// One a host that cannot be reached now may serve is left as written.
		const offline = at( 'https://offline.example.com/offline.woff2' );
		// The browser loads a data: URL as written.
		const inline = at( 'data:font/woff2;base64,d09GMg==' );
		write( 'wp-content/themes/parent/assets/fonts/inherited.woff2', 'woff2' );
		write( 'wp-content/themes/mine/style.css', '/*\nTheme Name: Mine\nTemplate: parent\n*/' );
		write( 'wp-content/themes/mine/assets/fonts/own.woff2', 'woff2' );
		const themeJson = write(
			'wp-content/themes/mine/theme.json',
			JSON.stringify( {
				settings: {
					typography: {
						fontFamilies: [
							{
								name: 'Fraunces',
								slug: 'serif',
								fontFamily: 'Fraunces, serif',
								fontFace: face( 'fraunces.woff2' ),
							},
							{ name: 'Own', slug: 'own', fontFamily: 'Own', fontFace: face( 'own.woff2' ) },
							{
								name: 'Inherited',
								slug: 'inherited',
								fontFamily: 'Inherited',
								fontFace: face( 'inherited.woff2' ),
							},
							{ name: 'Remote', slug: 'remote', fontFamily: 'Remote', fontFace: remote },
							{ name: 'Offline', slug: 'offline', fontFamily: 'Offline', fontFace: offline },
							{ name: 'Inline', slug: 'inline', fontFamily: 'Inline', fontFace: inline },
							{
								name: 'Gone',
								slug: 'gone',
								fontFamily: 'Gone',
								fontFace: at( 'https://fonts.gstatic.com/s/gone.woff2' ),
							},
							{
								name: 'Climbs',
								slug: 'climbs',
								fontFamily: 'Climbs',
								fontFace: at( 'file:../parent/assets/fonts/inherited.woff2' ),
							},
						],
					},
				},
			} )
		);

		expect( await selfHostFonts( resolveSiteFile( themeJson )! ) ).toEqual( [
			'Studio downloaded the font files the fontFace of Remote named by URL into wp-content/themes/mine/assets/fonts and named them as "file:./" sources in theme.json, so the site serves its own fonts, as the Font Library keeps each font it installs as a file on the site (wp_font_dir() in wp-includes/fonts.php).',
			'Studio downloaded the font files of Fraunces, Gone, Climbs from Google Fonts into wp-content/themes/mine/assets/fonts and declared them as their fontFace in theme.json, in place of the files the fontFace of Fraunces, Gone, Climbs named, which the browser cannot load: WordPress serves a "file:./" source from the theme or its parent (get_theme_file_uri() in wp-includes/link-template.php) and gives the browser any other source as written (WP_Font_Face_Resolver::to_theme_file_uri() in wp-includes/fonts/class-wp-font-face-resolver.php), so the browser was given font files that do not exist.',
		] );
		expect( requested ).toContain(
			'https://fonts.googleapis.com/css2?family=Fraunces:wght@400&display=swap'
		);
		expect( requested ).toContain(
			'https://fonts.googleapis.com/css2?family=Gone:wght@400&display=swap'
		);
		expect( requested ).toContain(
			'https://fonts.googleapis.com/css2?family=Climbs:wght@400&display=swap'
		);
		const families = JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography
			.fontFamilies;
		expect( families.map( ( family: { fontFace: unknown[] } ) => family.fontFace ) ).toEqual( [
			[
				{
					fontFamily: 'Fraunces',
					fontStyle: 'normal',
					fontWeight: '400',
					src: [ 'file:./assets/fonts/fraunces/fraunces-400-latin.woff2' ],
				},
			],
			face( 'own.woff2' ),
			face( 'inherited.woff2' ),
			at( 'file:./assets/fonts/remote/remote.woff2' ),
			offline,
			inline,
			...Array( 2 ).fill( [
				{
					fontFamily: 'Fraunces',
					fontStyle: 'normal',
					fontWeight: '400',
					src: [ 'file:./assets/fonts/fraunces/fraunces-400-latin.woff2' ],
				},
			] ),
		] );
		expect(
			readFileSync(
				path.join( path.dirname( themeJson ), 'assets/fonts/remote/remote.woff2' ),
				'utf8'
			)
		).toBe( 'woff2' );
	} );
} );
