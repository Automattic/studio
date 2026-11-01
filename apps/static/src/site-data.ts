import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { getSettingsWpConfigConstants } from '@studio/common/lib/wp-config-constants';
import { phpQuote } from './php';
import { loadPlaygroundClient } from './playground';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { PlaygroundClient } from '@wp-playground/client';

// Archive and database work runs as PHP inside the site's own runtime:
// Playground's PHP has ZipArchive and PharData, and the SQLite driver takes the
// MySQL statements of a dump.

const WORK_DIR = '/tmp/studio-work';
// What push leaves out, by file or folder name.
const SYNC_IGNORED_NAMES = SYNC_IGNORE_DEFAULTS.map( ( entry ) =>
	entry.replace( /^\/wp-content\//, '' )
);

async function runPhp( client: PlaygroundClient, code: string ): Promise< string > {
	const response = await client.run( { code } );
	if ( response.exitCode !== 0 ) {
		throw new Error( response.errors || response.text || 'PHP failed' );
	}
	return response.text;
}

const PHP_HELPERS = `
function studio_rm( $path ) {
	if ( is_dir( $path ) && ! is_link( $path ) ) {
		foreach ( array_diff( scandir( $path ), array( '.', '..' ) ) as $entry ) { studio_rm( "$path/$entry" ); }
		@rmdir( $path );
	} elseif ( file_exists( $path ) || is_link( $path ) ) {
		unlink( $path );
	}
}
function studio_copy( $from, $to ) {
	if ( is_dir( $from ) ) {
		if ( ! is_dir( $to ) ) { mkdir( $to, 0777, true ); }
		foreach ( array_diff( scandir( $from ), array( '.', '..' ) ) as $entry ) {
			studio_copy( "$from/$entry", "$to/$entry" );
		}
	} else {
		copy( $from, $to );
	}
}
// Runs a MySQL dump statement by statement.
function studio_import_sql( $path ) {
	global $wpdb;
	$sql = file_get_contents( $path );
	$length = strlen( $sql );
	$statement = '';
	$quote = null;
	for ( $i = 0; $i < $length; $i++ ) {
		$char = $sql[ $i ];
		if ( null === $quote ) {
			if ( '-' === $char && '-' === ( $sql[ $i + 1 ] ?? '' ) && '' === trim( $statement ) ) {
				$end = strpos( $sql, "\\n", $i );
				$i = false === $end ? $length : $end;
				continue;
			}
			if ( '/' === $char && '*' === ( $sql[ $i + 1 ] ?? '' ) ) {
				$end = strpos( $sql, '*/', $i + 2 );
				$i = false === $end ? $length : $end + 1;
				continue;
			}
			if ( "'" === $char || '"' === $char || '\`' === $char ) {
				$quote = $char;
			} elseif ( ';' === $char ) {
				if ( '' !== trim( $statement ) ) { $wpdb->query( $statement ); }
				$statement = '';
				continue;
			}
		} elseif ( '\\\\' === $char ) {
			$statement .= $char . ( $sql[ $i + 1 ] ?? '' );
			$i++;
			continue;
		} elseif ( $char === $quote ) {
			$quote = null;
		}
		$statement .= $char;
	}
	if ( '' !== trim( $statement ) ) { $wpdb->query( $statement ); }
}
// Points an imported database at this runtime's URL.
function studio_adopt_site_url() {
	global $wpdb;
	$old = $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'siteurl'" );
	$new = defined( 'WP_SITEURL' ) ? WP_SITEURL : site_url();
	if ( $old && $old !== $new ) {
		foreach ( array( 'post_content', 'post_excerpt', 'guid' ) as $column ) {
			$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->posts} SET {$column} = REPLACE({$column}, %s, %s)", $old, $new ) );
		}
	}
	update_option( 'siteurl', $new );
	update_option( 'home', $new );
}
// Writes one table as MySQL statements.
function studio_dump_table( $table, $out ) {
	global $wpdb;
	$create = $wpdb->get_row( "SHOW CREATE TABLE \`$table\`", ARRAY_N );
	fwrite( $out, "DROP TABLE IF EXISTS \`$table\`;\\n" );
	if ( $create && ! empty( $create[1] ) ) {
		fwrite( $out, $create[1] . ";\\n" );
	}
	$offset = 0;
	while ( $rows = $wpdb->get_results( "SELECT * FROM \`$table\` LIMIT 500 OFFSET $offset", ARRAY_A ) ) {
		foreach ( $rows as $row ) {
			$values = array_map( function ( $value ) {
				return null === $value ? 'NULL' : "'" . esc_sql( $value ) . "'";
			}, array_values( $row ) );
			fwrite( $out, "INSERT INTO \`$table\` VALUES (" . implode( ',', $values ) . ");\\n" );
		}
		$offset += 500;
	}
}
function studio_wp_version() {
	include '/wordpress/wp-includes/version.php';
	return $wp_version;
}
`;

// Applies an extracted backup: wp-content files (with their SQLite database,
// if any), then SQL dumps from `sql/` or `database.sql`, which replace it. The
// files land before WordPress loads, so it opens the database they brought.
async function applyExtractedBackup( client: PlaygroundClient, extractedDir: string ) {
	const root = await runPhp(
		client,
		`<?php
${ PHP_HELPERS }
$root = ${ phpQuote( extractedDir ) };
// Archives often wrap everything in one top-level folder.
$entries = array_values( array_diff( scandir( $root ), array( '.', '..', '__MACOSX' ) ) );
if ( 1 === count( $entries ) && is_dir( "$root/{$entries[0]}" ) && ! is_dir( "$root/wp-content" ) ) {
	$root = "$root/{$entries[0]}";
}
$has_dumps = glob( "$root/sql/*.sql" ) || file_exists( "$root/database.sql" );
if ( ! is_dir( "$root/wp-content" ) && ! $has_dumps ) {
	echo 'error:format';
	exit;
}
if ( is_dir( "$root/wp-content" ) ) {
	foreach ( array_diff( scandir( "$root/wp-content" ), array( '.', '..' ) ) as $entry ) {
		if ( in_array( $entry, array( 'db.php', 'sqlite-database-integration' ), true ) ) { continue; }
		if ( 'database' === $entry ) {
			if ( $has_dumps ) { continue; }
			studio_rm( '/wordpress/wp-content/database' );
		}
		studio_copy( "$root/wp-content/$entry", "/wordpress/wp-content/$entry" );
	}
}
echo $root;
`
	);
	if ( root.includes( 'error:format' ) ) {
		throw new Error(
			'This archive is not a WordPress backup Studio can import: it needs a wp-content folder or SQL dumps.'
		);
	}
	await runPhp(
		client,
		`<?php
require '/wordpress/wp-load.php';
${ PHP_HELPERS }
$root = ${ phpQuote( root.trim() ) };
$dumps = glob( "$root/sql/*.sql" ) ?: array();
if ( file_exists( "$root/database.sql" ) ) { $dumps[] = "$root/database.sql"; }
sort( $dumps );
foreach ( $dumps as $dump ) { studio_import_sql( $dump ); }
studio_adopt_site_url();
`
	);
}

// An All-in-One WP Migration archive: each entry is a 4377-byte header (name,
// size, mtime, then the folder it goes in) followed by its bytes, until an
// all-zero header or the v2 end marker (no name). Content folders sit at the
// root, beside database.sql (tables prefixed SERVMASK_PREFIX) and
// package.json, which names the active theme and plugins.
const EXTRACT_WPRESS = `<?php
$work = '${ WORK_DIR }';
$in = fopen( "$work/backup.wpress", 'rb' );
$field = function ( $header, $start, $end ) {
	$value = substr( $header, $start, $end - $start );
	$nul = strpos( $value, "\\0" );
	return false === $nul ? $value : substr( $value, 0, $nul );
};
while ( strlen( $header = fread( $in, 4377 ) ) === 4377 ) {
	$name = $field( $header, 0, 255 );
	if ( '' === $name ) { break; }
	$size = (int) $field( $header, 255, 269 );
	$prefix = trim( $field( $header, 281, 4369 ), '/' );
	$relative = ltrim( ( '.' === $prefix || '' === $prefix ? '' : "$prefix/" ) . $name, '/' );
	$at_root = in_array( $relative, array( 'database.sql', 'package.json' ), true );
	$target = $at_root ? "$work/files/$relative" : "$work/files/wp-content/$relative";
	if ( false !== strpos( "/$relative/", '/../' ) ) { fseek( $in, $size, SEEK_CUR ); continue; }
	if ( ! is_dir( dirname( $target ) ) ) { mkdir( dirname( $target ), 0777, true ); }
	$out = fopen( $target, 'wb' );
	for ( $left = $size; $left > 0; $left -= strlen( $chunk ) ) {
		$chunk = fread( $in, min( 1048576, $left ) );
		if ( '' === $chunk || false === $chunk ) { throw new Exception( 'The backup archive is truncated.' ); }
		fwrite( $out, $chunk );
	}
	fclose( $out );
}
fclose( $in );
if ( file_exists( "$work/files/database.sql" ) ) {
	$source = fopen( "$work/files/database.sql", 'rb' );
	$dump = fopen( "$work/files/database.sql.tmp", 'wb' );
	while ( false !== ( $line = fgets( $source ) ) ) { fwrite( $dump, str_replace( 'SERVMASK_PREFIX', 'wp', $line ) ); }
	fclose( $source );
	fclose( $dump );
	rename( "$work/files/database.sql.tmp", "$work/files/database.sql" );
}
if ( file_exists( "$work/files/package.json" ) ) { rename( "$work/files/package.json", "$work/wpress-package.json" ); }
`;

const ACTIVATE_WPRESS_PACKAGE = `<?php
require '/wordpress/wp-load.php';
$package = json_decode( (string) @file_get_contents( '${ WORK_DIR }/wpress-package.json' ), true );
if ( ! empty( $package['Template'] ) && ! empty( $package['Stylesheet'] ) ) {
	update_option( 'template', $package['Template'] );
	update_option( 'stylesheet', $package['Stylesheet'] );
}
if ( ! empty( $package['Plugins'] ) && is_array( $package['Plugins'] ) ) {
	update_option( 'active_plugins', array_values( $package['Plugins'] ) );
}
`;

async function cleanWorkDir( client: PlaygroundClient ) {
	await runPhp( client, `<?php ${ PHP_HELPERS } studio_rm( '${ WORK_DIR }' );` );
}

// Imports a backup: a Playground or Studio export (wp-content with its SQLite
// database), a Jetpack or WordPress.com archive (wp-content plus sql/), as zip
// or tar.gz, an All-in-One WP Migration .wpress archive, or a bare .sql dump.
export async function importBackup(
	client: PlaygroundClient,
	name: string,
	bytes: Uint8Array
): Promise< void > {
	const lowerName = name.toLowerCase();
	await cleanWorkDir( client );
	await client.mkdirTree( `${ WORK_DIR }/files` );
	try {
		if ( lowerName.endsWith( '.sql' ) ) {
			await client.writeFile( `${ WORK_DIR }/files/database.sql`, bytes );
		} else if ( lowerName.endsWith( '.zip' ) ) {
			await client.writeFile( `${ WORK_DIR }/backup.zip`, bytes );
			await runPhp(
				client,
				`<?php
$zip = new ZipArchive();
if ( true !== $zip->open( '${ WORK_DIR }/backup.zip' ) ) { throw new Exception( 'The archive could not be opened.' ); }
$zip->extractTo( '${ WORK_DIR }/files' );
$zip->close();
`
			);
		} else if ( lowerName.endsWith( '.tar.gz' ) || lowerName.endsWith( '.tgz' ) ) {
			await client.writeFile( `${ WORK_DIR }/backup.tar.gz`, bytes );
			await runPhp(
				client,
				`<?php
$archive = new PharData( '${ WORK_DIR }/backup.tar.gz' );
$archive->extractTo( '${ WORK_DIR }/files', null, true );
`
			);
		} else if ( lowerName.endsWith( '.wpress' ) ) {
			await client.writeFile( `${ WORK_DIR }/backup.wpress`, bytes );
			await runPhp( client, EXTRACT_WPRESS );
		} else {
			throw new Error(
				'Studio on the web imports .zip, .tar.gz and .wpress backups and .sql dumps.'
			);
		}
		await applyExtractedBackup( client, `${ WORK_DIR }/files` );
		if ( lowerName.endsWith( '.wpress' ) ) {
			await runPhp( client, ACTIVATE_WPRESS_PACKAGE );
		}
	} finally {
		await cleanWorkDir( client );
	}
}

// Same db.php as Studio writes from the plugin's db.copy
// (packages/common/lib/sqlite-integration.ts).
const STANDALONE_FILES = `
$zip->addFile( "$base/wp-config.php", 'wp-config.php' );
$sqlite = '/internal/shared/sqlite-database-integration';
if ( ! file_exists( "$base/wp-content/db.php" ) && is_dir( $sqlite ) ) {
	$zip->addFromString(
		'wp-content/db.php',
		str_replace( "'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'", "realpath( __DIR__ . '/mu-plugins/sqlite-database-integration' )", file_get_contents( "$sqlite/db.copy" ) )
	);
	$plugin = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $sqlite, FilesystemIterator::SKIP_DOTS ) );
	foreach ( $plugin as $file ) {
		$zip->addFile( $file->getPathname(), 'wp-content/mu-plugins/sqlite-database-integration' . substr( $file->getPathname(), strlen( $sqlite ) ) );
	}
}
`;

// The site as a zip of wp-content, its SQLite database included: the shape
// Playground exports, which Studio's importers read. A preview site runs the
// archive as it is, so `standalone` adds wp-config.php and the SQLite drop-in
// that Playground keeps outside wp-content, laid out as on a Studio site.
export async function exportSiteZip(
	client: PlaygroundClient,
	{ standalone = false } = {}
): Promise< Uint8Array > {
	const path = '/tmp/studio-export.zip';
	await runPhp(
		client,
		`<?php
${ PHP_HELPERS }
$zip = new ZipArchive();
$zip->open( '${ path }', ZipArchive::CREATE | ZipArchive::OVERWRITE );
$base = '/wordpress';
$iterator = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( "$base/wp-content", FilesystemIterator::SKIP_DOTS ) );
foreach ( $iterator as $file ) {
	$relative = substr( $file->getPathname(), strlen( $base ) + 1 );
	if ( 'wp-content/db.php' === $relative || str_ends_with( $relative, '.sqlite.lock' ) ) { continue; }
	if ( ${ standalone ? 'true' : 'false' } && str_starts_with( $relative, 'wp-content/database/' ) ) {
		// Studio sites keep the database at the plugin's original fixed path.
		if ( preg_match( '#^wp-content/database/\\.ht\\.[^/]+/\\.ht\\.sqlite$#', $relative ) ) {
			$relative = 'wp-content/database/.ht.sqlite';
		} elseif ( 'wp-content/database/db-path.php' === $relative || substr_count( $relative, '/' ) > 2 ) {
			continue;
		}
	}
	$zip->addFile( $file->getPathname(), $relative );
}
${ standalone ? STANDALONE_FILES : '' }
$zip->addFromString( 'meta.json', json_encode( array( 'phpVersion' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION, 'wordpressVersion' => studio_wp_version() ) ) );
$zip->close();
`
	);
	const bytes = await client.readFileAsBuffer( path );
	await client.unlink( path );
	return bytes;
}

// A MySQL-flavored dump of every table, readable by Studio's SQL importer and
// by MySQL itself.
export async function exportDatabaseSql( client: PlaygroundClient ): Promise< string > {
	const path = '/tmp/studio-export.sql';
	await runPhp(
		client,
		`<?php
require '/wordpress/wp-load.php';
${ PHP_HELPERS }
global $wpdb;
$out = fopen( '${ path }', 'w' );
fwrite( $out, "-- Studio on the web database export\\nSET NAMES utf8mb4;\\n\\n" );
foreach ( $wpdb->get_col( 'SHOW TABLES' ) as $table ) {
	studio_dump_table( $table, $out );
	fwrite( $out, "\\n" );
}
fclose( $out );
`
	);
	const text = await client.readFileAsText( path );
	await client.unlink( path );
	return text;
}

export interface PushArchiveOptions {
	database: boolean;
	wpContent: boolean;
	// Paths under wp-content to include instead of all of it.
	paths?: string[];
}

// The archive WordPress.com imports on push: wp-content (minus what never
// syncs), one SQL dump per table under sql/ (users stay on the server), and
// meta.json, as a tar.gz.
export async function buildPushArchive(
	client: PlaygroundClient,
	options: PushArchiveOptions
): Promise< Uint8Array > {
	const paths = ( options.paths ?? [] ).map( ( path ) =>
		path.replace( /^\/?(wp-content\/)?/, '' ).replace( /\/$/, '' )
	);
	await cleanWorkDir( client );
	await client.mkdirTree( `${ WORK_DIR }/sql` );
	try {
		await runPhp(
			client,
			`<?php
require '/wordpress/wp-load.php';
${ PHP_HELPERS }
global $wpdb;
$work = '${ WORK_DIR }';
$ignored = json_decode( ${ phpQuote( JSON.stringify( SYNC_IGNORED_NAMES ) ) }, true );
$paths = json_decode( ${ phpQuote( JSON.stringify( paths ) ) }, true );
$files = array();
if ( ${ options.database ? 'true' : 'false' } ) {
	foreach ( $wpdb->get_col( 'SHOW TABLES' ) as $table ) {
		if ( in_array( $table, array( $wpdb->users, $wpdb->usermeta ), true ) ) { continue; }
		$out = fopen( "$work/sql/$table.sql", 'w' );
		studio_dump_table( $table, $out );
		fclose( $out );
		$files[ "sql/$table.sql" ] = "$work/sql/$table.sql";
	}
}
if ( ${ options.wpContent ? 'true' : 'false' } ) {
	$base = '/wordpress/wp-content';
	$iterator = new RecursiveIteratorIterator(
		new RecursiveCallbackFilterIterator(
			new RecursiveDirectoryIterator( $base, FilesystemIterator::SKIP_DOTS ),
			function ( $file ) use ( $ignored ) { return ! in_array( $file->getFilename(), $ignored, true ); }
		)
	);
	foreach ( $iterator as $file ) {
		$relative = substr( $file->getPathname(), strlen( $base ) + 1 );
		if ( $paths ) {
			$selected = false;
			foreach ( $paths as $path ) {
				if ( $relative === $path || 0 === strpos( $relative, "$path/" ) ) { $selected = true; break; }
			}
			if ( ! $selected ) { continue; }
		}
		$files[ "wp-content/$relative" ] = $file->getPathname();
	}
}
file_put_contents( "$work/meta.json", wp_json_encode( array(
	'siteUrl' => site_url(),
	'phpVersion' => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
	'wordpressVersion' => studio_wp_version(),
	'plugins' => array(),
	'themes' => array(),
) ) );
$files['meta.json'] = "$work/meta.json";
$archive = new PharData( "$work/push.tar" );
$archive->buildFromIterator( new ArrayIterator( $files ) );
$archive->compress( Phar::GZ );
`
		);
		return await client.readFileAsBuffer( `${ WORK_DIR }/push.tar.gz` );
	} finally {
		await cleanWorkDir( client );
	}
}

// Empties a site's files, before the site is deleted.
export async function removeSiteFiles( client: PlaygroundClient ): Promise< void > {
	await runPhp( client, `<?php ${ PHP_HELPERS } studio_rm( '/wordpress' );` );
}

export async function readWordPressVersion( client: PlaygroundClient ): Promise< string > {
	try {
		const source = await client.readFileAsText( '/wordpress/wp-includes/version.php' );
		return /\$wp_version\s*=\s*'([^']+)'/.exec( source )?.[ 1 ] ?? '-';
	} catch {
		return '-';
	}
}

// Copies every file of one site, database included, into another running site.
export async function copySiteFiles(
	source: PlaygroundClient,
	target: PlaygroundClient
): Promise< void > {
	await importBackup( target, 'copy.zip', await exportSiteZip( source ) );
}

// A site folder's files as the push dialog's selective-sync tree lists them:
// what push leaves out (dotfiles included) is left out, and folders are
// expanded `depth` levels, but not inside a plugin or theme.
export async function listFileTree(
	client: PlaygroundClient,
	path: string,
	depth: number
): Promise< RawDirectoryEntry[] > {
	const relative = path.replace( /^\/+|\/+$/g, '' );
	const tree = JSON.parse(
		await runPhp(
			client,
			`<?php
$ignored = json_decode( ${ phpQuote( JSON.stringify( SYNC_IGNORED_NAMES ) ) }, true );
function studio_tree( $base, $relative, $depth, $ignored ) {
	$entries = array();
	$dir = rtrim( "$base/$relative", '/' );
	foreach ( is_dir( $dir ) ? scandir( $dir ) : array() as $name ) {
		if ( '.' === $name[0] || in_array( $name, $ignored, true ) ) { continue; }
		$item = ltrim( "$relative/$name", '/' );
		$is_dir = is_dir( "$dir/$name" );
		$entry = array( 'name' => $name, 'isDirectory' => $is_dir, 'isSymlink' => is_link( "$dir/$name" ), 'path' => $item );
		if ( $is_dir && $depth > 0 ) { $entry['children'] = studio_tree( $base, $item, $depth - 1, $ignored ); }
		$entries[] = $entry;
	}
	return $entries;
}
echo json_encode( studio_tree( '/wordpress', ${ phpQuote( relative ) }, ${ Math.max(
				0,
				depth
			) }, $ignored ) );
`
		)
	) as RawDirectoryEntry[];
	const prune = ( entries: RawDirectoryEntry[] ): RawDirectoryEntry[] =>
		entries.map( ( { children, ...entry } ) =>
			children && ! shouldLimitDepth( entry.path )
				? { ...entry, children: prune( children ) }
				: entry
		);
	return prune( tree );
}

// The bytes a push would send from a site file or folder.
export async function getPathSize( client: PlaygroundClient, path: string ): Promise< number > {
	const size = await runPhp(
		client,
		`<?php
$ignored = json_decode( ${ phpQuote( JSON.stringify( SYNC_IGNORED_NAMES ) ) }, true );
$path = '/wordpress/' . ${ phpQuote( path.replace( /^\/+/, '' ) ) };
if ( ! is_dir( $path ) ) { echo is_file( $path ) ? filesize( $path ) : 0; return; }
$size = 0;
$iterator = new RecursiveIteratorIterator(
	new RecursiveCallbackFilterIterator(
		new RecursiveDirectoryIterator( $path, FilesystemIterator::SKIP_DOTS ),
		function ( $file ) use ( $ignored ) { return ! in_array( $file->getFilename(), $ignored, true ); }
	)
);
foreach ( $iterator as $file ) { $size += $file->getSize(); }
echo $size;
`
	);
	return Number( size ) || 0;
}

// Writes a site's debug and environment settings to its wp-config.php, as
// Studio does for its other sites.
export async function applySettingsToWpConfig(
	client: PlaygroundClient,
	settings: Parameters< typeof getSettingsWpConfigConstants >[ 0 ]
): Promise< void > {
	await (
		await loadPlaygroundClient()
	).defineWpConfigConsts( client, {
		consts: getSettingsWpConfigConstants( settings ),
		method: 'rewrite-wp-config',
	} );
}
