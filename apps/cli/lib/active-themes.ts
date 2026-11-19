import fs from 'fs';
import path from 'path';
import { createDatabase } from '@studio/database/node';
import { getSqliteDatabasePath } from 'cli/lib/database/sqlite-integration';

/**
 * The folder names of a site's active theme and its parent, read from the site's SQLite database
 * without starting the site. Returns null when they can't be read, so callers keep every theme.
 * Only previews read it, and they work from the site's folder, which holds only a SQLite database.
 */
export async function readActiveThemes( siteFolder: string ): Promise< Set< string > | null > {
	try {
		const wpConfig = fs.readFileSync( path.join( siteFolder, 'wp-config.php' ), 'utf8' );
		const prefix = /\$table_prefix\s*=\s*['"](\w+)['"]/.exec( wpConfig )?.[ 1 ] ?? 'wp_';
		await using database = await createDatabase( {
			engine: 'sqlite',
			path: getSqliteDatabasePath( siteFolder ),
		} ).open( { readOnly: true } );
		const rows = await database.query< { option_value: string } >(
			`SELECT option_value FROM ${ prefix }options WHERE option_name IN ('stylesheet', 'template')`
		);
		const themes = new Set( rows.map( ( row ) => row.option_value ).filter( Boolean ) );
		return themes.size > 0 ? themes : null;
	} catch {
		return null;
	}
}
