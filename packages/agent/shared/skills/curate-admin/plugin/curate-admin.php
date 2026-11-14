<?php
/**
 * Plugin Name:       Curate Admin
 * Description:       Curates wp-admin for the people who run a site: the menu, post types, settings and dashboard. Reads this site's manifest.
 * Version:           2.0.0
 * Requires at least: 6.9
 * Requires PHP:      7.4
 * Author:            WordPress Studio
 * Author URI:        https://developer.wordpress.com/studio/
 * License:           GPLv2 or later
 * Text Domain:       curate-admin
 *
 * @package CurateAdmin
 */

defined( 'ABSPATH' ) || exit;

define( 'CURATE_ADMIN_VERSION', '2.0.0' );
define( 'CURATE_ADMIN_FILE', __FILE__ );

foreach ( array( 'manifest', 'role', 'content', 'settings', 'requests', 'access', 'dashboard', 'brand', 'editor' ) as $curate_admin_module ) {
	require_once __DIR__ . "/includes/{$curate_admin_module}.php";
}
