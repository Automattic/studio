import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn } from '../auth.ts';
import { loadLook } from '../look.ts';
import { HARNESS_DIR, REPO_ROOT, SCHEMAS_DIR } from '../paths.ts';
import { idForSlug, loadScene, resolveScene, sceneFromBlueprint } from '../scene.ts';
import {
	HELPER_NAMES,
	SCHEMAS,
	Script,
	describeIssues,
	jsonSchemaFor,
	type SchemaKind,
} from '../schema.ts';
import { HELPERS } from '../steps.ts';
import { checkScriptAgainstScene, detectKind, validateFiles } from '../validate.ts';

const DOCS_SHOTS = path.join( REPO_ROOT, 'docs/user/screenshots/shots' );

let temp: string | null = null;
afterEach( async () => {
	if ( temp ) {
		await rm( temp, { recursive: true, force: true } );
		temp = null;
	}
} );

describe( 'bundled inputs', () => {
	it( 'validates the docs scripts, the bundled scene and every look', async () => {
		const results = await validateFiles( [
			DOCS_SHOTS,
			path.join( HARNESS_DIR, 'scenes' ),
			path.join( HARNESS_DIR, 'looks' ),
			path.join( HARNESS_DIR, 'examples' ),
		] );
		expect( results.filter( ( r ) => ! r.ok ) ).toEqual( [] );
		expect( new Set( results.map( ( r ) => r.kind ) ) ).toEqual(
			new Set( [ 'script', 'scene', 'look' ] )
		);
	} );

	it( 'keeps the JSON Schemas in step with the code', async () => {
		for ( const kind of Object.keys( SCHEMAS ) as SchemaKind[] ) {
			const written = JSON.parse(
				await readFile( path.join( SCHEMAS_DIR, `${ kind }.schema.json` ), 'utf8' )
			);
			expect( written, `${ kind }: run \`npm -w @studio/capture-harness run schemas\`` ).toEqual(
				jsonSchemaFor( kind )
			);
		}
	} );

	it( 'implements every helper the schema allows', () => {
		expect( Object.keys( HELPERS ).sort() ).toEqual( [ ...HELPER_NAMES ].sort() );
	} );

	it( 'gives the docs look the settings the docs images were captured with', async () => {
		const docs = await loadLook( 'docs' );
		expect( docs ).toMatchObject( {
			window: { width: 1440, height: 900 },
			scale: 2,
			appearance: { colorScheme: 'light' },
			windowControls: true,
			crop: { pad: 48, aspect: 1.5 },
			still: { format: 'webp', quality: 90 },
		} );
		expect( docs.frame ).toBeUndefined();
	} );
} );

describe( 'script errors', () => {
	const parse = ( shots: unknown[] ) => {
		const data = { name: 'x', description: 'x', shots };
		const result = Script.safeParse( data );
		return result.success ? [] : describeIssues( result.error, data );
	};

	it( 'reports a mistyped step field against the verb it has', () => {
		expect(
			parse( [
				{ name: 'a', description: 'a', steps: [ { click: { role: 'button' }, buton: 'right' } ] },
			] )
		).toEqual( [ expect.stringMatching( /^shots\.0\.steps\.0: Unrecognized key: "buton"/ ) ] );
	} );

	it( 'reports a step with no known verb once', () => {
		expect(
			parse( [ { name: 'a', description: 'a', steps: [ { tap: { role: 'button' } } ] } ] )
		).toEqual( [ 'shots.0.steps.0: matches none of the forms it can take' ] );
	} );

	it( 'requires unique shot names', () => {
		expect(
			parse( [
				{ name: 'a', description: 'a' },
				{ name: 'a', description: 'b' },
			] )
		).toEqual( [ 'shots.1.name: Duplicate shot name "a"' ] );
	} );
} );

describe( 'scenes', () => {
	it( 'derives stable slugs and ids, and opens on the first site with content', () => {
		const scene = resolveScene(
			{
				name: 'test',
				sites: [ { name: 'Blank One' }, { name: "Rich's Shop", blueprint: 'shop.json' } ],
			},
			'/scenes/test',
			null
		);
		expect( scene.sites.map( ( s ) => s.slug ) ).toEqual( [ 'blank-one', 'rich-s-shop' ] );
		expect( scene.sites[ 1 ].id ).toBe( idForSlug( 'rich-s-shop' ) );
		expect( scene.sites[ 1 ].id ).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
		expect( scene.sites[ 1 ].blueprint ).toBe( path.resolve( '/scenes/test/shop.json' ) );
		expect( scene.open?.slug ).toBe( 'rich-s-shop' );
	} );

	it( 'rejects a site with both import and blueprint', () => {
		expect(
			SCHEMAS.scene.safeParse( {
				name: 'x',
				sites: [ { name: 'x', import: 'a.zip', blueprint: 'b.json' } ],
			} ).success
		).toBe( false );
	} );

	it( 'makes a one-site scene from a Blueprint, named by its title', async () => {
		temp = await mkdtemp( path.join( tmpdir(), 'capture-test-' ) );
		const file = path.join( temp, 'blueprint.json' );
		await writeFile( file, JSON.stringify( { meta: { title: 'Rich Shop' }, steps: [] } ) );
		const scene = await sceneFromBlueprint( file );
		expect( scene.sites ).toEqual( [
			expect.objectContaining( { name: 'Rich Shop', slug: 'rich-shop', blueprint: file } ),
		] );
		expect( scene.open?.slug ).toBe( 'rich-shop' );
	} );

	it( 'finds what a script needs that the scene lacks', async () => {
		const scene = await loadScene( 'wren-and-barley' );
		const script = Script.parse( {
			name: 'x',
			description: 'x',
			chats: [ 'missing-chat' ],
			shots: [
				{
					name: 'a',
					description: 'a',
					steps: [
						{ helper: 'playAgentTurn', args: [ 'design-looks' ] },
						{ setFiles: { css: 'input' }, file: 'nope.zip' },
						{ click: { role: 'button', name: '{{account.name}}' } },
					],
				},
			],
		} );
		expect( checkScriptAgainstScene( script, scene ) ).toEqual( [
			'chats: scene wren-and-barley has no chat "missing-chat"',
			'shots.0 (a): unknown placeholder {{account.name}}',
			'shots.0 (a): scene wren-and-barley has no file "nope.zip"',
		] );
	} );

	it( 'tells the three kinds of file apart', () => {
		expect( detectKind( { shots: [] } ) ).toBe( 'script' );
		expect( detectKind( { sites: [] } ) ).toBe( 'scene' );
		expect( detectKind( { name: 'x', frame: {} } ) ).toBe( 'look' );
		expect( detectKind( { $schema: '../schemas/look.schema.json' } ) ).toBe( 'look' );
		expect( detectKind( [ 1 ] ) ).toBeNull();
	} );
} );

describe( 'signIn', () => {
	const token = { accessToken: 'x', expirationTime: Date.now() + 60_000, id: 1, email: 'a@b.c' };

	it( 'signs in as a made-up demo person by default, with nothing to hide', async () => {
		const signedIn = await signIn( undefined, {} );
		expect( signedIn.token ).toMatchObject( {
			displayName: 'Maya Okafor',
			email: 'maya.okafor@example.com',
		} );
		expect( signedIn.token.expirationTime ).toBeGreaterThan( Date.now() );
		expect( signedIn.hideEmail ).toBeNull();
	} );

	it( 'signs in as another persona by name', async () => {
		const signedIn = await signIn( 'kenji-watanabe', {} );
		expect( signedIn.token.displayName ).toBe( 'Kenji Watanabe' );
	} );

	it( 'signs in as a real account from STUDIO_CAPTURE_AUTH_TOKEN, hiding its email', async () => {
		const signedIn = await signIn( undefined, {
			STUDIO_CAPTURE_AUTH_TOKEN: JSON.stringify( token ),
		} );
		expect( signedIn.token ).toMatchObject( { id: 1 } );
		expect( signedIn.hideEmail ).toBe( 'a@b.c' );
		expect( signedIn.avatar ).toBeUndefined();
	} );

	it( 'refuses an expired token', async () => {
		await expect(
			signIn( undefined, {
				STUDIO_DOCS_AUTH_TOKEN: JSON.stringify( { ...token, expirationTime: 1 } ),
			} )
		).rejects.toThrow( /expired/ );
	} );
} );
