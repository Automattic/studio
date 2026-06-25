<?php
/**
 * Import a WooCommerce products CSV using the built-in WC_Product_CSV_Importer.
 *
 * Runs in two phases within a single execution:
 *   Phase 1: Import parent products only (simple + variable) — establishes SKUs and IDs
 *   Phase 2: Import variations only — parent products already exist so parent_id resolves
 *
 * This avoids the placeholder problem where WooCommerce creates "Import placeholder for N"
 * posts when it encounters a parent_id reference before the parent product exists.
 *
 * Must be run via WP-CLI (wp eval-file). Will not execute in a web context.
 *
 * Usage:
 *   wp eval-file import-products.php <csv-path>
 *   wp eval-file import-products.php                     # falls back to $IMPORT_CSV_PATH or default
 *
 * Resolution order for the CSV path: positional arg ($args[0]) > IMPORT_CSV_PATH env > default.
 * Default: /wordpress/wp-content/imports/products.csv
 *
 * @package Studio
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

$csv_path = ! empty( $args[0] )
	? $args[0]
	: ( getenv( 'IMPORT_CSV_PATH' ) ? getenv( 'IMPORT_CSV_PATH' ) : '/wordpress/wp-content/imports/products.csv' );

if ( ! file_exists( $csv_path ) ) {
	WP_CLI::error( "Products CSV not found: $csv_path" );
}

if ( ! class_exists( 'WooCommerce' ) ) {
	WP_CLI::error( 'WooCommerce is not active. Install and activate it first.' );
}

if ( ! class_exists( 'WC_Product_CSV_Importer' ) ) {
	$importer_file = WC_ABSPATH . 'includes/import/class-wc-product-csv-importer.php';
	if ( ! file_exists( $importer_file ) ) {
		WP_CLI::error( 'WC_Product_CSV_Importer class not found. WooCommerce may be outdated.' );
	}
	require_once $importer_file;
}

WP_CLI::log( "Importing products from: $csv_path" );

// Read the CSV and split into parents and variations.
$handle = fopen( $csv_path, 'r' );
if ( ! $handle ) {
	WP_CLI::error( "Cannot open CSV: $csv_path" );
}

$headers = fgetcsv( $handle );
fclose( $handle );

if ( ! $headers ) {
	WP_CLI::error( 'CSV has no headers.' );
}

$type_col = array_search( 'type', $headers, true );
if ( $type_col === false ) {
	WP_CLI::error( 'CSV missing "type" column.' );
}

// Build two temporary CSVs: one for parents (simple/variable), one for variations.
$tmp_dir     = sys_get_temp_dir();
$parents_csv = $tmp_dir . '/woo-import-parents.csv';
$vars_csv    = $tmp_dir . '/woo-import-variations.csv';

$handle = fopen( $csv_path, 'r' );
$p_handle = fopen( $parents_csv, 'w' );
$v_handle = fopen( $vars_csv, 'w' );

// Write headers to both files.
$header_row = fgetcsv( $handle );
fputcsv( $p_handle, $header_row );
fputcsv( $v_handle, $header_row );

$parent_count = 0;
$var_count    = 0;

while ( ( $row = fgetcsv( $handle ) ) !== false ) {
	$type = isset( $row[ $type_col ] ) ? trim( $row[ $type_col ] ) : '';
	if ( $type === 'variation' ) {
		fputcsv( $v_handle, $row );
		$var_count++;
	} else {
		fputcsv( $p_handle, $row );
		$parent_count++;
	}
}

fclose( $handle );
fclose( $p_handle );
fclose( $v_handle );

$total_imported = 0;
$total_updated  = 0;
$total_skipped  = 0;
$total_failed   = 0;

/**
 * Run the importer on a CSV file and accumulate results.
 */
function run_import( $file, $label, &$total_imported, &$total_updated, &$total_skipped, &$total_failed ) {
	$importer = new WC_Product_CSV_Importer( $file, array(
		'parse'            => true,
		'prevent_timeouts' => false,
	) );

	$results = $importer->import();

	$imported = isset( $results['imported'] ) ? count( $results['imported'] ) : 0;
	$updated  = isset( $results['updated'] ) ? count( $results['updated'] ) : 0;
	$skipped  = isset( $results['skipped'] ) ? count( $results['skipped'] ) : 0;
	$failed   = isset( $results['failed'] ) ? count( $results['failed'] ) : 0;

	$total_imported += $imported;
	$total_updated  += $updated;
	$total_skipped  += $skipped;
	$total_failed   += $failed;

	WP_CLI::log( "$label: $imported imported, $updated updated, $skipped skipped, $failed failed." );

	if ( $failed > 0 && ! empty( $results['failed'] ) ) {
		foreach ( $results['failed'] as $failure ) {
			if ( is_wp_error( $failure ) ) {
				WP_CLI::warning( $failure->get_error_message() );
			} elseif ( is_array( $failure ) ) {
				$row   = isset( $failure['row'] ) ? $failure['row'] : '?';
				$error = isset( $failure['error'] ) && is_wp_error( $failure['error'] )
					? $failure['error']->get_error_message()
					: 'Unknown error';
				WP_CLI::warning( "Row $row: $error" );
			}
		}
	}
}

// Phase 1: Import parents (simple + variable products).
WP_CLI::log( "Phase 1: Importing $parent_count parent products..." );
run_import( $parents_csv, 'Parents', $total_imported, $total_updated, $total_skipped, $total_failed );

// Phase 2: Import variations — parents now exist so parent_id (id:N) resolves correctly.
if ( $var_count > 0 ) {
	WP_CLI::log( "Phase 2: Importing $var_count variations..." );
	run_import( $vars_csv, 'Variations', $total_imported, $total_updated, $total_skipped, $total_failed );
}

// Cleanup temp files.
@unlink( $parents_csv );
@unlink( $vars_csv );

WP_CLI::log( "Totals: $total_imported imported, $total_updated updated, $total_skipped skipped, $total_failed failed." );
WP_CLI::success( "Product import complete." );
