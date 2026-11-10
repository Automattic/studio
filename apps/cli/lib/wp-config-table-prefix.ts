import fs from 'fs';
import path from 'path';

/** The characters WordPress accepts in a table prefix. */
const VALID_TABLE_PREFIX = /^[A-Za-z0-9_]+$/;

/**
 * A `$table_prefix` assignment in wp-config.php, with its quoted value. It starts a line, or follows
 * `<?php` on the first one.
 */
const TABLE_PREFIX_ASSIGNMENT = /^(\s*(?:<\?php\s+)?\$table_prefix\s*=\s*)(['"])([^'"]*)\2(\s*;)/gm;

const DEFAULT_TABLE_PREFIX = 'wp_';

function wpConfigPath( sitePath: string ): string {
	return path.join( sitePath, 'wp-config.php' );
}

/**
 * The table prefix the site's wp-config.php sets, or `wp_` when the file or the assignment is
 * missing. The last assignment counts, as in PHP.
 */
export function readSiteTablePrefix( sitePath: string ): string {
	let wpConfig: string;
	try {
		wpConfig = fs.readFileSync( wpConfigPath( sitePath ), 'utf8' );
	} catch {
		return DEFAULT_TABLE_PREFIX;
	}
	const values = Array.from(
		wpConfig.matchAll( TABLE_PREFIX_ASSIGNMENT ),
		( match ) => match[ 3 ]
	);
	const prefix = values.at( -1 );
	return prefix && VALID_TABLE_PREFIX.test( prefix ) ? prefix : DEFAULT_TABLE_PREFIX;
}

export type SetTablePrefixResult =
	| 'updated'
	| 'unchanged'
	| 'linked'
	| 'missing'
	| 'no-assignment'
	| 'invalid-prefix'
	| 'write-failed';

/**
 * Sets `$table_prefix` in the site's wp-config.php to the remote's, so WordPress reads the tables
 * a pull imported. A pull leaves the site's own wp-config.php in place, with the prefix of the
 * install Studio created.
 *
 * Every assignment is changed, including commented-out ones, so the one PHP runs is always
 * covered. Changes nothing when wp-config.php is a link into the pulled tree, because that is the
 * remote's own file and already has its prefix.
 */
export function setSiteTablePrefix( sitePath: string, tablePrefix: string ): SetTablePrefixResult {
	if ( ! VALID_TABLE_PREFIX.test( tablePrefix ) ) {
		return 'invalid-prefix';
	}
	const filePath = wpConfigPath( sitePath );
	const stats = fs.lstatSync( filePath, { throwIfNoEntry: false } );
	if ( ! stats ) {
		return 'missing';
	}
	if ( stats.isSymbolicLink() ) {
		return 'linked';
	}
	let wpConfig: string;
	try {
		wpConfig = fs.readFileSync( filePath, 'utf8' );
	} catch {
		return 'write-failed';
	}
	const values = Array.from(
		wpConfig.matchAll( TABLE_PREFIX_ASSIGNMENT ),
		( match ) => match[ 3 ]
	);
	if ( values.length === 0 ) {
		return 'no-assignment';
	}
	if ( values.every( ( value ) => value === tablePrefix ) ) {
		return 'unchanged';
	}
	const updated = wpConfig.replace(
		TABLE_PREFIX_ASSIGNMENT,
		( _match, start: string, quote: string, _value: string, end: string ) =>
			`${ start }${ quote }${ tablePrefix }${ quote }${ end }`
	);
	// Written next to the original and renamed over it, so an interrupted write never leaves a
	// truncated wp-config.php.
	const temporaryPath = `${ filePath }.studio-tmp`;
	try {
		fs.writeFileSync( temporaryPath, updated );
		fs.chmodSync( temporaryPath, stats.mode );
		fs.renameSync( temporaryPath, filePath );
	} catch {
		try {
			fs.rmSync( temporaryPath, { force: true } );
		} catch {
			// Nothing was written, or it can't be removed either.
		}
		return 'write-failed';
	}
	return 'updated';
}
