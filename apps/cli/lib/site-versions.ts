import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { writeFile } from 'atomically';
import { listArchiveEntries } from 'cli/lib/archive';

type FileEntry = { hash: string; size: number; mtimeMs: number };

const DATABASE_PATH = 'wp-content/database/.ht.sqlite';
const DEBUG_LOG_PATH = 'wp-content/debug.log';
// Caches that plugins fill as the site is visited, such as Page Optimize on a site pulled from
// WordPress.com. They are rebuilt from the site, so they aren't part of its version.
const CACHE_DIRECTORY = 'wp-content/cache/';

// Rows WordPress writes while the site is visited or its admin is open, without anyone changing
// the site: transients and the cron schedule, login sessions and admin screen settings, edit locks,
// and the empty drafts the editor opens with. Any other row counts, so a plugin that writes on its
// own makes the site look changed, which only means Studio asks before overwriting it.
const VOLATILE_OPTION = /^(_site)?_transient_|^cron$/;
const VOLATILE_USER_META =
	/^(session_tokens|\w*user-settings(-time)?|\w*dashboard_quick_press_last_post_id)$/;

function isVolatileRow( table: string, row: Record< string, unknown > ): boolean {
	if ( table.endsWith( 'options' ) ) {
		return VOLATILE_OPTION.test( String( row.option_name ?? '' ) );
	}
	if ( table.endsWith( 'usermeta' ) ) {
		return VOLATILE_USER_META.test( String( row.meta_key ?? '' ) );
	}
	if ( table.endsWith( 'postmeta' ) ) {
		return row.meta_key === '_edit_lock';
	}
	if ( table.endsWith( 'posts' ) ) {
		return row.post_status === 'auto-draft';
	}
	return false;
}

// The file hashes from the site's last version, so the next one only reads the files that changed.
function hashCachePath( siteId: string ): string {
	return path.join( getConfigDirectory(), 'versions', `${ siteId }.json` );
}

function readHashCache( siteId: string ): Record< string, FileEntry > {
	try {
		return JSON.parse( fs.readFileSync( hashCachePath( siteId ), 'utf8' ) );
	} catch {
		return {};
	}
}

async function writeHashCache( siteId: string, files: Record< string, FileEntry > ) {
	const file = hashCachePath( siteId );
	await fs.promises.mkdir( path.dirname( file ), { recursive: true } );
	await writeFile( file, JSON.stringify( files ) );
}

/** Removes what Studio keeps to work out the site's version, for a deleted site. */
export function deleteSiteVersionData( siteId: string ): void {
	fs.rmSync( hashCachePath( siteId ), { force: true } );
}

/**
 * Hashes the files a preview of the site holds, except the database, which is hashed by content
 * instead, the debug log and caches. A file whose size and modification time match the latest version
 * keeps its cached hash, so only changed files are read.
 */
async function hashFiles(
	siteFolder: string,
	cached: Record< string, FileEntry >
): Promise< Record< string, FileEntry > > {
	// The files every preview of the site holds, wherever it's made.
	const entries = await listArchiveEntries( siteFolder, { onWpcom: false } );
	const files: Record< string, FileEntry > = {};
	for ( const { name, sourcePath } of entries.sort( ( a, b ) => a.name.localeCompare( b.name ) ) ) {
		if (
			name.startsWith( 'wp-content/database/' ) ||
			name.startsWith( CACHE_DIRECTORY ) ||
			name === DEBUG_LOG_PATH
		) {
			continue;
		}
		const stat = fs.statSync( sourcePath );
		const known = cached[ name ];
		if ( known && known.size === stat.size && known.mtimeMs === stat.mtimeMs ) {
			files[ name ] = known;
			continue;
		}
		const hash = createHash( 'sha256' ).update( fs.readFileSync( sourcePath ) ).digest( 'hex' );
		files[ name ] = { hash, size: stat.size, mtimeMs: stat.mtimeMs };
	}
	return files;
}

/**
 * Hashes the rows of every table in the site's database, except the rows WordPress rewrites on its
 * own (see `isVolatileRow`).
 */
async function hashDatabase( siteFolder: string ): Promise< string | null > {
	const databasePath = path.join( siteFolder, DATABASE_PATH );
	if ( ! fs.existsSync( databasePath ) ) {
		return null;
	}
	const { DatabaseSync } = await import( 'node:sqlite' );
	const database = new DatabaseSync( databasePath, { readOnly: true } );
	try {
		const hash = createHash( 'sha256' );
		const tables = database
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
			)
			.all() as { name: string }[];
		for ( const { name } of tables ) {
			hash.update( `table:${ name }\n` );
			for ( const row of database
				.prepare( `SELECT * FROM "${ name.replace( /"/g, '""' ) }" ORDER BY rowid` )
				.iterate() as Iterable< Record< string, unknown > > ) {
				if ( isVolatileRow( name, row ) ) {
					continue;
				}
				hash.update(
					JSON.stringify( Object.values( row ), ( _, value ) =>
						value instanceof Uint8Array ? Buffer.from( value ).toString( 'base64' ) : value
					) + '\n'
				);
			}
		}
		return hash.digest( 'hex' );
	} finally {
		database.close();
	}
}

/**
 * The site's version: a hash of every file that makes up its content and of its database. The
 * site holds the same content as long as its version stays the same.
 */
export async function getSiteVersion( siteId: string, siteFolder: string ): Promise< string > {
	const files = await hashFiles( siteFolder, readHashCache( siteId ) );
	const database = await hashDatabase( siteFolder );
	await writeHashCache( siteId, files );
	const id = createHash( 'sha256' );
	for ( const [ relativePath, { hash } ] of Object.entries( files ) ) {
		id.update( `${ relativePath }\0${ hash }\n` );
	}
	id.update( `database\0${ database ?? '' }\n` );
	return id.digest( 'hex' ).slice( 0, 16 );
}
