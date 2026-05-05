<?php
/**
 * Plugin Name:       Studio Panels
 * Description:       Renders dynamic wp-admin panels driven by Studio's AI agent. Built with @wordpress/build's pages routing system; requires the Gutenberg plugin (or WP 7.0+) for the @wordpress/boot, @wordpress/route, and @wordpress/dataviews script modules.
 * Version:           0.3.0
 * Requires at least: 6.6
 * Requires PHP:      7.4
 * Author:            Automattic
 * License:           GPL-2.0-or-later
 * Text Domain:       studio-panels
 *
 * @package studio_panels
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'STUDIO_PANELS_VERSION', '0.3.0' );
define( 'STUDIO_PANELS_PAGE_ID', 'studio-panels' );
define( 'STUDIO_PANELS_PAGE_SLUG', 'studio-panels-wp-admin' );
define( 'STUDIO_PANELS_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Load the auto-generated asset registration from @wordpress/build. This
 * registers all script modules, scripts, styles, routes, and the page
 * (`studio-panels` -> wp-admin variant `studio-panels-wp-admin`).
 */
$studio_panels_build_file = STUDIO_PANELS_PLUGIN_DIR . 'build/build.php';
if ( file_exists( $studio_panels_build_file ) ) {
	require_once $studio_panels_build_file;
}

/**
 * Register the wp-admin menu page. Defers to the wp-build-generated render
 * callback when the build has run; otherwise shows a "build missing" notice.
 *
 * If the host site lacks @wordpress/boot (Gutenberg / WP 7.0+) the page will
 * surface a console error in the browser. The Studio CLI auto-installs
 * Gutenberg before navigating here, so that path is rarely hit in practice.
 */
function studio_panels_register_menu(): void {
	$callback = function_exists( 'studio_panels_studio_panels_wp_admin_render_page' )
		? 'studio_panels_studio_panels_wp_admin_render_page'
		: 'studio_panels_render_build_missing_notice';

	add_submenu_page(
		'tools.php',
		__( 'Studio Panels', 'studio-panels' ),
		__( 'Studio Panels', 'studio-panels' ),
		'edit_posts',
		STUDIO_PANELS_PAGE_SLUG,
		$callback
	);
}
add_action( 'admin_menu', 'studio_panels_register_menu' );

/**
 * Fallback callback used when the wp-build artifacts are missing entirely
 * (e.g. someone activated the source plugin without running `npm run build`).
 */
function studio_panels_render_build_missing_notice(): void {
	echo '<div class="wrap"><h1>' . esc_html__( 'Studio Panels', 'studio-panels' ) . '</h1>';
	echo '<div class="notice notice-warning"><p>';
	echo esc_html__(
		'Studio Panels build artifacts are missing. Run `npm run panels:build` from the Studio repo to regenerate them.',
		'studio-panels'
	);
	echo '</p></div></div>';
}
