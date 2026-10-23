import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { expect, it } from 'vitest';
import { createSavedCopyNotes } from '../saved-copies';

// Imported sites can name their tables with a prefix other than wp_.
it.each( [ 'wp_', 'site2_' ] )(
	'states the Site Editor copy that replaces a theme file a tool names, once, read fresh (%s tables)',
	async ( prefix ) => {
		// A child theme, bakery, of bakery-parent, with WordPress's tables.
		const root = mkdtempSync( path.join( os.tmpdir(), 'saved-copies-' ) );
		for ( const file of [ 'bakery/parts/header.html', 'bakery-parent/theme.json' ] ) {
			mkdirSync( path.dirname( path.join( root, 'wp-content/themes', file ) ), {
				recursive: true,
			} );
			writeFileSync( path.join( root, 'wp-content/themes', file ), '' );
		}
		writeFileSync( path.join( root, 'wp-config.php' ), `<?php\n$table_prefix = '${ prefix }';\n` );
		mkdirSync( path.join( root, 'wp-content/database' ) );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
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
		const save = (
			id: number,
			type: string,
			slug: string,
			content = '',
			theme = 1,
			status = 'publish'
		) => {
			db.prepare( `INSERT INTO ${ prefix }posts VALUES ( ?, ?, ?, ?, ?, '2026-10-22' )` ).run(
				id,
				type,
				status,
				slug,
				content
			);
			db.prepare( `INSERT INTO ${ prefix }term_relationships VALUES ( ?, ? )` ).run( id, theme );
		};
		// Copies that replace nothing: another theme's, a draft, and empty Global Styles.
		save( 11, 'wp_template_part', 'header', '', 2 );
		save( 12, 'wp_template_part', 'header', '', 1, 'draft' );
		save( 13, 'wp_global_styles', 'wp-global-styles-bakery', '{"version":3,"styles":{}}' );
		const notes = createSavedCopyNotes( root );
		const header = `{"path":"${ root }/wp-content/themes/bakery/parts/header.html"}`;

		expect( await notes( header ) ).toBe( '' );
		expect( await notes( 'cat wp-content/themes/bakery-parent/theme.json' ) ).toBe( '' );

		// An older copy of the header, then the latest, which WordPress renders.
		save( 10, 'wp_template_part', 'header' );
		save( 14, 'wp_template_part', 'header' );
		save(
			15,
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"version":3,"styles":{"color":{"background":"#fff"}}}'
		);
		db.close();

		expect( await notes( header ) ).toBe(
			'WordPress renders the template part header from its copy saved in the Site Editor (post 14), not from wp-content/themes/bakery/parts/header.html.'
		);
		// A Windows path.
		expect( await notes( 'type wp-content\\themes\\bakery-parent\\theme.json' ) ).toBe(
			'Global Styles saved in the Site Editor (post 15) set color, and WordPress applies them over wp-content/themes/bakery-parent/theme.json.'
		);
		expect( await notes( header ) ).toBe( '' );
		expect( await notes( 'wp-content/themes/bakery/parts/footer.html' ) ).toBe( '' );
	}
);
