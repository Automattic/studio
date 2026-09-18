<?php
/**
 * Evaluate captured-vs-imported section geometry through the Static Site
 * Importer plugin's own visual-parity oracle (`Static_Site_Importer_Visual_Parity_Oracle`),
 * without re-running the import.
 *
 * Studio measures captured section geometry (from the Data Liberation capture) and
 * imported section geometry (from the live imported site) itself with Playwright, then
 * hands both to this script as `source_reports.layout_baseline` plus `imported_render`
 * in schema `static-site-importer/layout-baseline/v1`. The oracle class is a pure
 * function of that input — this script only decodes it, calls the class, and re-encodes
 * the result, so the evaluator that runs here is the real, unmodified SSI code, not a
 * Studio reimplementation.
 *
 * Usage:
 *   wp eval-file visual-parity-eval.php <input-json-path> <output-json-path>
 *
 * Must be run via WP-CLI while the static-site-importer plugin is still
 * active (before its post-import cleanup), so the oracle class is loaded.
 *
 * @package Studio
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

$input_path  = isset( $args[0] ) ? $args[0] : '';
$output_path = isset( $args[1] ) ? $args[1] : '';

if ( empty( $input_path ) || ! file_exists( $input_path ) ) {
	WP_CLI::error( "Visual parity input not found: $input_path" );
}

if ( ! class_exists( 'Static_Site_Importer_Visual_Parity_Oracle' ) ) {
	WP_CLI::error( 'Static_Site_Importer_Visual_Parity_Oracle is unavailable. Is the static-site-importer plugin still active?' );
}

$raw      = file_get_contents( $input_path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads Studio's own staged CLI input.
$provided = null !== $raw ? json_decode( $raw, true ) : null;
if ( ! is_array( $provided ) ) {
	WP_CLI::error( 'Visual parity input must be a JSON object.' );
}

$result = Static_Site_Importer_Visual_Parity_Oracle::evaluate( $provided );
$json   = wp_json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
if ( false === $json ) {
	WP_CLI::error( 'Failed to encode the visual parity result.' );
}

if ( '' !== $output_path ) {
	file_put_contents( $output_path, $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes Studio's own staged CLI output.
}

WP_CLI::log( $json );
WP_CLI::success( 'Visual parity evaluated.' );
