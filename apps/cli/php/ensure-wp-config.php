<?php
require_once __DIR__ . '/wp-config-transformer.php';

$wp_config_path = $argv[1] ?? '';
$constants_json = $argv[2] ?? '';

if ( $wp_config_path === '' ) {
	fwrite( STDERR, "Usage: php ensure-wp-config.php <wp-config-path> <constants-json>\n" );
	exit( 1 );
}

$constants = json_decode( $constants_json, true );
if ( !is_array( $constants ) ) {
	fwrite( STDERR, "Invalid constants JSON. Expected a JSON object.\n" );
	exit( 1 );
}

$transformer = WP_Config_Transformer::from_file( $wp_config_path );
$transformer->define_constants( $constants );
$transformer->to_file( $wp_config_path );
