<?php
function __is_wp_installed() {
	$wp_load = getcwd() . '/wp-load.php';
	if ( !file_exists( $wp_load ) ) {
		return false;
	}
	require_once $wp_load;
	return is_blog_installed();
}

if ( ! __is_wp_installed() ) {
	$nice_permalinks = '/%year%/%monthnum%/%day%/%postname%/';
	$option_result = update_option( 'permalink_structure', $nice_permalinks );
}
