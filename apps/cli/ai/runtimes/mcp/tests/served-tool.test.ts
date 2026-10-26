import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Type } from 'typebox';
import { expect, it, vi } from 'vitest';
import { runServedTool } from 'cli/ai/runtimes/mcp/served-tool';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSiteNotes } from 'cli/ai/site-notes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { defineTool, LOCAL_CHANGE, READ_ONLY } from 'cli/ai/tools/define-tool';

// The fixture is a site's files and database, not a WordPress install, so the
// checks that ask WordPress (wp-cli) find nothing to report, as they do when a
// site's PHP cannot run.
vi.mock( 'cli/lib/run-wp-cli-command', () => ( {
	runWpCliCommand: vi.fn( async () => {
		throw new Error( 'No WordPress to run.' );
	} ),
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );

it( 'adds the declared settings of the core blocks a result shows, from the site the call names, once', async () => {
	const root = mkdtempSync( path.join( tmpdir(), 'served-tool-' ) );
	const sitePath = path.join( root, 'site' );
	mkdirSync( path.join( sitePath, 'wp-includes', 'blocks', 'navigation' ), { recursive: true } );
	writeFileSync(
		path.join( sitePath, 'wp-includes', 'blocks', 'navigation', 'block.json' ),
		JSON.stringify( { attributes: { submenuVisibility: { enum: [ 'hover', 'click' ] } } } )
	);
	const site = { id: '1', name: 'My Site', path: sitePath, port: 8881, phpVersion: '8.3' };
	writeFileSync( path.join( root, 'cli.json' ), JSON.stringify( { version: 1, sites: [ site ] } ) );
	vi.stubEnv( 'E2E', '1' );
	vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );

	const tool = defineTool(
		'show_header',
		'Shows the header.',
		{ nameOrPath: Type.Optional( Type.String() ) },
		async () => ( { content: [ { type: 'text', text: '<!-- wp:navigation /-->' } ] } ),
		{ annotations: READ_ONLY }
	);
	const siteNotes = createSiteNotes();
	const notes = async ( args: Record< string, unknown > ) =>
		( await runServedTool( tool, args, siteNotes ) ).content
			.slice( 1 )
			.map( ( part ) => ( part.type === 'text' ? part.text : '' ) );
	const blockJson = path.join( sitePath, 'wp-includes/blocks/navigation/block.json' );

	expect( await notes( {} ) ).toEqual( [] );
	expect( await notes( { nameOrPath: 'Missing Site' } ) ).toEqual( [] );
	expect( await notes( { nameOrPath: 'My Site' } ) ).toEqual( [
		`<studio-notes>\ncore/navigation settings, declared in ${ blockJson
			.split( path.sep )
			.join(
				'/'
			) }: submenuVisibility ("hover"|"click").\nAddress: http://localhost:8881 (home_url()).\nWordPress is not installed yet (is_blog_installed()): Studio installs it, with its database, when the site first starts (site_start).\n</studio-notes>`,
	] );
	// Once per MCP session, as once per Studio Code turn.
	expect( await notes( { nameOrPath: 'My Site' } ) ).toEqual( [] );

	// A tool that names its site by another argument, such as the site it creates.
	const create = defineTool(
		'site_create',
		'Creates a site.',
		{ name: Type.String() },
		async () => ( { content: [ { type: 'text', text: 'Created.' } ] } ),
		{ annotations: LOCAL_CHANGE, siteParam: 'name' }
	);
	const created = await runServedTool( create, { name: 'My Site' }, createSiteNotes() );
	expect( JSON.stringify( created.content ) ).toContain( 'Address: http://localhost:8881' );
} );

it( 'reports the block validation of post content the call changed, on any site', async () => {
	const fixture = createSite();
	fixture.save( 9, 'page', 'home', '<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->' );
	const root = mkdtempSync( path.join( tmpdir(), 'served-tool-' ) );
	const site = { id: '1', name: 'Bakery', path: fixture.root, port: 8881, phpVersion: '8.3' };
	writeFileSync( path.join( root, 'cli.json' ), JSON.stringify( { version: 1, sites: [ site ] } ) );
	vi.stubEnv( 'E2E', '1' );
	vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );

	// As `wp post update` would, with the content from any file or inline.
	const tool = defineTool(
		'wp_cli',
		'Runs WP-CLI.',
		{},
		async () => {
			fixture.edit( 9, '<!-- wp:html -->\n<div class="hero"><h1>Hi</h1></div>\n<!-- /wp:html -->' );
			return { content: [ { type: 'text', text: 'Success: Updated post 9.' } ] };
		},
		{ annotations: LOCAL_CHANGE }
	);
	const result = await runServedTool( tool, {}, createSiteNotes(), new SiteChanges() );
	expect( result.content.map( ( part ) => ( part.type === 'text' ? part.text : '' ) ) ).toEqual( [
		'Success: Updated post 9.',
		expect.stringMatching(
			/^<studio-notes>\nBlock validation: Bakery page 9 "": core\/html policy failed\nBakery page 9 "": 1 core\/html block\(s\) must become editable blocks/
		),
	] );

	// A call that fails after changing content reports it too.
	const failing = defineTool(
		'wp_cli',
		'Runs WP-CLI.',
		{},
		async () => {
			fixture.edit(
				9,
				'<!-- wp:html -->\n<p>Hi again</p>\n<!-- /wp:html -->',
				'2026-10-24 00:00:00'
			);
			throw new Error( 'Command exited with code 1' );
		},
		{ annotations: LOCAL_CHANGE }
	);
	const failed = await runServedTool( failing, {}, createSiteNotes(), new SiteChanges() );
	expect( failed.isError ).toBe( true );
	expect( JSON.stringify( failed.content ) ).toMatch(
		/Command exited with code 1\\n<studio-notes>\\nBlock validation: Bakery page 9 \\"\\": core\/html policy failed/
	);
} );

it( 'reports on the next call what the client changed between calls, by its own tools', async () => {
	const fixture = createSite();
	fixture.save( 9, 'page', 'home', '<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->' );
	const root = mkdtempSync( path.join( tmpdir(), 'served-tool-' ) );
	const site = { id: '1', name: 'Bakery', path: fixture.root, port: 8881, phpVersion: '8.3' };
	writeFileSync( path.join( root, 'cli.json' ), JSON.stringify( { version: 1, sites: [ site ] } ) );
	vi.stubEnv( 'E2E', '1' );
	vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );
	const tracked: string[] = [];
	const siteNotes = createSiteNotes( {
		gate: { track: ( file: string ) => tracked.push( file ) } as never,
	} );
	const siteChanges = new SiteChanges();
	const list = defineTool(
		'site_list',
		'Lists sites.',
		{},
		async () => ( { content: [ { type: 'text', text: 'Bakery' } ] } ),
		{ annotations: READ_ONLY }
	);
	const call = async () =>
		( await runServedTool( list, {}, siteNotes, siteChanges ) ).content.map( ( part ) =>
			part.type === 'text' ? part.text : ''
		);

	expect( await call() ).toEqual( [ 'Bakery' ] );
	// As the client's own Edit and shell would, outside Studio's tools.
	fixture.edit( 9, '<!-- wp:html -->\n<div class="hero"><h1>Hi</h1></div>\n<!-- /wp:html -->' );
	const template = path.join( fixture.root, 'wp-content/themes/bakery/templates/index.html' );
	mkdirSync( path.dirname( template ), { recursive: true } );
	writeFileSync( template, '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->' );

	expect( ( await call() )[ 1 ] ).toMatch(
		/^<studio-notes>\nBlock validation: Bakery page 9 "": core\/html policy failed\n/
	);
	expect( tracked ).toEqual( [ template ] );
	expect( await call() ).toEqual( [ 'Bakery' ] );
} );
