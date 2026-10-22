import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
	formatSavedCopies,
	getSavedOverrideNote,
	readSavedCopies,
	withSavedOverrideNote,
} from '../saved-overrides';

// A WordPress root with the tables a saved Site Editor copy lives in.
function makeSite( prefix = 'wp_' ) {
	const root = mkdtempSync( path.join( os.tmpdir(), 'saved-overrides-' ) );
	mkdirSync( path.join( root, 'wp-includes' ) );
	mkdirSync( path.join( root, 'wp-content', 'database' ), { recursive: true } );
	mkdirSync( path.join( root, 'wp-content', 'themes', 'bakery', 'parts' ), { recursive: true } );
	writeFileSync( path.join( root, 'wp-config.php' ), `<?php\n$table_prefix = '${ prefix }';\n` );
	const db = new DatabaseSync( path.join( root, 'wp-content', 'database', '.ht.sqlite' ) );
	db.exec( `
		CREATE TABLE ${ prefix }posts ( ID INTEGER PRIMARY KEY, post_type TEXT, post_status TEXT, post_name TEXT, post_content TEXT, post_date TEXT );
		CREATE TABLE ${ prefix }terms ( term_id INTEGER PRIMARY KEY, name TEXT );
		CREATE TABLE ${ prefix }term_taxonomy ( term_taxonomy_id INTEGER PRIMARY KEY, term_id INTEGER, taxonomy TEXT );
		CREATE TABLE ${ prefix }term_relationships ( object_id INTEGER, term_taxonomy_id INTEGER );
		CREATE TABLE ${ prefix }options ( option_name TEXT, option_value TEXT );
		INSERT INTO ${ prefix }options VALUES ( 'stylesheet', 'bakery' );
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

describe( 'getSavedOverrideNote', () => {
	it( 'names the saved copy that overrides a template part', async () => {
		const site = makeSite();
		const id = site.save( 'wp_template_part', 'header', '<!-- wp:site-title /-->' );
		site.close();

		const note = await getSavedOverrideNote(
			site.root,
			'wp-content/themes/bakery/parts/header.html'
		);
		expect( note ).toContain( `wp_template_part post ${ id }` );
		expect( note ).toContain( 'not this file' );
		expect(
			await getSavedOverrideNote( site.root, 'wp-content/themes/bakery/parts/footer.html' )
		).toBeUndefined();
	} );

	it( 'ignores copies saved for another theme, drafts, and other files', async () => {
		const site = makeSite( 'wpx_' );
		site.save( 'wp_template', 'index', '', 2 );
		site.save( 'wp_template', 'home', '', 1, 'draft' );
		site.close();

		for ( const file of [
			'wp-content/themes/bakery/templates/index.html',
			'wp-content/themes/bakery/templates/home.html',
			'wp-content/themes/bakery/style.css',
			'wp-content/plugins/x/templates/index.html',
		] ) {
			expect( await getSavedOverrideNote( site.root, file ) ).toBeUndefined();
		}
	} );

	it( 'lists what saved Global Styles set over theme.json', async () => {
		const site = makeSite();
		const id = site.save(
			'wp_global_styles',
			'wp-global-styles-bakery',
			JSON.stringify( {
				version: 3,
				isGlobalStylesUserThemeData: true,
				styles: { color: { background: '#fff' }, typography: { lineHeight: '1.7' } },
				settings: {},
			} )
		);
		site.close();

		const note = await getSavedOverrideNote( site.root, 'wp-content/themes/bakery/theme.json' );
		expect( note ).toContain( `wp_global_styles post ${ id }` );
		expect( note ).toContain( 'styles.color.background, styles.typography.lineHeight' );
	} );

	it( 'has no note for empty saved Global Styles or a site without a database', async () => {
		const site = makeSite();
		site.save( 'wp_global_styles', 'wp-global-styles-bakery', '{"version":3,"styles":{}}' );
		site.close();
		expect(
			await getSavedOverrideNote( site.root, 'wp-content/themes/bakery/theme.json' )
		).toBeUndefined();

		const bare = mkdtempSync( path.join( os.tmpdir(), 'saved-overrides-bare-' ) );
		expect(
			await getSavedOverrideNote( bare, 'wp-content/themes/bakery/parts/header.html' )
		).toBeUndefined();
	} );
} );

describe( 'withSavedOverrideNote', () => {
	it( 'appends the note to the write result', async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
		site.close();
		const tool = withSavedOverrideNote(
			{
				execute: async ( _id: string, _params: { path?: unknown } ) => ( {
					content: [ { type: 'text', text: 'Wrote header.html' } ],
				} ),
			},
			site.root
		);

		const written = await tool.execute( 'call-1', {
			path: 'wp-content/themes/bakery/parts/header.html',
		} );
		expect( written.content ).toHaveLength( 2 );
		const other = await tool.execute( 'call-2', {
			path: 'wp-content/themes/bakery/parts/footer.html',
		} );
		expect( other.content ).toHaveLength( 1 );
	} );
} );

describe( 'readSavedCopies', () => {
	it( "lists the active theme's saved copies as one fact", async () => {
		const site = makeSite();
		site.save( 'wp_template_part', 'header', '' );
		site.save( 'wp_template', 'index', '', 2 );
		site.save(
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"styles":{"color":{"text":"#111"}}}'
		);
		site.close();

		const copies = await readSavedCopies( site.root );
		expect( copies.map( ( copy ) => copy.postType ) ).toEqual( [
			'wp_global_styles',
			'wp_template_part',
		] );
		expect( formatSavedCopies( copies ) ).toBe(
			"Saved in the Site Editor, so WordPress renders these instead of the theme's files: Global Styles (post 13, sets styles.color.text); template part `header` (post 11)."
		);
		expect( formatSavedCopies( [] ) ).toBeUndefined();
	} );
} );
