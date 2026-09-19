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
 * When an import-report.json path is provided, the script also re-runs SSI's
 * `finalize_report()` with those measurements so `visual_parity_artifacts` and
 * `quality_pass` are written by SSI itself.
 *
 * Usage:
 *   wp eval-file visual-parity-eval.php <input-json-path> <output-json-path> [import-report-json-path]
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
$report_path = isset( $args[2] ) ? $args[2] : '';

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

$artifact_input = $provided;
if ( isset( $provided['visual_parity'] ) && is_array( $provided['visual_parity'] ) ) {
	$artifact_input = array_merge( $provided, $provided['visual_parity'] );
}
if ( isset( $result['artifact_refs'] ) && is_array( $result['artifact_refs'] ) ) {
	$artifact_input = array_merge( $artifact_input, $result['artifact_refs'] );
}
if ( isset( $result['summary'] ) && is_array( $result['summary'] ) ) {
	$artifact_input['summary'] = $result['summary'];
}

$report_dir = ( '' !== $report_path ) ? dirname( $report_path ) : '';
if ( '' !== $report_dir && is_dir( $report_dir ) ) {
	if ( isset( $result['visual_diff'] ) && is_array( $result['visual_diff'] ) && array() !== $result['visual_diff'] ) {
		$encoded_diff = wp_json_encode( $result['visual_diff'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
		if ( false !== $encoded_diff ) {
			file_put_contents( $report_dir . '/visual-diff.json', $encoded_diff ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes Studio's own staged CLI output.
		}
	}
	$imported = null;
	if ( isset( $provided['visual_parity']['imported_render'] ) && is_array( $provided['visual_parity']['imported_render'] ) ) {
		$imported = $provided['visual_parity']['imported_render'];
	} elseif ( isset( $provided['imported_render'] ) && is_array( $provided['imported_render'] ) ) {
		$imported = $provided['imported_render'];
	}
	if ( is_array( $imported ) ) {
		$encoded_imported = wp_json_encode( $imported, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
		if ( false !== $encoded_imported ) {
			file_put_contents( $report_dir . '/imported-layout-baseline.json', $encoded_imported ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes Studio's own staged CLI output.
		}
	}
}

if ( '' !== $report_path && file_exists( $report_path ) && class_exists( 'Static_Site_Importer_Import_Report' ) && class_exists( 'Static_Site_Importer_Report_Diagnostics' ) ) {
	$raw_report = json_decode( (string) file_get_contents( $report_path ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads SSI's own import report.
	if ( is_array( $raw_report ) ) {
		$report  = Static_Site_Importer_Import_Report::from_array( $raw_report );
		$quality = Static_Site_Importer_Report_Diagnostics::finalize_report(
			$report,
			array(
				'validation_artifacts' => $artifact_input,
				'fail_on_quality'      => true,
			)
		);
		$encoded_report = wp_json_encode( $report->to_array(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
		if ( false !== $encoded_report ) {
			file_put_contents( $report_path, $encoded_report ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes SSI's own import report.
		}
		$validation_path = $report_dir . '/import-validation-result.json';
		if ( file_exists( $validation_path ) ) {
			$encoded_quality = wp_json_encode( $quality, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
			if ( false !== $encoded_quality ) {
				file_put_contents( $validation_path, $encoded_quality ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes SSI's own validation result.
			}
		}
		$result['visual_parity_artifacts'] = $report['visual_parity_artifacts'];
		$result['quality']                 = $quality;
		$result['quality_pass']            = ! empty( $quality['pass'] );
	}
} elseif ( class_exists( 'Static_Site_Importer_Diagnostic_Projection' ) ) {
	$result['visual_parity_artifacts'] = Static_Site_Importer_Diagnostic_Projection::visual_parity_artifact_contract( $artifact_input );
}

$json = wp_json_encode( $result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
if ( false === $json ) {
	WP_CLI::error( 'Failed to encode the visual parity result.' );
}

if ( '' !== $output_path ) {
	file_put_contents( $output_path, $json ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes Studio's own staged CLI output.
}

WP_CLI::log( $json );
WP_CLI::success( 'Visual parity evaluated.' );
