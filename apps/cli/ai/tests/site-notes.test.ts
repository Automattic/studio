import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { StudioAgentHost } from '@studio/agent/node';
import type { BlockValidationGate } from '@studio/agent/node/block-validation-gate';

// The copy of WordPress the tests write to is not one of Studio's sites.
function outsideStudio( root: string ): StudioAgentHost {
	const live = liveHost( liveSite( root, 'Ember Roasters' ) );
	return { ...live, sites: { ...live.sites, findByFolder: async () => undefined } };
}

// A real WordPress install whose presets the notes read, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'the notes on a write', () => {
	let root: string;
	let host: StudioAgentHost;
	beforeAll( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'site-notes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		host = outsideStudio( root );
		vi.stubGlobal( 'fetch', async () => Response.json( { themes: {}, no_update: {} } ) );
	} );
	afterAll( () => {
		vi.unstubAllGlobals();
		rmSync( root, { recursive: true, force: true } );
	} );

	it( 'adds the presets a write repeats before the gate reads them for its save', async () => {
		const dir = path.join( root, 'wp-content/themes/studio-test-notes' );
		mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
		writeFileSync( path.join( dir, 'style.css' ), '/*\nTheme Name: Notes\n*/' );
		writeFileSync( path.join( dir, 'theme.json' ), '{"version":3}' );
		const template = path.join( dir, 'templates/index.html' );
		writeFileSync(
			template,
			Array( 3 )
				.fill(
					'<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.4rem"}}} --><p style="font-size:1.4rem">Roast</p><!-- /wp:paragraph -->'
				)
				.join( '\n' )
		);
		const seen: string[] = [];
		const gate = {
			track: () => seen.push( readFileSync( path.join( dir, 'theme.json' ), 'utf8' ) ),
		} as unknown as BlockValidationGate;
		await createSiteNotes( host, { gate } ).afterWrite( template );
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toContain( '"slug": "size-1-4-rem"' );
	}, 60000 );

	it( "keeps a theme.json's presets WordPress would replace with core's", async () => {
		const dir = path.join( root, 'wp-content/themes/studio-test-presets' );
		mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
		writeFileSync( path.join( dir, 'templates/index.html' ), '' );
		writeFileSync( path.join( dir, 'style.css' ), '/*\nTheme Name: Presets\n*/' );
		const themeJson = path.join( dir, 'theme.json' );
		writeFileSync(
			themeJson,
			JSON.stringify( {
				version: 3,
				settings: { spacing: { spacingSizes: [ { slug: '50', size: '3rem', name: 'Large' } ] } },
			} )
		);
		const notes = await createSiteNotes( host ).afterWrite( themeJson );
		expect( notes.join( '\n' ) ).toContain(
			'Studio set settings.spacing.defaultSpacingSizes to false'
		);
		expect( JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.spacing ).toMatchObject( {
			defaultSpacingSizes: false,
		} );
	}, 60000 );

	// port eval29 picky: the read on the site said it with the next call's result, after the model read this one.
	it( "says a theme.json is not JSON on its call's result, and not again once the site has read it", async () => {
		const dir = path.join( root, 'wp-content/themes/studio-test-syntax' );
		mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
		writeFileSync( path.join( dir, 'templates/index.html' ), '' );
		writeFileSync( path.join( dir, 'style.css' ), '/*\nTheme Name: Syntax\n*/' );
		const themeJson = path.join( dir, 'theme.json' );
		const text = '{ "version": 3, "styles": { "typography": { "lineHeight": 1.2" } } }';
		writeFileSync( themeJson, text );
		const siteNotes = createSiteNotes( host );
		const decode = ( notes: string[] ) =>
			notes.filter( ( note ) => note.startsWith( 'WordPress cannot decode' ) );
		expect( decode( await siteNotes.fixWrite( themeJson ) ) ).toHaveLength( 1 );
		expect( decode( await siteNotes.afterWrite( themeJson, text, true ) ) ).toEqual( [] );
		// Fixed, the read on the site says what it keeps of it again.
		writeFileSync(
			themeJson,
			'{ "version": 3, "styles": { "typography": { "lineHeigh": 1.2 } } }'
		);
		expect( decode( await siteNotes.fixWrite( themeJson ) ) ).toEqual( [] );
		expect( ( await siteNotes.afterWrite( themeJson, undefined, true ) ).join( '\n' ) ).toContain(
			'so these change nothing on the site: styles.'
		);
	}, 60000 );
} );

describe( 'a note on a write', () => {
	let root: string;
	let host: StudioAgentHost;
	const theme = () => path.join( root, 'wp-content/themes/studio-test-once' );
	// A cover held to the content width by a group that is not align full.
	const HELD =
		'<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group"><!-- wp:group {"backgroundColor":"base"} --><div class="wp-block-group has-base-background-color"><!-- wp:cover {"align":"full"} /--></div><!-- /wp:group --></div><!-- /wp:group -->';
	const write = ( file: string, markup: string ) => {
		const at = path.join( theme(), file );
		mkdirSync( path.dirname( at ), { recursive: true } );
		writeFileSync( at, markup );
		return at;
	};
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'notes-once-' ) );
		host = outsideStudio( root );
		mkdirSync( path.join( root, 'wp-includes' ), { recursive: true } );
		writeFileSync( path.join( theme(), '..', '..', '..', 'wp-config.php' ), '' );
		write( 'style.css', '/*\nTheme Name: Once\n*/' );
		write( 'screenshot.png', 'png' );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it.each< { name: string; writes: Array< [ string, string ] >; heard: boolean[] } >( [
		{
			name: 'is said once while it stands',
			writes: [
				[ 'templates/index.html', HELD ],
				[ 'templates/index.html', HELD ],
			],
			heard: [ true, false ],
		},
		{
			name: 'is said of each file that gives it',
			writes: [
				[ 'templates/index.html', HELD ],
				[ 'templates/home.html', HELD ],
				[ 'templates/index.html', HELD ],
			],
			heard: [ true, true, false ],
		},
		{
			name: 'is said again when it comes back after a write to its file no longer gives it',
			writes: [
				[ 'templates/index.html', HELD ],
				[ 'templates/index.html', '' ],
				[ 'templates/index.html', HELD ],
			],
			heard: [ true, false, true ],
		},
		{
			name: 'stands while a write to another file no longer gives it',
			writes: [
				[ 'templates/index.html', HELD ],
				[ 'templates/home.html', '' ],
				[ 'templates/index.html', HELD ],
			],
			heard: [ true, false, false ],
		},
	] )( '$name', async ( { writes, heard } ) => {
		const siteNotes = createSiteNotes( host );
		const said: boolean[] = [];
		for ( const [ file, markup ] of writes ) {
			const notes = await siteNotes.afterWrite( write( file, markup ) );
			said.push( notes.some( ( note ) => note.includes( 'cannot reach the page edges' ) ) );
		}
		expect( said ).toEqual( heard );
	} );

	it( 'is said once whichever path names its file', async () => {
		const siteNotes = createSiteNotes( host );
		const at = write( 'templates/index.html', HELD );
		expect( await siteNotes.afterWrite( at ) ).toHaveLength( 1 );
		// The same file, named through a link to its folder.
		symlinkSync( path.join( theme(), 'templates' ), path.join( theme(), 'linked' ) );
		const other = path.join( theme(), 'linked/index.html' );
		expect( await siteNotes.afterWrite( other ) ).toEqual( [] );
		write( 'templates/index.html', '' );
		await siteNotes.afterWrite( other );
		write( 'templates/index.html', HELD );
		expect( await siteNotes.afterWrite( at ) ).toHaveLength( 1 );
	} );
} );

describe( 'the notes on a theme.json write', () => {
	let root: string;
	let host: StudioAgentHost;
	const themes = () => path.join( root, 'wp-content/themes' );
	const write = ( file: string, text: string ) => {
		const at = path.join( themes(), file );
		mkdirSync( path.dirname( at ), { recursive: true } );
		writeFileSync( at, text );
		return at;
	};
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'notes-theme-json-' ) );
		host = outsideStudio( root );
		mkdirSync( path.join( root, 'wp-includes' ), { recursive: true } );
		write( 'mine/style.css', '/*\nTheme Name: Mine\n*/' );
		write( 'mine/screenshot.png', 'png' );
		write( 'child/style.css', '/*\nTheme Name: Child\nTemplate: mine\n*/' );
		write( 'child/screenshot.png', 'png' );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	// port eval29 picky: the decode note came with the next call's result, and the model went on for nine calls.
	it.each( [
		{
			file: 'mine/theme.json',
			text: '{\n\t"version": 3,\n\t"styles": { "typography": { "lineHeight": 1.2" } }\n}',
			note: `WordPress cannot decode wp-content/themes/mine/theme.json as JSON (wp_json_file_decode in wp-includes/functions.php): Syntax error. It reads nothing from it until the file is valid JSON. JSON parsing stops at line 3, column 47 (Expected ',' or '}' after property value): \`…es": { "typography": { "lineHeight": 1.2" } }\\n}\`.`,
		},
		{
			file: 'mine/styles/dusk.json',
			text: '{ "version": 3, "styles": { "css": "a {\n}" } }',
			note: 'WordPress cannot decode wp-content/themes/mine/styles/dusk.json as JSON (wp_json_file_decode in wp-includes/functions.php): Control character error, possibly incorrectly encoded. It reads nothing from it until the file is valid JSON. JSON parsing stops at line 1, column 40 (Bad control character in string literal): `{ "version": 3, "styles": { "css": "a {\\n}" } }`.',
		},
		{ file: 'mine/theme.json', text: '{ "version": 3 }', note: undefined },
	] )(
		'says $file is not JSON on the result of the call that wrote it',
		async ( { file, text, note } ) => {
			const siteNotes = createSiteNotes( host );
			const at = write( file, text );
			const fixes = await siteNotes.fixWrite( at );
			expect( fixes.filter( ( line ) => line.startsWith( 'WordPress cannot decode' ) ) ).toEqual(
				note ? [ note ] : []
			);
			// Not again with the checks that finish after the result.
			expect(
				( await siteNotes.afterWrite( at, text, true ) ).filter( ( line ) =>
					line.startsWith( 'WordPress cannot decode' )
				)
			).toEqual( [] );
		},
		60000
	);

	// port eval29 picky: a rewrite of theme.json dropped the setting, and the header stood 24px from each side of the window.
	const PADDED = { styles: { spacing: { padding: { left: '1.5rem', right: '1.5rem' } } } };
	const ROOT_PADDING = { settings: { useRootPaddingAwareAlignments: true } };
	it.each< { name: string; files: Record< string, object >; written: string; note?: string } >( [
		{
			name: 'side padding without the setting',
			files: { 'mine/theme.json': { version: 3, ...PADDED } },
			written: 'mine/theme.json',
			note: "wp-content/themes/mine/theme.json pads the page by styles.spacing.padding (left 1.5rem, right 1.5rem) without settings.useRootPaddingAwareAlignments true, so WordPress puts that padding on the body and full-width blocks stop that far from the window's edges; with the setting true it goes inside each .has-global-padding container, whose full-width children reach the edges (get_styles_for_block() and get_root_layout_rules() in wp-includes/class-wp-theme-json.php).",
		},
		{
			name: 'side padding with the setting',
			files: { 'mine/theme.json': { version: 3, ...ROOT_PADDING, ...PADDED } },
			written: 'mine/theme.json',
		},
		{
			name: 'zero side padding',
			files: {
				'mine/theme.json': {
					version: 3,
					styles: { spacing: { padding: { top: '2rem', left: '0', right: '0px' } } },
				},
			},
			written: 'mine/theme.json',
		},
		{
			name: "a child's side padding with its parent's setting",
			files: {
				'mine/theme.json': { version: 3, ...ROOT_PADDING },
				'child/theme.json': { version: 3, ...PADDED },
			},
			written: 'child/theme.json',
		},
		{
			name: "a child's theme.json over its parent's side padding",
			files: {
				'mine/theme.json': { version: 3, ...PADDED },
				'child/theme.json': {
					version: 3,
					styles: { spacing: { padding: { right: '2rem' } } },
				},
			},
			written: 'child/theme.json',
			note: "wp-content/themes/child/theme.json, merged over its parent mine's theme.json, pads the page by styles.spacing.padding (left 1.5rem, right 2rem) without settings.useRootPaddingAwareAlignments true, so WordPress puts that padding on the body and full-width blocks stop that far from the window's edges; with the setting true it goes inside each .has-global-padding container, whose full-width children reach the edges (get_styles_for_block() and get_root_layout_rules() in wp-includes/class-wp-theme-json.php).",
		},
	] )(
		'notes $name only when full-width blocks stop short of the edges',
		async ( { files, written, note } ) => {
			for ( const [ file, json ] of Object.entries( files ) ) {
				write( file, JSON.stringify( json ) );
			}
			const notes = await createSiteNotes( host ).afterWrite( path.join( themes(), written ) );
			expect(
				notes.filter( ( line ) => line.includes( 'useRootPaddingAwareAlignments' ) )
			).toEqual( note ? [ note ] : [] );
		},
		60000
	);
} );
