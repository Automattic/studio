import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { formatSavedCopies, readActiveSiteFacts, readSavedCopies } from '../site-facts';

// A WordPress root with the tables a saved Site Editor copy lives in.
function makeSite( prefix = 'wp_' ) {
	const root = mkdtempSync( path.join( os.tmpdir(), 'saved-overrides-' ) );
	mkdirSync( path.join( root, 'wp-includes' ) );
	mkdirSync( path.join( root, 'wp-content', 'database' ), { recursive: true } );
	writeFileSync( path.join( root, 'wp-config.php' ), `<?php\n$table_prefix = '${ prefix }';\n` );
	// bakery is a child theme: its own header part, and index and single
	// templates from its parent.
	const themeFile = ( file: string ) => {
		mkdirSync( path.dirname( path.join( root, 'wp-content', 'themes', file ) ), {
			recursive: true,
		} );
		writeFileSync( path.join( root, 'wp-content', 'themes', file ), '' );
	};
	themeFile( 'bakery/parts/header.html' );
	themeFile( 'bakery-parent/templates/index.html' );
	themeFile( 'bakery-parent/templates/single.html' );
	const db = new DatabaseSync( path.join( root, 'wp-content', 'database', '.ht.sqlite' ) );
	db.exec( `
		CREATE TABLE ${ prefix }posts ( ID INTEGER PRIMARY KEY, post_type TEXT, post_status TEXT, post_name TEXT, post_content TEXT, post_date TEXT );
		CREATE TABLE ${ prefix }terms ( term_id INTEGER PRIMARY KEY, name TEXT );
		CREATE TABLE ${ prefix }term_taxonomy ( term_taxonomy_id INTEGER PRIMARY KEY, term_id INTEGER, taxonomy TEXT );
		CREATE TABLE ${ prefix }term_relationships ( object_id INTEGER, term_taxonomy_id INTEGER );
		CREATE TABLE ${ prefix }options ( option_name TEXT, option_value TEXT );
		INSERT INTO ${ prefix }options VALUES ( 'stylesheet', 'bakery' ), ( 'template', 'bakery-parent' );
		INSERT INTO ${ prefix }terms VALUES ( 1, 'bakery' ), ( 2, 'other-theme' );
		INSERT INTO ${ prefix }term_taxonomy VALUES ( 1, 1, 'wp_theme' ), ( 2, 2, 'wp_theme' );
	` );
	let id = 10;
	const save = (
		postType: string,
		name: string,
		content: string,
		theme = 1,
		status = 'publish'
	) => {
		id += 1;
		db.prepare( `INSERT INTO ${ prefix }posts VALUES ( ?, ?, ?, ?, ?, '2026-10-22' )` ).run(
			id,
			postType,
			status,
			name,
			content
		);
		db.prepare( `INSERT INTO ${ prefix }term_relationships VALUES ( ?, ? )` ).run( id, theme );
		return id;
	};
	return { root, save, close: () => db.close() };
}

describe( 'readSavedCopies', () => {
	it( "states the active theme's saved copies, grouped, and which replace a theme file", async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
		site.save( 'wp_template', 'index', '' );
		site.save( 'wp_template', 'single', '' );
		site.save( 'wp_template', 'page-about', '' );
		site.save( 'wp_template_part', 'promo', '' );
		site.save(
			'wp_global_styles',
			'wp-global-styles-bakery',
			JSON.stringify( {
				version: 3,
				styles: {
					color: { background: '#fff' },
					typography: { lineHeight: '1.7' },
					blocks: { 'core/button': {}, 'core/quote': {} },
				},
				settings: { color: { palette: {} } },
			} )
		);
		site.close();

		expect( formatSavedCopies( await readSavedCopies( site.root ) ) ).toBe(
			"Saved in the Site Editor, which WordPress uses instead of the theme's files: templates index (post 12), single (13); template part header (post 11). " +
				'Only in the Site Editor: template page-about (post 14); template part promo (post 15). ' +
				'Global Styles (post 16), applied over theme.json, set color, typography, 2 block styles, and color settings.'
		);
	} );

	it( 'takes the latest published copy per slug, for the active theme only', async () => {
		const site = makeSite( 'wpx_' );
		site.save( 'wp_template', 'index', '', 2 );
		site.save( 'wp_template', 'home', '', 1, 'draft' );
		site.save( 'wp_template_part', 'header', '' );
		site.save( 'wp_template_part', 'header', '' );
		site.close();

		expect( await readSavedCopies( site.root ) ).toEqual( [
			{ postType: 'wp_template_part', id: 14, slug: 'header', hasThemeFile: true },
		] );
	} );

	it( 'has nothing for empty Global Styles or a site without a database', async () => {
		const site = makeSite();
		site.save( 'wp_global_styles', 'wp-global-styles-bakery', '{"version":3,"styles":{}}' );
		site.close();
		expect( await readSavedCopies( site.root ) ).toEqual( [] );
		expect(
			await readSavedCopies( mkdtempSync( path.join( os.tmpdir(), 'saved-overrides-bare-' ) ) )
		).toEqual( [] );
		expect( formatSavedCopies( [] ) ).toBeUndefined();
	} );
} );

describe( 'readActiveSiteFacts', () => {
	it( 'states the WordPress a local site runs and where its block types are declared', async () => {
		const sitePath = mkdtempSync( path.join( os.tmpdir(), 'site-facts-' ) );
		mkdirSync( path.join( sitePath, 'wp-includes' ) );
		writeFileSync(
			path.join( sitePath, 'wp-includes', 'version.php' ),
			"<?php\n$wp_version = '6.9.1';\n"
		);

		const facts = await readActiveSiteFacts( { name: 'Site', path: sitePath, running: true } );

		expect( facts ).toEqual( [
			`WordPress 6.9.1. Its core block types, with their attributes and supports, are declared in ${ sitePath
				.split( path.sep )
				.join( '/' ) }/wp-includes/blocks/<block>/block.json.`,
		] );
	} );

	it( 'has no facts for a WordPress.com site or no site', async () => {
		expect(
			await readActiveSiteFacts( { name: 'Live', path: '', running: false, remote: true } )
		).toEqual( [] );
		expect( await readActiveSiteFacts( null ) ).toEqual( [] );
	} );
} );
