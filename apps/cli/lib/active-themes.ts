import fs from 'fs';
import path from 'path';

/**
 * The folder names of a site's active theme and its parent, read from the site's SQLite database
 * without starting the site. Returns null when they can't be read, so callers keep every theme.
 */
export async function readActiveThemes( siteFolder: string ): Promise< Set< string > | null > {
	const dbPath = path.join( siteFolder, 'wp-content', 'database', '.ht.sqlite' );
	try {
		const wpConfig = fs.readFileSync( path.join( siteFolder, 'wp-config.php' ), 'utf8' );
		const prefix = /\$table_prefix\s*=\s*['"](\w+)['"]/.exec( wpConfig )?.[ 1 ] ?? 'wp_';
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( dbPath, { readOnly: true } );
		try {
			const rows = database
				.prepare(
					`SELECT option_value FROM ${ prefix }options WHERE option_name IN ('stylesheet', 'template')`
				)
				.all() as { option_value: string }[];
			const themes = new Set( rows.map( ( row ) => row.option_value ).filter( Boolean ) );
			return themes.size > 0 ? themes : null;
		} finally {
			database.close();
		}
	} catch {
		return null;
	}
}
