import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createSavedCopyNotes, readSavedCopies } from '../saved-copies';

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
	it( "reads the active theme's saved copies with the theme files they replace", async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
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

		expect( await readSavedCopies( site.root ) ).toEqual( [
			{
				postType: 'wp_global_styles',
				id: 12,
				slug: 'wp-global-styles-bakery',
				sets: [ 'color', 'typography', '2 block styles', 'color settings' ],
				files: [
					'wp-content/themes/bakery/theme.json',
					'wp-content/themes/bakery-parent/theme.json',
				],
			},
			{
				postType: 'wp_template_part',
				id: 11,
				slug: 'header',
				files: [
					'wp-content/themes/bakery/parts/header.html',
					'wp-content/themes/bakery/block-template-parts/header.html',
					'wp-content/themes/bakery-parent/parts/header.html',
					'wp-content/themes/bakery-parent/block-template-parts/header.html',
				],
			},
		] );
	} );

	it( 'takes the latest published copy per slug, for the active theme only', async () => {
		const site = makeSite( 'wpx_' );
		site.save( 'wp_template', 'index', '', 2 );
		site.save( 'wp_template', 'home', '', 1, 'draft' );
		site.save( 'wp_template_part', 'header', '' );
		site.save( 'wp_template_part', 'header', '' );
		site.close();

		expect(
			( await readSavedCopies( site.root ) ).map( ( { postType, id } ) => ( { postType, id } ) )
		).toEqual( [ { postType: 'wp_template_part', id: 14 } ] );
	} );

	it( 'has nothing for empty Global Styles or a site without a database', async () => {
		const site = makeSite();
		site.save( 'wp_global_styles', 'wp-global-styles-bakery', '{"version":3,"styles":{}}' );
		site.close();
		expect( await readSavedCopies( site.root ) ).toEqual( [] );
		expect(
			await readSavedCopies( mkdtempSync( path.join( os.tmpdir(), 'saved-overrides-bare-' ) ) )
		).toEqual( [] );
	} );
} );

describe( 'createSavedCopyNotes', () => {
	it( 'states the saved copy that replaces a theme file a tool names, once', async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
		site.save( 'wp_template', 'index', '' );
		site.save(
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"version":3,"styles":{"color":{"background":"#fff"}}}'
		);
		site.close();
		const notes = createSavedCopyNotes( site.root );

		expect(
			await notes( `{"path":"${ site.root }/wp-content/themes/bakery/parts/header.html"}` )
		).toBe(
			'WordPress renders the template part header from its copy saved in the Site Editor (post 11), not from wp-content/themes/bakery/parts/header.html.'
		);
		expect(
			await notes( '{"command":"cd site && cat wp-content/themes/bakery-parent/theme.json"}' )
		).toBe(
			'Global Styles saved in the Site Editor (post 13) set color, and WordPress applies them over wp-content/themes/bakery-parent/theme.json.'
		);
		// Once per copy.
		expect( await notes( 'wp-content/themes/bakery/parts/header.html' ) ).toBe( '' );
	} );

	it( 'says nothing for theme files without a saved copy, other themes, or other text', async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
		site.close();
		const notes = createSavedCopyNotes( site.root );

		expect( await notes( 'wp-content/themes/bakery/parts/footer.html' ) ).toBe( '' );
		expect( await notes( 'wp-content/themes/other-theme/parts/header.html' ) ).toBe( '' );
		expect( await notes( 'wp-content/themes/bakery/theme.json' ) ).toBe( '' );
		expect( await notes( 'post update 5 --post_content=<p>Hi</p>' ) ).toBe( '' );
	} );

	it( 'counts a copy saved after the tracker was created', async () => {
		const site = makeSite();
		const notes = createSavedCopyNotes( site.root );
		expect( await notes( 'themes/bakery/parts/header.html' ) ).toBe( '' );

		site.save( 'wp_template_part', 'header', '' );
		site.close();

		expect( await notes( 'themes/bakery/parts/header.html' ) ).toMatch( /\(post 11\)/ );
	} );
} );
