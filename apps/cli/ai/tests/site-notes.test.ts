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
