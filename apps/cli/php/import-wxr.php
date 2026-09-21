<?php
/**
 * Import a WordPress export (WXR) file into the current site using the
 * wordpress-importer plugin's `WP_Import` class, fetching attachments from
 * their original origin URLs (the dashboard importer's default behavior).
 *
 * Media caveat: attachments are downloaded over HTTP from the `attachment_url`
 * baked into the WXR, so they only import when that URL is reachable AND
 * trusted from the import runtime. Exports from a public site work. Exports
 * from another *local Studio* site do NOT: their URLs use a `.wp.local` host
 * that resolves only via the OS `/etc/hosts` + Studio's proxy (neither is
 * available inside the PHP-WASM runtime this runs in) and serve a self-signed
 * cert that the runtime's CA bundle doesn't trust. In that case posts import
 * but images keep pointing at the source site. A future follow-up could stage
 * the source site's uploads locally and short-circuit the fetch via a
 * `pre_http_request` filter — see the data-liberation-agent's import-wxr.php.
 *
 * Usage:
 *   wp --skip-plugins=wordpress-importer eval-file import-wxr.php <wxr-path>
 *
 * Must be run via WP-CLI. Will not execute in a web context.
 *
 * @package Studio
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

$wxr_path = isset( $args[0] ) ? $args[0] : '';

if ( empty( $wxr_path ) || ! file_exists( $wxr_path ) ) {
	WP_CLI::error( "WXR not found: $wxr_path" );
}

define( 'WP_LOAD_IMPORTERS', true );
require_once ABSPATH . 'wp-admin/includes/admin.php';

// This script is expected to be invoked with `--skip-plugins=wordpress-importer`
// (see wxr-importer.ts). That prevents WP-CLI's bootstrap from loading the plugin
// before we've defined WP_LOAD_IMPORTERS — which would leave the class undefined
// AND cache the file in require_once. With the plugin skipped, this require_once is
// the first load and everything wires up.
if ( ! class_exists( 'WP_Import' ) ) {
	$candidates = array(
		WP_PLUGIN_DIR . '/wordpress-importer/src/wordpress-importer.php',
		WP_PLUGIN_DIR . '/wordpress-importer/wordpress-importer.php',
	);
	$loaded = false;
	foreach ( $candidates as $candidate ) {
		if ( file_exists( $candidate ) ) {
			require_once $candidate;
			$loaded = true;
			break;
		}
	}
	if ( ! $loaded ) {
		WP_CLI::error( 'wordpress-importer plugin files not found under ' . WP_PLUGIN_DIR );
	}
}
if ( ! class_exists( 'WP_Import' ) ) {
	WP_CLI::error( 'WP_Import class still not defined after loading the plugin. Did you remember to pass --skip-plugins=wordpress-importer on the wp-cli invocation?' );
}

// Minimum boilerplate to drive wordpress-importer headlessly — mirrors what the
// plugin's own CLI path does.
kses_remove_filters();
$admins = get_users( array( 'role' => 'administrator' ) );
if ( ! empty( $admins ) ) {
	wp_set_current_user( $admins[0]->ID );
}

$wp_import                    = new WP_Import();
$wp_import->fetch_attachments = true;

// Skip intermediate image-size (thumbnail) generation during import. WP_Import
// runs wp_generate_attachment_metadata per attachment, which regenerates every
// registered size — for media-heavy sites (100s of images) this blows Studio's
// 120s `start-server` IPC silence window before the import can finish. The
// full-size image is imported regardless; thumbnails can be regenerated later
// via `wp media regenerate` if needed.
add_filter( 'intermediate_image_sizes_advanced', '__return_empty_array' );

// Heartbeat. The import below is wrapped in ob_start(), so WP_Import's own
// per-item progress echo is captured into the buffer and never reaches the
// WP-CLI channel until import() returns. A media-heavy WXR (100s of attachments)
// then runs SILENTLY for well over Studio's 120s `start-server` IPC silence
// window, so the daemon kills the wp-cli call mid-import. WP_CLI::log writes to
// the STDOUT *handle*, which ob_start does NOT capture — so emitting one per N
// imported items keeps the channel active without polluting the captured output.
$dla_progress  = 0;
$dla_heartbeat = static function () use ( &$dla_progress ) {
	$dla_progress++;
	if ( 0 === $dla_progress % 5 ) {
		WP_CLI::log( sprintf( '  …imported %d items', $dla_progress ) );
	}
};
add_action( 'add_attachment', $dla_heartbeat );
add_action( 'wp_import_insert_post', $dla_heartbeat );
add_action( 'wp_import_insert_term', $dla_heartbeat );

$_GET  = array(
	'import' => 'wordpress',
	'step'   => 2,
);
$_POST = array(
	'imported_authors'  => array(),
	'user_map'          => array(),
	'fetch_attachments' => true,
);

WP_CLI::log( "Importing $wxr_path" );

ob_start();
$wp_import->import( $wxr_path );
$import_output = ob_get_clean();
WP_CLI::log( $import_output );

WP_CLI::success( 'WXR import complete.' );
