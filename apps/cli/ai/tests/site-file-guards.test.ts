import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAnchorsHomeRelative } from 'cli/ai/block-validation-gate';
import { clearThemePatternCache, lintThemeCss, resolveSiteFile } from 'cli/ai/site-file-guards';
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

describe( 'home-relative anchors', () => {
	it( 'rewrites bare in-page links in block markup', () => {
		const { content, count } = makeAnchorsHomeRelative(
			'<!-- wp:navigation-link {"label":"Menu","url":"#menu"} /--><a href="#visit">Visit</a><a href="/about">About</a>'
		);
		expect( content ).toContain( '"url":"/#menu"' );
		expect( content ).toContain( 'href="/#visit"' );
		expect( content ).toContain( 'href="/about"' );
		expect( count ).toBe( 2 );
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
