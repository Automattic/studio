import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';

// A WordPress 7.1.3 install with its tables, the child theme bakery active.
export function createSite( prefix = 'wp_' ) {
	const root = mkdtempSync( path.join( os.tmpdir(), 'site-facts-' ) );
	mkdirSync( path.join( root, 'wp-includes' ) );
	writeFileSync( path.join( root, 'wp-includes/version.php' ), "<?php\n$wp_version = '7.1.3';\n" );
	writeFileSync( path.join( root, 'wp-config.php' ), `<?php\n$table_prefix = '${ prefix }';\n` );
	mkdirSync( path.join( root, 'wp-content/database' ), { recursive: true } );
	for ( const [ theme, header ] of [
		[ 'bakery', 'Description: A child theme of bakery-parent, scaffolded by Studio Code.' ],
		[ 'bakery-parent', 'Theme Name: Bakery Parent' ],
		[ 'twentytwentyfive', 'Theme Name: Twenty Twenty-Five' ],
	] ) {
		mkdirSync( path.join( root, 'wp-content/themes', theme ), { recursive: true } );
		writeFileSync(
			path.join( root, 'wp-content/themes', theme, 'style.css' ),
			`/*\n${ header }\n*/`
		);
	}
	const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
	db.exec( `
		CREATE TABLE ${ prefix }posts ( ID INTEGER PRIMARY KEY, post_type TEXT, post_status TEXT, post_name TEXT, post_content TEXT, post_date TEXT, post_title TEXT DEFAULT '', post_modified_gmt TEXT DEFAULT '2026-10-22 00:00:00' );
		CREATE TABLE ${ prefix }terms ( term_id INTEGER PRIMARY KEY, name TEXT );
		CREATE TABLE ${ prefix }term_taxonomy ( term_taxonomy_id INTEGER PRIMARY KEY, term_id INTEGER, taxonomy TEXT );
		CREATE TABLE ${ prefix }term_relationships ( object_id INTEGER, term_taxonomy_id INTEGER );
		CREATE TABLE ${ prefix }options ( option_name TEXT PRIMARY KEY, option_value TEXT );
		INSERT INTO ${ prefix }options VALUES ( 'active_plugins', 'a:0:{}' );
		INSERT INTO ${ prefix }options VALUES ( 'stylesheet', 'bakery' ), ( 'template', 'bakery-parent' );
		INSERT INTO ${ prefix }options VALUES ( '_site_transient_update_themes', 'O:8:"stdClass":3:{s:7:"checked";a:3:{s:6:"bakery";s:3:"1.0";s:13:"bakery-parent";s:3:"1.0";s:16:"twentytwentyfive";s:3:"1.5";}s:8:"response";a:0:{}s:9:"no_update";a:2:{s:13:"bakery-parent";a:2:{s:5:"theme";s:13:"bakery-parent";s:11:"new_version";s:3:"1.0";}s:16:"twentytwentyfive";a:2:{s:5:"theme";s:16:"twentytwentyfive";s:11:"new_version";s:3:"1.5";}}}' );
		INSERT INTO ${ prefix }terms VALUES ( 1, 'bakery' ), ( 2, 'other-theme' );
		INSERT INTO ${ prefix }term_taxonomy VALUES ( 1, 1, 'wp_theme' ), ( 2, 2, 'wp_theme' );
	` );
	const save = (
		id: number,
		type: string,
		slug: string,
		content = '',
		theme = 1,
		status = 'publish',
		title = ''
	) => {
		db.prepare(
			`INSERT INTO ${ prefix }posts ( ID, post_type, post_status, post_name, post_content, post_date, post_title ) VALUES ( ?, ?, ?, ?, ?, '2026-10-22', ? )`
		).run( id, type, status, slug, content, title );
		db.prepare( `INSERT INTO ${ prefix }term_relationships VALUES ( ?, ? )` ).run( id, theme );
	};
	const setOptions = ( options: Record< string, string > ) => {
		for ( const [ name, value ] of Object.entries( options ) ) {
			db.prepare( `INSERT OR REPLACE INTO ${ prefix }options VALUES ( ?, ? )` ).run( name, value );
		}
	};
	// An edit as WordPress saves it: new content and a new modified time.
	const edit = ( id: number, content: string, modified = '2026-10-23 00:00:00' ) =>
		db
			.prepare( `UPDATE ${ prefix }posts SET post_content = ?, post_modified_gmt = ? WHERE ID = ?` )
			.run( content, modified, id );
	return { root, save, setOptions, edit };
}
