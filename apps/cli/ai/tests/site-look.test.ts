import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSavedCopies } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { lookQuestion } from 'cli/ai/site-look';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/ai/tools/utils', () => ( {
	resolveSite: async ( root: string ) => ( { id: 'site', name: 'Site', path: root } ),
} ) );

// A real WordPress install, on Twenty Twenty-Five, to ask about, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'lookQuestion', () => {
	let root: string;
	const options = async ( entries: Record< string, string > ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		for ( const [ name, value ] of Object.entries( entries ) ) {
			db.prepare( 'UPDATE wp_options SET option_value = ? WHERE option_name = ?' ).run(
				value,
				name
			);
		}
		db.close();
	};
	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'site-look-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( "offers the theme's look, its style variations and the user's own, and saves a variation picked as the Site Editor does", async () => {
		await options( { show_on_front: 'page', page_on_front: '2', blogname: 'Tidy Paws' } );
		const asked = await lookQuestion( root );
		const { question, answered } = await asked!.prepare();
		expect( question.question ).toBe(
			'Which look should "Tidy Paws" have? It is built on Twenty Twenty-Five, a theme WordPress updates, with no Global Styles of its own, so it looks as Twenty Twenty-Five ships.'
		);
		// The whole looks of styles/, not its colors/ and typography/ sets.
		expect( question.options.map( ( { label } ) => label ) ).toEqual( [
			'Twenty Twenty-Five as it ships',
			'Evening',
			'Noon',
			'Dusk',
			'Afternoon',
			'Twilight',
			'Morning',
			'Sunrise',
			'Midnight',
		] );
		expect( question.allowFreeForm ).toBe( true );
		expect( await answered( 'Twenty Twenty-Five as it ships' ) ).toBeUndefined();
		expect( await answered( 'Warm and earthy' ) ).toBe(
			`The user answered "Warm and earthy" to: ${ question.question }`
		);

		expect( await answered( 'Midnight' ) ).toMatch(
			/^The user chose Twenty Twenty-Five's style variation "Midnight" for "Tidy Paws", and Studio saved it as the site's Global Styles \(wp_global_styles post \d+\)/
		);
		const saved = await readWordPressSite( root, readSavedCopies );
		expect( saved.find( ( copy ) => copy.postType === 'wp_global_styles' )?.sets ).toContain(
			'color settings'
		);
		// The site has a look of its own now.
		expect( await lookQuestion( root ) ).toBeUndefined();
	}, 120000 );

	it( 'tells the turn when the variation picked could not be saved', async () => {
		await options( { show_on_front: 'page', page_on_front: '2', blogname: 'Tidy Paws' } );
		// With no administrator, saving Global Styles is refused.
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		db.prepare( "DELETE FROM wp_usermeta WHERE meta_key = 'wp_capabilities'" ).run();
		db.close();
		const { answered } = await ( await lookQuestion( root ) )!.prepare();
		expect( await answered( 'Midnight' ) ).toMatch( /and Studio could not save it\./ );
		expect( await lookQuestion( root ) ).toBeDefined();
	}, 60000 );

	it.each< { name: string; site: () => Promise< void > } >( [
		{ name: 'the front page is the posts index', site: () => options( { page_on_front: '2' } ) },
		{
			name: 'the theme is one WordPress does not update',
			site: async () => {
				const dir = path.join( root, 'wp-content/themes/studio-test-look' );
				mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
				writeFileSync( path.join( dir, 'style.css' ), '/*\nTheme Name: Look\n*/' );
				writeFileSync( path.join( dir, 'templates/index.html' ), '' );
				await options( {
					show_on_front: 'page',
					page_on_front: '2',
					stylesheet: 'studio-test-look',
					template: 'studio-test-look',
				} );
			},
		},
	] )(
		'asks nothing when $name',
		async ( { site } ) => {
			await site();
			expect( await lookQuestion( root ) ).toBeUndefined();
		},
		60000
	);
} );
