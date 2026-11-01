import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import {
	postCopies,
	postCopiesFact,
	siteIdOfCopy,
	workspaceRoot,
} from '@studio/agent/node/post-copies';
import { Writers } from '@studio/agent/node/runtime/writers';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

const { realRunWpCliCommand } = vi.hoisted( () => ( {
	realRunWpCliCommand: {} as { run?: typeof runWpCliCommand },
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => {
	realRunWpCliCommand.run = (
		await importOriginal< typeof import('cli/lib/run-wp-cli-command') >()
	).runWpCliCommand;
	return { runWpCliCommand: vi.fn() };
} );
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	findSiteByFolder: vi.fn( async ( folder: string ) =>
		folder === site.path ? site : undefined
	),
} ) );

const PARAGRAPH = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';
const HEADING = '<!-- wp:heading -->\n<h2 class="wp-block-heading">Menu</h2>\n<!-- /wp:heading -->';

let fixture: ReturnType< typeof createSite >;
let site: HostSite;
let host: StudioAgentHost;
let config: string;

beforeEach( () => {
	config = mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', config );
	fixture = createSite();
	fixture.save( 9, 'page', 'home', PARAGRAPH );
	fixture.save( 10, 'wp_template_part', 'header', HEADING );
	site = liveSite( fixture.root, 'Bakery', 'abc' );
	host = liveHost( site );
	// WP-CLI runs `wp eval` with the PHP Studio passes, saving the file it names
	// to the post it names, as wp_update_post() does: a new modified time.
	vi.mocked( runWpCliCommand )
		.mockReset()
		.mockImplementation( async ( _site, args ) => {
			const [ , id, file ] = args[ 1 ].match(
				/'ID' => (\d+)[\s\S]*file_get_contents\( "([^"]+)"/
			)!;
			fixture.edit( Number( id ), readFileSync( file, 'utf8' ), '2026-10-24 00:00:00' );
			return {
				response: { exitCode: Promise.resolve( 0 ) },
				[ Symbol.asyncDispose ]: async () => {},
			} as unknown as Awaited< ReturnType< typeof runWpCliCommand > >;
		} );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	rmSync( fixture.root, { recursive: true, force: true } );
	rmSync( config, { recursive: true, force: true } );
} );

const copy = ( type: string, id: number ) =>
	path.join( config, 'workspace', 'abc', type, `${ id }.html` );
const read = ( file: string ) => readFileSync( file, 'utf8' );

async function openedWorkspace() {
	const fact = await readWordPressSite( site.path, ( wp ) => postCopiesFact( wp, host ) );
	const check = new SiteChanges( host, undefined, async () => [ site ], [ postCopies ] );
	await check.snapshot();
	return { fact, check };
}

describe( 'post copies', () => {
	it( 'names the workspace, outside the site, and writes a copy of each rendered post', async () => {
		const { fact } = await openedWorkspace();
		expect( fact ).toContain(
			`${ path.join( config, 'workspace', 'abc' ) }/<post type>/<ID>.html`
		);
		expect( read( copy( 'page', 9 ) ) ).toBe( PARAGRAPH );
		expect( read( copy( 'wp_template_part', 10 ) ) ).toBe( HEADING );
		expect( path.relative( fixture.root, copy( 'page', 9 ) ).startsWith( '..' ) ).toBe( true );
	} );

	it( 'refreshes a copy after equal-length edits with the same modified time', async () => {
		const { check } = await openedWorkspace();
		const changed = PARAGRAPH.replace( 'Hello', 'World' );
		fixture.edit( 9, changed, '2026-10-22 00:00:00' );
		await check.settle();
		expect( read( copy( 'page', 9 ) ) ).toBe( changed );
	} );

	it( "copies the Global Styles of a child theme whose parent's templates make it a block theme", async () => {
		// As scaffold_theme makes a child: a style.css naming its parent, whose templates WordPress reads.
		const themes = path.join( fixture.root, 'wp-content/themes' );
		writeFileSync(
			path.join( themes, 'bakery/style.css' ),
			'/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/'
		);
		mkdirSync( path.join( themes, 'bakery-parent/templates' ) );
		writeFileSync( path.join( themes, 'bakery-parent/templates/index.html' ), PARAGRAPH );
		await openedWorkspace();
		expect(
			JSON.parse(
				read( path.join( config, 'workspace', 'abc', 'wp_global_styles', 'bakery.json' ) )
			)
		).toEqual( { version: 3, isGlobalStylesUserThemeJSON: true } );
	} );

	it( "names the site a copy belongs to by its workspace's folder", () => {
		expect( siteIdOfCopy( path.join( workspaceRoot(), 'abc', 'page', '9.html' ) ) ).toBe( 'abc' );
		expect( siteIdOfCopy( path.join( config, 'cli.json' ) ) ).toBeUndefined();
	} );

	it( 'saves a changed copy to its post, as the editor saves it', async () => {
		const { check } = await openedWorkspace();
		writeFileSync( copy( 'page', 9 ), PARAGRAPH + '\n\n' + HEADING );
		const { summaries, problems } = await check.settle();
		expect( fixture.content( 9 ) ).toBe( PARAGRAPH + '\n\n' + HEADING );
		expect( vi.mocked( runWpCliCommand ).mock.calls[ 0 ][ 1 ][ 1 ] ).toContain(
			'kses_remove_filters();'
		);
		expect( summaries ).toEqual( [
			`Bakery page 9: Studio saved ${ copy( 'page', 9 ) } to it (wp_update_post())`,
		] );
		expect( problems ).toEqual( [] );
		// The next change to the copy is saved too, and a save is not read back
		// as a change to the post.
		writeFileSync( copy( 'page', 9 ), HEADING );
		expect( await check.settle() ).toMatchObject( { problems: [] } );
		expect( fixture.content( 9 ) ).toBe( HEADING );
		expect( ( await check.settle() ).summaries ).toEqual( [] );
	} );

	it( "tells the subagent writing a copy that Studio saved it, whichever agent's call the check follows", async () => {
		const { check } = await openedWorkspace();
		const main = { tell: vi.fn() };
		const subagent = { tell: vi.fn() };
		const writers = new Writers( main );
		writers.claim( subagent, copy( 'page', 9 ) );
		writeFileSync( copy( 'page', 9 ), HEADING );
		// The session's own agent's call settles while the subagent writes.
		expect( ( await check.settle( writers.elsewhere( main ) ) ).summaries ).toEqual( [] );
		expect( subagent.tell ).toHaveBeenCalledWith(
			`Bakery page 9: Studio saved ${ copy( 'page', 9 ) } to it (wp_update_post())`
		);
		// Once the subagent ends, the page is the session's own agent's.
		writers.release( subagent );
		writeFileSync( copy( 'page', 9 ), PARAGRAPH );
		expect( ( await check.settle( writers.elsewhere( main ) ) ).summaries ).toHaveLength( 1 );
		expect( main.tell ).not.toHaveBeenCalled();
	} );

	it( 'writes the copy of a page created by any route as the call that created it settles', async () => {
		const { check } = await openedWorkspace();
		fixture.save( 11, 'page', 'about', PARAGRAPH );
		expect( existsSync( copy( 'page', 11 ) ) ).toBe( false );
		await check.settle();
		expect( read( copy( 'page', 11 ) ) ).toBe( PARAGRAPH );
	} );

	it( 'rewrites the copy of a post changed in WordPress', async () => {
		const { check } = await openedWorkspace();
		fixture.edit( 9, HEADING );
		expect( await check.settle() ).toMatchObject( { summaries: [], problems: [] } );
		expect( read( copy( 'page', 9 ) ) ).toBe( HEADING );
		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'keeps the post when it and its copy both changed, and the copy aside', async () => {
		const { check } = await openedWorkspace();
		writeFileSync( copy( 'page', 9 ), 'mine' );
		fixture.edit( 9, HEADING );
		const { problems } = await check.settle();
		const unsaved = path.join( path.dirname( copy( 'page', 9 ) ), '9.unsaved.html' );
		expect( fixture.content( 9 ) ).toBe( HEADING );
		expect( read( copy( 'page', 9 ) ) ).toBe( HEADING );
		expect( read( unsaved ) ).toBe( 'mine' );
		expect( problems[ 0 ] ).toContain( `the copy's change is in ${ unsaved }` );
		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'rewrites a deleted copy, and takes a deleted post’s copy away', async () => {
		const { check } = await openedWorkspace();
		rmSync( copy( 'page', 9 ) );
		const db = new ( await import( 'node:sqlite' ) ).DatabaseSync(
			path.join( fixture.root, 'wp-content/database/.ht.sqlite' )
		);
		db.prepare( "UPDATE wp_posts SET post_status = 'trash' WHERE ID = 10" ).run();
		db.close();
		await check.settle();
		expect( read( copy( 'page', 9 ) ) ).toBe( PARAGRAPH );
		expect( existsSync( copy( 'wp_template_part', 10 ) ) ).toBe( false );
		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );

	it( 'leaves a site whose workspace was never opened alone', async () => {
		const check = new SiteChanges( host, undefined, async () => [ site ], [ postCopies ] );
		await check.snapshot();
		fixture.edit( 9, HEADING );
		expect( await check.settle() ).toMatchObject( { summaries: [], problems: [] } );
		expect( existsSync( path.join( config, 'workspace' ) ) ).toBe( false );
	} );
} );

// A real WordPress install to save a copy to, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'a copy saved to a real WordPress', () => {
	it( 'saves the copy, outside the site, through wp_update_post() as an administrator would', async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'post-copies-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Seaside', 'live' );
		host = liveHost( site );
		vi.mocked( runWpCliCommand ).mockReset().mockImplementation( realRunWpCliCommand.run! );
		try {
			const { DatabaseSync } = await import( 'node:sqlite' );
			const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
			db.prepare(
				"INSERT INTO wp_posts ( post_type, post_status, post_name, post_title, post_content, post_excerpt, to_ping, pinged, post_content_filtered, post_modified_gmt ) VALUES ( 'page', 'publish', 'menu', 'Menu', ?, '', '', '', '', '2026-10-01 00:00:00' )"
			).run( PARAGRAPH );
			const id = Number(
				( db.prepare( "SELECT ID FROM wp_posts WHERE post_name = 'menu'" ).get() as { ID: number } )
					.ID
			);
			db.close();
			const { check } = await openedWorkspace();
			const file = path.join( config, 'workspace', 'live', 'page', `${ id }.html` );
			expect( read( file ) ).toBe( PARAGRAPH );
			const content = `${ HEADING }\n\n<!-- wp:html -->\n<script>window.menu = 1;</script>\n<!-- /wp:html -->`;
			writeFileSync( file, content );
			const { summaries, problems } = await check.settle();
			expect( problems ).toEqual( [] );
			expect( summaries[ 0 ] ).toContain( `Studio saved ${ file } to it` );
			expect( await fixtureContent( root, id ) ).toBe( content );
		} finally {
			rmSync( root, { recursive: true, force: true } );
		}
	}, 60000 );
} );

describe.runIf( WORDPRESS )( 'Global Styles saved from their copy to a real WordPress', () => {
	it( 'saves them as the Site Editor does, so WordPress merges them over theme.json, and reports what it refuses', async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'post-copies-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root, 'Seaside', 'live' );
		host = liveHost( site );
		vi.mocked( runWpCliCommand ).mockReset().mockImplementation( realRunWpCliCommand.run! );
		const php = async ( code: string ) =>
			( await host.sites.wpCli( site, [ 'eval', code ] ) ).stdout;
		try {
			// No Global Styles are saved yet: the copy holds what the Site Editor starts them with.
			const { fact, check } = await openedWorkspace();
			expect( fact ).toContain(
				`${ path.join( config, 'workspace', 'live' ) }/wp_global_styles/<theme>.json`
			);
			const file = path.join(
				config,
				'workspace',
				'live',
				'wp_global_styles',
				'twentytwentyfive.json'
			);
			expect( JSON.parse( read( file ) ) ).toEqual( {
				version: 3,
				isGlobalStylesUserThemeJSON: true,
			} );

			writeFileSync(
				file,
				JSON.stringify( {
					version: 3,
					settings: { color: { palette: [ { slug: 'clay', color: '#d96b4b', name: 'Clay' } ] } },
					styles: { color: { background: '#fdf6ec' } },
				} )
			);
			const saved = await check.settle();
			expect( saved.problems ).toEqual( [] );
			expect( saved.summaries[ 0 ] ).toContain(
				`Studio saved ${ file } to it (PUT /wp/v2/global-styles)`
			);
			expect(
				JSON.parse(
					await php(
						"echo wp_json_encode( array( wp_get_global_styles( array( 'color', 'background' ) ), wp_get_global_settings( array( 'color', 'palette', 'custom' ) ) ) );"
					)
				)
			).toEqual( [ '#fdf6ec', [ { slug: 'clay', color: '#d96b4b', name: 'Clay' } ] ] );

			// Custom CSS the controller refuses (validate_custom_css()) is reported, and nothing is saved.
			writeFileSync( file, JSON.stringify( { styles: { css: 'p { color: red } </style>' } } ) );
			const refused = await check.settle();
			expect( refused.problems[ 0 ] ).toContain( `Studio could not save ${ file } to it` );
			expect( refused.problems[ 0 ] ).toContain( 'The CSS must not contain' );
			expect( await php( "echo wp_get_global_styles( array( 'color', 'background' ) );" ) ).toBe(
				'#fdf6ec'
			);
		} finally {
			rmSync( root, { recursive: true, force: true } );
		}
	}, 120000 );
} );

async function fixtureContent( root: string, id: number ) {
	return readWordPressSite(
		root,
		( wp ) =>
			wp.query< { c: string } >(
				`SELECT post_content AS c FROM ${ wp.prefix }posts WHERE ID = ?`,
				id
			)[ 0 ]?.c
	);
}
