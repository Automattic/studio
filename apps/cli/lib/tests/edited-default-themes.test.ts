import fs from 'fs';
import os from 'os';
import path from 'path';
import { readActiveThemes } from 'cli/lib/active-themes';
import { findEditedDefaultThemes } from 'cli/lib/edited-default-themes';

vi.mock( 'cli/lib/active-themes', () => ( { readActiveThemes: vi.fn() } ) );

describe( 'findEditedDefaultThemes', () => {
	let root: string;
	let site: string;
	let versions: string;

	const writeTheme = ( themePath: string, version: string, footer: string ) => {
		fs.mkdirSync( path.join( themePath, 'parts' ), { recursive: true } );
		fs.writeFileSync(
			path.join( themePath, 'style.css' ),
			`/*\nTheme Name: Theme\nVersion: ${ version }\n*/\n`
		);
		fs.writeFileSync( path.join( themePath, 'parts', 'footer.html' ), footer );
	};
	const siteTheme = ( slug: string ) => path.join( site, 'wp-content', 'themes', slug );
	const stockTheme = ( wordPressVersion: string, slug: string ) =>
		path.join( versions, wordPressVersion, 'wp-content', 'themes', slug );

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'edited-default-themes-' ) );
		site = path.join( root, 'site' );
		versions = path.join( root, 'wordpress-versions' );
		writeTheme( stockTheme( '7.0', 'twentytwentyfive' ), '1.4', 'stock 1.4' );
		writeTheme( stockTheme( 'latest', 'twentytwentyfive' ), '1.5', 'stock 1.5' );
		vi.mocked( readActiveThemes ).mockResolvedValue( new Set( [ 'twentytwentyfive' ] ) );
	} );

	afterEach( () => fs.rmSync( root, { recursive: true, force: true } ) );

	it( 'reports nothing for an unedited default theme', async () => {
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.5', 'stock 1.5' );
		fs.writeFileSync( path.join( siteTheme( 'twentytwentyfive' ), '.DS_Store' ), 'x' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );

	it( 'compares against the stock copy of the same version', async () => {
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.4', 'stock 1.4' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );

	// WordPress releases bump a theme's "Tested up to" without bumping its version.
	it( 'accepts files from different stock copies of the same version', async () => {
		writeTheme( stockTheme( '7.1', 'twentytwentyfive' ), '1.5', 'stock 1.5' );
		fs.appendFileSync( path.join( stockTheme( '7.1', 'twentytwentyfive' ), 'style.css' ), '7.1' );
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.5', 'stock 1.5' );
		fs.appendFileSync( path.join( siteTheme( 'twentytwentyfive' ), 'style.css' ), '7.1' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );

	it( 'reports a default theme with an edited file', async () => {
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.5', 'my footer' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [ 'twentytwentyfive' ] );
	} );

	it( 'reports a default theme with an added file', async () => {
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.5', 'stock 1.5' );
		fs.writeFileSync( path.join( siteTheme( 'twentytwentyfive' ), 'parts', 'extra.html' ), 'x' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [ 'twentytwentyfive' ] );
	} );

	it( 'skips a version Studio has no stock copy of', async () => {
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.6', 'my footer' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );

	it( 'skips themes that are not default themes or not active', async () => {
		vi.mocked( readActiveThemes ).mockResolvedValue( new Set( [ 'my-theme' ] ) );
		writeTheme( siteTheme( 'my-theme' ), '1.5', 'my footer' );
		writeTheme( siteTheme( 'twentytwentyfive' ), '1.5', 'my footer' );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );

	it( 'reports nothing when the active themes can not be read', async () => {
		vi.mocked( readActiveThemes ).mockResolvedValue( null );

		expect( await findEditedDefaultThemes( site, versions ) ).toEqual( [] );
	} );
} );
