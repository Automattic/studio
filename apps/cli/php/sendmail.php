<?php
/**
 * Studio's sendmail. PHP's `mail()` pipes each message a site sends to this script
 * (Studio sets it as `sendmail_path`), which saves the message unchanged as an
 * `.eml` file in the site's email folder, the first argument. Files are named by
 * the time they arrive, so they sort oldest first; the newest 100 are kept.
 */

// A failure makes `mail()` return false. The reason goes to stderr: stdout is the
// sending process's own, such as WP-CLI's output.
function studio_sendmail_fail( string $reason ): void {
	fwrite( STDERR, "Studio could not save the email: $reason\n" );
	exit( 1 );
}

$directory = $argv[1] ?? '';
$message   = stream_get_contents( STDIN );
if ( '' === $directory || false === $message ) {
	studio_sendmail_fail( 'no email folder or message' );
}
if ( ! is_dir( $directory ) && ! @mkdir( $directory, 0700, true ) && ! is_dir( $directory ) ) {
	studio_sendmail_fail( "cannot create $directory" );
}

$now  = microtime( true );
$name = sprintf( '%s-%06d-%s.eml', gmdate( 'Ymd-His', (int) $now ), ( $now - floor( $now ) ) * 1e6, bin2hex( random_bytes( 3 ) ) );
// Written under a temporary name first, so a reader never sees half a message.
$partial = $directory . '/.' . $name;
if ( false === @file_put_contents( $partial, $message ) || ! @rename( $partial, $directory . '/' . $name ) ) {
	@unlink( $partial );
	studio_sendmail_fail( "cannot write to $directory" );
}

$messages = glob( $directory . '/*.eml' );
sort( $messages );
foreach ( array_slice( $messages, 0, -100 ) as $old ) {
	@unlink( $old );
}
