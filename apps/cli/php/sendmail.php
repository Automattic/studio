<?php
/**
 * Studio's sendmail. PHP's `mail()` pipes each message a site sends to this script
 * (Studio sets it as `sendmail_path`), which saves the message unchanged as an
 * `.eml` file in the site's email folder, the first argument. Files are named by
 * the time they arrive, so they sort oldest first; the newest 100 are kept.
 */

$directory = $argv[1] ?? '';
$message   = stream_get_contents( STDIN );
if ( '' === $directory || false === $message ) {
	exit( 1 );
}
if ( ! is_dir( $directory ) && ! @mkdir( $directory, 0700, true ) && ! is_dir( $directory ) ) {
	exit( 1 );
}

$now  = microtime( true );
$name = sprintf( '%s-%06d-%s.eml', gmdate( 'Ymd-His', (int) $now ), ( $now - floor( $now ) ) * 1e6, bin2hex( random_bytes( 3 ) ) );
// Written under a temporary name first, so a reader never sees half a message.
$partial = $directory . '/.' . $name;
if ( false === file_put_contents( $partial, $message ) || ! rename( $partial, $directory . '/' . $name ) ) {
	exit( 1 );
}

$messages = glob( $directory . '/*.eml' );
sort( $messages );
foreach ( array_slice( $messages, 0, -100 ) as $old ) {
	@unlink( $old );
}
