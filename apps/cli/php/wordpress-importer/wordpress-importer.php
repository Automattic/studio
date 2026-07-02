<?php
/*
 * @wordpress-plugin
 * Plugin Name:       WordPress Importer
 * Plugin URI:        https://wordpress.org/plugins/wordpress-importer/
 * Description:       Import posts, pages, comments, custom fields, categories, tags and more from a WordPress export file.
 * Author:            wordpressdotorg
 * Author URI:        https://wordpress.org/
 * Version:           0.9.5
 * Requires at least: 5.2
 * Requires PHP:      7.2
 * Text Domain:       wordpress-importer
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 */

if ( ! defined( 'WP_LOAD_IMPORTERS' ) ) {
	return;
}

/** Display verbose errors */
if ( ! defined( 'IMPORT_DEBUG' ) ) {
	define( 'IMPORT_DEBUG', WP_DEBUG );
}

/** WordPress Import Administration API */
require_once ABSPATH . 'wp-admin/includes/import.php';

if ( ! class_exists( 'WP_Importer' ) ) {
	$class_wp_importer = ABSPATH . 'wp-admin/includes/class-wp-importer.php';
	if ( file_exists( $class_wp_importer ) ) {
		require $class_wp_importer;
	}
}

/** Functions missing in older WordPress versions. */
require_once __DIR__ . '/compat.php';

if ( ! class_exists( 'WordPress\XML\XMLProcessor' ) ) {
	require_once __DIR__ . '/php-toolkit/load.php';
}

/** WXR_Parser class */
require_once __DIR__ . '/parsers/class-wxr-parser.php';

/** WXR_Parser_SimpleXML class */
require_once __DIR__ . '/parsers/class-wxr-parser-simplexml.php';

/** WXR_Parser_XML class */
require_once __DIR__ . '/parsers/class-wxr-parser-xml.php';

/**
 * WXR_Parser_Regex class
 * @deprecated 0.9.0 Use WXR_Parser_XML_Processor instead. The WXR_Parser_Regex class
 *             is no longer used by the importer or maintained with bug fixes. The only
 *             reason it is still included in the codebase is for backwards compatibility
 *             with plugins that directly reference it.
 */
require_once __DIR__ . '/parsers/class-wxr-parser-regex.php';

/** WXR_Parser_XML_Processor class */
require_once __DIR__ . '/parsers/class-wxr-parser-xml-processor.php';

/** WP_Import class */
require_once __DIR__ . '/class-wp-import.php';

function wordpress_importer_init() {
	load_plugin_textdomain( 'wordpress-importer' );

	/**
	 * WordPress Importer object for registering the import callback
	 * @global WP_Import $wp_import
	 */
	$GLOBALS['wp_import'] = new WP_Import();
	// phpcs:ignore WordPress.WP.CapitalPDangit
	register_importer( 'wordpress', 'WordPress', __( 'Import <strong>posts, pages, comments, custom fields, categories, and tags</strong> from a WordPress export file.', 'wordpress-importer' ), array( $GLOBALS['wp_import'], 'dispatch' ) );
}
add_action( 'admin_init', 'wordpress_importer_init' );
