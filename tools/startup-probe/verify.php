<?php

global $wpdb;
echo 'STUDIO_PROBE_VERIFY=' . wp_json_encode( array(
	'wordpress' => get_bloginfo( 'version' ),
	'php' => PHP_VERSION,
	'products' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'product'" ),
	'postmeta_rows' => (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->postmeta}" ),
	'tables' => count( $wpdb->get_col( 'SHOW TABLES' ) ),
	'active_plugins' => get_option( 'active_plugins' ),
) ) . PHP_EOL;
