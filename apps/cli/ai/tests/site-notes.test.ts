import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSiteNotes } from 'cli/ai/site-notes';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
// The copy of WordPress the tests write to is not one of Studio's sites.
vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: async ( root: string ) => ( { id: 'site', name: 'Ember Roasters', path: root } ),
} ) );

// A real WordPress install whose presets the notes read, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'the notes on a write', () => {
	let root: string;
	beforeAll( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'site-notes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
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
		await createSiteNotes( { gate } ).afterWrite( template );
		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ] ).toContain( '"slug": "size-1-4-rem"' );
	}, 60000 );
} );
