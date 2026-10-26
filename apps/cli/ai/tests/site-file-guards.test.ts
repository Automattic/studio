import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	blockMarkupNotes,
	clearThemePatternCache,
	lintThemeCss,
	resolveSiteFile,
	selfHostFonts,
} from 'cli/ai/site-file-guards';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';

vi.mock( 'cli/ai/tools/utils', () => ( {
	resolveSite: vi.fn( async ( sitePath: string ) => ( { path: sitePath } ) ),
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', () => ( {
	runWpCliCommand: vi.fn( async () => ( {
		response: { exitCode: Promise.resolve( 0 ) },
		[ Symbol.asyncDispose ]: async () => undefined,
	} ) ),
} ) );

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
	it( 'flags an inline-level display on a block className', () => {
		const notes = lintThemeCss(
			'.eyebrow { display: inline-block; padding: 4px 12px; }',
			new Set( [ 'eyebrow' ] )
		);
		expect( notes[ 0 ] ).toContain( 'wp-includes/block-supports/layout.php' );
	} );

	it( 'leaves non-block selectors and descendants alone', () => {
		expect(
			lintThemeCss(
				'.badge { display: inline-flex } .eyebrow span { display: inline }',
				new Set( [ 'eyebrow' ] )
			)
		).toEqual( [] );
	} );

	it.each( [
		[ '.hero { width: 100vw; margin-left: calc(50% - 50vw) }', 1 ],
		[ '.hero { width: 100dvw }', 1 ],
		[ '.hero { max-width: 100vw }', 0 ],
		[ '.hero { width: 100% }', 0 ],
	] )( 'flags a viewport-width breakout in %s: %d', ( css, count ) => {
		expect( lintThemeCss( css, new Set() ) ).toHaveLength( count );
	} );

	it( 'flags box styles on the button wrapper, not the link', () => {
		expect( lintThemeCss( '.wp-block-button { padding: 1rem }', new Set() ) ).toHaveLength( 1 );
		expect(
			lintThemeCss( '.wp-block-button .wp-element-button { padding: 1rem }', new Set() )
		).toEqual( [] );
	} );
} );

describe( 'clearThemePatternCache', () => {
	it( 'clears the cache of the theme whose pattern file changed, and only then', async () => {
		vi.mocked( runWpCliCommand ).mockClear();
		write( 'wp-includes/version.php', '' );
		write( 'wp-content/index.php', '' );
		await clearThemePatternCache(
			resolveSiteFile( path.join( site, 'wp-content/themes/acme/style.css' ) )!
		);
		expect( runWpCliCommand ).not.toHaveBeenCalled();
		await clearThemePatternCache(
			resolveSiteFile( path.join( site, 'wp-content/themes/acme/patterns/hero.php' ) )!
		);
		expect( runWpCliCommand ).toHaveBeenCalledWith( { path: site }, [
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
							{ name: 'Body', slug: 'body', fontFamily: 'Manrope, sans-serif' },
							{ name: 'System Sans', slug: 'system', fontFamily: '-apple-system, sans-serif' },
							{ name: 'Held', slug: 'held', fontFamily: 'Held', fontFace: [ {} ] },
						],
					},
				},
				styles: { elements: { h1: { typography: { fontWeight: '700' } } } },
			} )
		);

		expect( await selfHostFonts( resolveSiteFile( themeJson )! ) ).toEqual( [
			'Studio downloaded the font files of Body from Google Fonts into wp-content/themes/mine/assets/fonts and declared them as their fontFace in theme.json.',
			"System Sans in wp-content/themes/mine/theme.json asks first for -apple-system, which Google Fonts does not serve (https://fonts.googleapis.com/css2?family=-apple-system:wght@400;700&display=swap responded with HTTP 400), so the font each visitor sees is whichever their device has. Twenty Twenty-Five ships each family's files in the theme and declares them as its fontFace: put -apple-system's files in wp-content/themes/mine/assets/fonts and declare them, or choose a Google Fonts family, which Studio downloads.",
		] );
		expect( requested ).toEqual( [
			'https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap',
			'https://fonts.gstatic.com/manrope.woff2',
			'https://fonts.googleapis.com/css2?family=-apple-system:wght@400;700&display=swap',
		] );
		const families = JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography
			.fontFamilies;
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

	it( 'downloads a family whose fontFace names files neither the theme nor its parent has', async () => {
		const requested: string[] = [];
		vi.stubGlobal( 'fetch', async ( url: string ) => {
			requested.push( url );
			return url.includes( 'googleapis' )
				? new Response(
						"/* latin */ @font-face { font-family: 'Fraunces'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/fraunces.woff2) format('woff2'); }"
				  )
				: new Response( 'woff2' );
		} );
		const face = ( file: string ) => [
			{ fontFamily: 'F', src: [ `file:./assets/fonts/${ file }` ] },
		];
		// A font file another host serves is not the theme's to have.
		const remote = [ { fontFamily: 'Remote', src: [ 'https://cdn.example.com/remote.woff2' ] } ];
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
						],
					},
				},
			} )
		);

		expect( await selfHostFonts( resolveSiteFile( themeJson )! ) ).toEqual( [
			'Studio downloaded the font files of Fraunces from Google Fonts into wp-content/themes/mine/assets/fonts and declared them as their fontFace in theme.json, in place of the files the fontFace of Fraunces named, which neither the theme nor its parent has: WordPress looks for a "file:./" source there (get_theme_file_uri() in wp-includes/link-template.php), so the browser was given font files that do not exist.',
		] );
		expect( requested ).toEqual( [
			'https://fonts.googleapis.com/css2?family=Fraunces:wght@400&display=swap',
			'https://fonts.gstatic.com/fraunces.woff2',
		] );
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
			remote,
		] );
	} );
} );
