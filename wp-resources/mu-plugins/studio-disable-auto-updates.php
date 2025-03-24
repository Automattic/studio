<?php
/**
 * Plugin Name: Studio - Disable Auto Updates
 * Plugin URI:  https://github.com/Automattic/studio
 * Description: Disables WordPress auto-updates when a specific version is selected in Studio
 * Version:     1.0.0
 * Author:      Automattic Inc.
 * Author URI:  https://automattic.com
 * License:     GPL v2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Disable all automatic updates
add_filter( 'automatic_updater_disabled', '__return_true' );

// Disable auto updates for plugins
add_filter( 'auto_update_plugin', '__return_false' );

// Disable auto updates for themes
add_filter( 'auto_update_theme', '__return_false' );

// Disable auto updates for core
add_filter( 'auto_update_core', '__return_false' );

// Return a properly structured object for core updates check
add_filter( 'pre_site_transient_update_core', function() {
	global $wp_version;
	return (object) array(
		'last_checked'    => time(),
		'version_checked' => $wp_version,
		'updates'         => array(),
	);
});

// Remove the version check cron event
add_action( 'init', function() {
	remove_action( 'init', 'wp_schedule_update_checks' );
}); 