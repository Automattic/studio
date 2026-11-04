import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { readActiveThemes } from 'cli/lib/active-themes';

describe( 'readActiveThemes', () => {
	let site: string;

	beforeEach( () => {
		site = fs.mkdtempSync( path.join( os.tmpdir(), 'active-themes-' ) );
		fs.mkdirSync( path.join( site, 'wp-content', 'database' ), { recursive: true } );
	} );

	afterEach( () => fs.rmSync( site, { recursive: true, force: true } ) );

	it.each( [
		[
			'reads the active theme and its parent',
			"$table_prefix = 'wp_';",
			'wp_',
			[ 'child', 'parent' ],
		],
		[ "uses the site's table prefix", '$table_prefix  = "abc_";', 'abc_', [ 'child', 'parent' ] ],
		[ 'returns null when the database can not be read', "$table_prefix = 'other_';", 'wp_', null ],
	] )( '%s', async ( _, config, prefix, expected ) => {
		fs.writeFileSync( path.join( site, 'wp-config.php' ), `<?php\n${ config }\n` );
		const database = new DatabaseSync( path.join( site, 'wp-content', 'database', '.ht.sqlite' ) );
		database.exec( `CREATE TABLE ${ prefix }options (option_name TEXT, option_value TEXT)` );
		database.exec(
			`INSERT INTO ${ prefix }options VALUES ('stylesheet', 'child'), ('template', 'parent'), ('blogname', 'x')`
		);
		database.close();

		const themes = await readActiveThemes( site );

		expect( themes && [ ...themes ].sort() ).toEqual( expected );
	} );
} );
