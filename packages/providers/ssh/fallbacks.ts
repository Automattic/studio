import { shellQuote } from './shell';

/*
 * What a server needs beyond PHP, done in PHP through WP-CLI (`wp eval`) when the server lacks the tool:
 * the MySQL client goes through WordPress's own database connection, and tar and gzip through PHP's
 * streams. Warnings go to stderr, so they can't end up in what a script writes to stdout.
 */

// Writes the tables in STUDIO_TABLES (comma-separated) to STUDIO_FILE as SQL, as mysqldump would.
const EXPORT_SQL = `ini_set( 'display_errors', 'stderr' );
global $wpdb;
$db = $wpdb->dbh;
$out = fopen( getenv( 'STUDIO_FILE' ), 'wb' );
if ( ! $db instanceof mysqli || ! $out ) {
	WP_CLI::error( 'Studio can’t export this database without mysqldump.' );
}
fwrite( $out, "/*!40101 SET NAMES utf8mb4 */;\\n/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\\n" );
foreach ( array_filter( explode( ',', getenv( 'STUDIO_TABLES' ) ) ) as $table ) {
	$create = mysqli_query( $db, "SHOW CREATE TABLE \`$table\`" );
	$rows = $create ? mysqli_query( $db, "SELECT * FROM \`$table\`", MYSQLI_USE_RESULT ) : false;
	if ( ! $rows ) {
		WP_CLI::error( mysqli_error( $db ) );
	}
	fwrite( $out, "\\nDROP TABLE IF EXISTS \`$table\`;\\n" . mysqli_fetch_row( $create )[1] . ";\\n" );
	// Binary strings go as hex, which no character set can change on the way.
	$binary = array();
	foreach ( mysqli_fetch_fields( $rows ) as $field ) {
		$binary[] = 63 === $field->charsetnr && $field->type >= 249 && $field->type <= 254;
	}
	$values = '';
	while ( $row = mysqli_fetch_row( $rows ) ) {
		foreach ( $row as $i => $value ) {
			if ( null === $value ) {
				$row[ $i ] = 'NULL';
			} elseif ( $binary[ $i ] && '' !== $value ) {
				$row[ $i ] = '0x' . bin2hex( $value );
			} else {
				$row[ $i ] = "'" . mysqli_real_escape_string( $db, $value ) . "'";
			}
		}
		$values .= ( '' === $values ? '' : ',' ) . '(' . implode( ',', $row ) . ')';
		if ( strlen( $values ) > 1048576 ) {
			fwrite( $out, "INSERT INTO \`$table\` VALUES $values;\\n" );
			$values = '';
		}
	}
	if ( '' !== $values ) {
		fwrite( $out, "INSERT INTO \`$table\` VALUES $values;\\n" );
	}
	mysqli_free_result( $rows );
}
fwrite( $out, "/*!40014 SET FOREIGN_KEY_CHECKS=1 */;\\n" );
fclose( $out );`;

// Runs the SQL on stdin, one statement at a time, and stops at the first one that fails. A semicolon
// ends a statement only outside quotes, since content often has one inside.
const IMPORT_SQL = `ini_set( 'display_errors', 'stderr' );
global $wpdb;
$db = $wpdb->dbh;
if ( ! $db instanceof mysqli ) {
	WP_CLI::error( 'Studio can’t import into this database without the mysql client.' );
}
$run = function ( $sql ) use ( $db ) {
	if ( '' !== trim( $sql ) && ! mysqli_query( $db, $sql ) ) {
		WP_CLI::error( mysqli_error( $db ) );
	}
};
$run( 'SET FOREIGN_KEY_CHECKS=0' );
$in = fopen( 'php://stdin', 'rb' );
$statement = '';
$quote = '';
while ( false !== ( $line = fgets( $in ) ) ) {
	if ( '' === $quote && '' === trim( $statement ) && preg_match( '/^\\s*(--|#|$)/', $line ) ) {
		continue;
	}
	$length = strlen( $line );
	$start = 0;
	for ( $i = 0; $i < $length; $i++ ) {
		$i += strcspn( $line, '' === $quote ? "'\\"\`;" : $quote . '\\\\', $i );
		if ( $i >= $length ) {
			break;
		}
		$char = $line[ $i ];
		if ( '\\\\' === $char ) {
			$i++;
		} elseif ( '' !== $quote ) {
			$quote = $char === $quote ? '' : $quote;
		} elseif ( ';' === $char ) {
			$run( $statement . substr( $line, $start, $i - $start ) );
			$statement = '';
			$start = $i + 1;
		} else {
			$quote = $char;
		}
	}
	$statement .= substr( $line, $start );
}
$run( $statement );
$run( 'SET FOREIGN_KEY_CHECKS=1' );`;

// Unpacks the .tar.gz STUDIO_ARCHIVE into the folder STUDIO_TO: its folders and files, with the long
// names of PAX and GNU headers.
const EXTRACT_TAR = `ini_set( 'display_errors', 'stderr' );
$in = gzopen( getenv( 'STUDIO_ARCHIVE' ), 'rb' );
$to = getenv( 'STUDIO_TO' );
$read = function ( $length ) use ( $in ) {
	$data = '';
	while ( strlen( $data ) < $length && ! gzeof( $in ) ) {
		$data .= gzread( $in, min( 1048576, $length - strlen( $data ) ) );
	}
	return $data;
};
$long = '';
while ( 512 === strlen( $header = $read( 512 ) ) && '' !== trim( $header, "\\0" ) ) {
	$name = rtrim( substr( $header, 0, 100 ), "\\0" );
	$prefix = rtrim( substr( $header, 345, 155 ), "\\0" );
	if ( 'ustar' === substr( $header, 257, 5 ) && '' !== $prefix ) {
		$name = "$prefix/$name";
	}
	$size = octdec( trim( substr( $header, 124, 12 ), "\\0 " ) );
	$padded = (int) ceil( $size / 512 ) * 512;
	$type = $header[156];
	if ( 'x' === $type || 'L' === $type ) {
		$data = substr( $read( $padded ), 0, $size );
		if ( 'L' === $type ) {
			$long = rtrim( $data, "\\0" );
		} elseif ( preg_match( '/(?:^|\\n)\\d+ path=([^\\n]*)/', $data, $match ) ) {
			$long = $match[1];
		}
		continue;
	}
	if ( '' !== $long ) {
		$name = $long;
		$long = '';
	}
	$name = preg_replace( '#^(\\./)+#', '', $name );
	if ( '/' === substr( $name, 0, 1 ) || preg_match( '#(^|/)\\.\\.(/|$)#', $name ) ) {
		WP_CLI::error( "The archive has an unsafe path: $name" );
	}
	$path = "$to/$name";
	if ( '5' === $type ) {
		is_dir( $path ) || mkdir( $path, 0755, true );
	} elseif ( '0' === $type || "\\0" === $type ) {
		is_dir( dirname( $path ) ) || mkdir( dirname( $path ), 0755, true );
		$out = fopen( $path, 'wb' );
		for ( $left = $size; $left > 0; $left -= strlen( $chunk ) ) {
			$chunk = $read( min( 1048576, $left ) );
			if ( '' === $chunk ) {
				WP_CLI::error( 'The archive ends early.' );
			}
			fwrite( $out, $chunk );
		}
		fclose( $out );
		$padded -= $size;
	}
	$read( '5' === $type ? 0 : $padded );
}`;

/**
 * Writes a tar of the paths on stdin, one per line, to file descriptor 3, leaving out what matches the
 * patterns in STUDIO_EXCLUDE, one per line, as tar's --exclude does. Symbolic links stay links.
 */
export const CREATE_TAR = `ini_set( 'display_errors', 'stderr' );
$out = fopen( 'php://fd/3', 'wb' );
$excluded = array_filter( explode( "\\n", getenv( 'STUDIO_EXCLUDE' ) ) );
$pad = function ( $size ) use ( $out ) {
	if ( $size % 512 ) {
		fwrite( $out, str_repeat( "\\0", 512 - $size % 512 ) );
	}
};
$header = function ( $name, $type, $size = 0, $link = '', $mode = 0644, $mtime = 0 ) use ( $out ) {
	$block = pack(
		'a100a8a8a8a12a12a8a1a100a6a2a32a32a8a8a155a12',
		substr( $name, 0, 100 ), sprintf( '%07o', $mode ), '0000000', '0000000', sprintf( '%011o', $size ),
		sprintf( '%011o', $mtime ), str_repeat( ' ', 8 ), $type, substr( $link, 0, 100 ), 'ustar', '00',
		'', '', '', '', '', ''
	);
	$sum = array_sum( array_map( 'ord', str_split( $block ) ) );
	fwrite( $out, substr_replace( $block, sprintf( '%06o', $sum ) . "\\0 ", 148, 8 ) );
};
// A name or link longer than a header holds goes in a PAX header before it.
$entry = function ( $name, $type, $size = 0, $link = '', $mode = 0644, $mtime = 0 ) use ( $out, $header, $pad ) {
	if ( strlen( $name ) > 100 || strlen( $link ) > 100 ) {
		$pax = '';
		foreach ( array( 'path' => $name, 'linkpath' => $link ) as $key => $value ) {
			if ( '' === $value ) {
				continue;
			}
			$record = " $key=$value\\n";
			$length = strlen( $record ) + 1;
			while ( strlen( $length . $record ) !== $length ) {
				$length = strlen( $length . $record );
			}
			$pax .= $length . $record;
		}
		$header( 'PaxHeader', 'x', strlen( $pax ) );
		fwrite( $out, $pax );
		$pad( strlen( $pax ) );
	}
	$header( $name, $type, $size, $link, $mode, $mtime );
};
// An item that ends in \`/.\` is the folder a link points to, sent under the link's name.
$add = function ( $path, $follow = false ) use ( &$add, $out, $excluded, $entry, $pad ) {
	foreach ( $excluded as $pattern ) {
		if ( fnmatch( $pattern, $path ) || fnmatch( $pattern, basename( $path ) ) ) {
			return;
		}
	}
	if ( ! $follow && is_link( $path ) ) {
		$entry( $path, '2', 0, readlink( $path ), 0777 );
		return;
	}
	$stat = stat( $path );
	if ( is_dir( $path ) ) {
		$entry( "$path/", '5', 0, '', $stat['mode'] & 0777, $stat['mtime'] );
		foreach ( array_diff( scandir( $path ), array( '.', '..' ) ) as $name ) {
			$add( "$path/$name" );
		}
		return;
	}
	$in = fopen( $path, 'rb' );
	if ( ! $in ) {
		fwrite( STDERR, "Studio skipped $path, which it can't read.\\n" );
		return;
	}
	$entry( $path, '0', $stat['size'], '', $stat['mode'] & 0777, $stat['mtime'] );
	// A file that changes while it's read still fills exactly the size its header says.
	$copied = stream_copy_to_stream( $in, $out, $stat['size'] );
	fwrite( $out, str_repeat( "\\0", $stat['size'] - $copied ) );
	fclose( $in );
	$pad( $stat['size'] );
};
while ( false !== ( $item = fgets( STDIN ) ) ) {
	if ( '' !== ( $item = rtrim( $item, "\\n" ) ) ) {
		$follow = '/.' === substr( $item, -2 );
		$add( $follow ? substr( $item, 0, -2 ) : $item, $follow );
	}
}
fwrite( $out, str_repeat( "\\0", 1024 ) );`;

/**
 * Shell functions for what scripts need beyond PHP, each using the server's own tool when it has one.
 * They need `studio_wp` (`inSite`).
 */
export const FALLBACKS = `studio_has() { command -v "$1" >/dev/null 2>&1; }
# Writes the tables, comma-separated, to the file as SQL.
studio_export() {
	if studio_has mysqldump || studio_has mariadb-dump; then studio_wp db export "$1" --tables="$2" >&2
	else STUDIO_FILE="$1" STUDIO_TABLES="$2" studio_wp eval ${ shellQuote( EXPORT_SQL ) } >&2; fi
}
# Runs the SQL on stdin.
studio_import() {
	if studio_has mysql || studio_has mariadb; then studio_wp db import -
	else studio_wp eval ${ shellQuote( IMPORT_SQL ) }; fi
}
# Unpacks the .tar.gz into the folder.
studio_untar() {
	if studio_has tar && studio_has gzip; then tar -xzf "$1" -C "$2"
	else STUDIO_ARCHIVE="$1" STUDIO_TO="$2" studio_wp eval --skip-wordpress ${ shellQuote(
		EXTRACT_TAR
	) }; fi
}`;
