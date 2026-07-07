import fs from 'fs';
import path from 'path';
import {
	LEGACY_MU_PLUGIN_FILENAMES,
	STUDIO_ERROR_LOG_FILENAME,
	STUDIO_LOADER_MU_PLUGIN_FILENAME,
} from '@studio/common/lib/mu-plugins';

// Paths excluded from site exports AND checkpoints, relative to the site root.
// The database directory is excluded because both features capture the
// database separately; the SQLite integration and Studio loader mu-plugins are
// runtime-managed and reinstalled by `keepSqliteIntegrationUpdated`.
const EXACT_PATHS_TO_EXCLUDE = [
	'wp-content/mu-plugins/sqlite-database-integration',
	'wp-content/database',
	'wp-content/db.php',
	'wp-content/debug.log',
	`wp-content/${ STUDIO_ERROR_LOG_FILENAME }`,
	...LEGACY_MU_PLUGIN_FILENAMES.map( ( name ) => `wp-content/mu-plugins/${ name }` ),
	`wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`,
];

const DIRECTORY_NAMES_TO_EXCLUDE = [ '.git', 'node_modules', 'cache' ];

export function isExactPathExcluded( pathToCheck: string ): boolean {
	return EXACT_PATHS_TO_EXCLUDE.some( ( pathToExclude ) =>
		pathToCheck.startsWith( path.normalize( pathToExclude ) )
	);
}

// Look for disallowed directory names in a given path. If found, determine
// whether that part of the path is a directory or not.
export function isPathExcludedByPattern( pathToCheck: string ): boolean {
	const pathParts = pathToCheck.split( path.sep );

	for ( const directoryName of DIRECTORY_NAMES_TO_EXCLUDE ) {
		if ( ! pathParts.includes( directoryName ) ) {
			continue;
		}
		const offenderIndex = pathToCheck.lastIndexOf( directoryName );
		const offenderPath = pathToCheck.substring( 0, offenderIndex + directoryName.length );
		try {
			const stat = fs.statSync( offenderPath );
			return stat.isDirectory();
		} catch ( error ) {
			return false;
		}
	}

	return false;
}

// Directory names pruned during checkpoint walks without stat-ing every child.
// Mirrors DIRECTORY_NAMES_TO_EXCLUDE but usable directly on Dirent names.
export function isExcludedDirectoryName( name: string ): boolean {
	return DIRECTORY_NAMES_TO_EXCLUDE.includes( name );
}
