import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAnchorsHomeRelative } from 'cli/ai/block-validation-gate';
import {
	clearThemePatternCache,
	getSiteFileWriteNotes,
	getSiteFileWriteRefusal,
	lintThemeCss,
	resolveSiteFile,
	withSiteFileGuards,
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

function seedDatabase( rows: { type: string; name: string; content: string; theme?: string }[] ) {
	mkdirSync( path.join( site, 'wp-content', 'database' ), { recursive: true } );
	const db = new DatabaseSync( path.join( site, 'wp-content', 'database', '.ht.sqlite' ) );
	db.exec( `CREATE TABLE wp_posts (ID INTEGER PRIMARY KEY, post_type TEXT, post_name TEXT, post_status TEXT, post_content TEXT);
		CREATE TABLE wp_terms (term_id INTEGER PRIMARY KEY, slug TEXT);
		CREATE TABLE wp_term_taxonomy (term_taxonomy_id INTEGER PRIMARY KEY, term_id INTEGER, taxonomy TEXT);
		CREATE TABLE wp_term_relationships (object_id INTEGER, term_taxonomy_id INTEGER);` );
	rows.forEach( ( row, index ) => {
		const id = index + 10;
		db.prepare( `INSERT INTO wp_posts VALUES (?, ?, ?, 'publish', ?)` ).run(
			id,
			row.type,
			row.name,
			row.content
		);
		if ( row.theme ) {
			db.prepare( 'INSERT INTO wp_terms VALUES (?, ?)' ).run( id, row.theme );
			db.prepare( `INSERT INTO wp_term_taxonomy VALUES (?, ?, 'wp_theme')` ).run( id, id );
			db.prepare( 'INSERT INTO wp_term_relationships VALUES (?, ?)' ).run( id, id );
		}
	} );
	db.close();
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

const refusalFor = ( relativePath: string ) =>
	getSiteFileWriteRefusal( resolveSiteFile( path.join( site, relativePath ) )! );

describe( 'site file write refusals', () => {
	it( 'refuses WordPress core files', () => {
		expect( refusalFor( 'wp-includes/blocks/group/block.json' ) ).toContain( 'read-only' );
		expect( refusalFor( 'wp-config-sample.php' ) ).toContain( 'read-only' );
	} );

	it( 'refuses installed third-party themes and points at a child theme', () => {
		expect( refusalFor( 'wp-content/themes/twentytwentyfive/parts/header.html' ) ).toContain(
			'parentTheme: "twentytwentyfive"'
		);
	} );

	it( 'allows Studio themes, new themes, plugins, and site files', () => {
		expect( refusalFor( 'wp-content/themes/mine/parts/header.html' ) ).toBeUndefined();
		expect( refusalFor( 'wp-content/themes/brand-new/style.css' ) ).toBeUndefined();
		expect( refusalFor( 'wp-content/plugins/site-tweaks/site-tweaks.php' ) ).toBeUndefined();
		expect( refusalFor( 'DESIGN.md' ) ).toBeUndefined();
		expect( refusalFor( 'tmp/page-home.html' ) ).toBeUndefined();
	} );

	it( 'rejects the write before it reaches the file tool', async () => {
		let wrote = false;
		const tool = withSiteFileGuards(
			{
				execute: async ( ..._args: unknown[] ) => {
					wrote = true;
					return { content: [] };
				},
			},
			site
		);
		await expect(
			tool.execute( 'id', { path: 'wp-content/themes/twentytwentyfive/style.css' } )
		).rejects.toThrow( 'child theme' );
		expect( wrote ).toBe( false );
	} );
} );

describe( 'site file write notes', () => {
	it( 'reports a Site Editor copy of the template part that was written', async () => {
		seedDatabase( [ { type: 'wp_template_part', name: 'header', content: '', theme: 'mine' } ] );
		const file = write( 'wp-content/themes/mine/parts/header.html', '<!-- wp:group /-->' );
		const tool = withSiteFileGuards(
			{
				execute: async ( ..._args: unknown[] ) => ( {
					content: [ { type: 'text', text: 'Wrote file' } ],
				} ),
			},
			site
		);
		const result = ( await tool.execute( 'id', { path: file } ) ) as {
			content: { text: string }[];
		};
		expect( result.content[ 1 ].text ).toContain( 'wp_template_part post 10' );
	} );

	it( "ignores another theme's Site Editor copy", async () => {
		seedDatabase( [ { type: 'wp_template_part', name: 'header', content: '', theme: 'other' } ] );
		const file = write( 'wp-content/themes/mine/parts/header.html', '' );
		expect( await getSiteFileWriteNotes( resolveSiteFile( file )! ) ).toEqual( [] );
	} );

	it( 'reports saved Global Styles that override theme.json', async () => {
		seedDatabase( [
			{
				type: 'wp_global_styles',
				name: 'wp-global-styles-mine',
				content: JSON.stringify( { version: 3, styles: { color: { background: '#000' } } } ),
			},
		] );
		const file = write( 'wp-content/themes/mine/theme.json', '{}' );
		const [ note ] = await getSiteFileWriteNotes( resolveSiteFile( file )! );
		expect( note ).toContain( 'styles.color' );
	} );
} );

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
