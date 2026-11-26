<?php
/**
 * Export all published posts with full content and categories to JSON.
 *
 * Streams posts one-by-one to avoid memory issues on large sites.
 * Output is a JSON array where each element contains the post ID, title,
 * publication date, full text content (HTML stripped), assigned category
 * names, and permalink URL.
 *
 * Usage:
 *   studio wp eval-file export-posts.php
 *
 * Environment variables:
 *   TAXONOMIST_OUTPUT  Path for the output JSON file.
 *                      Default: /tmp/taxonomist-export.json
 *
 * @package Taxonomist
 */

$output_file = getenv( 'TAXONOMIST_OUTPUT' ) ? getenv( 'TAXONOMIST_OUTPUT' ) : '/tmp/taxonomist-export.json';

// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fopen
// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fwrite
// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fclose
$fp = fopen( $output_file, 'w' );
if ( false === $fp ) {
	WP_CLI::error( 'Failed to open export file for writing: ' . $output_file );
}
$write_or_error = static function ( $file_pointer, $contents, $context ) {
	if ( false === fwrite( $file_pointer, $contents ) ) {
		WP_CLI::error( 'Failed to write ' . $context );
	}
};
$write_or_error( $fp, "[\n", 'opening JSON array to ' . $output_file );

$batch_size     = 100;
$last_id        = 0;
$total_exported = 0;
$first          = true;

while ( true ) {
	$query_args = array(
		'posts_per_page'   => $batch_size,
		'post_status'      => 'publish',
		'post_type'        => 'post',
		'orderby'          => 'ID',
		'order'            => 'ASC',
		'suppress_filters' => false,
	);

	if ( $last_id > 0 ) {
		add_filter(
			'posts_where',
			$keyset_filter = function ( $where ) use ( $last_id ) {
				global $wpdb;
				return $where . $wpdb->prepare( " AND {$wpdb->posts}.ID > %d", $last_id );
			}
		);
	}

	$all_posts = get_posts( $query_args );

	if ( isset( $keyset_filter ) ) {
		remove_filter( 'posts_where', $keyset_filter );
		unset( $keyset_filter );
	}

	if ( empty( $all_posts ) ) {
		break;
	}

	foreach ( $all_posts as $p ) {
		if ( ! $first ) {
			$write_or_error( $fp, ",\n", 'JSON separator to ' . $output_file );
		}
		$first = false;

		$cat_names = wp_get_post_categories( $p->ID, array( 'fields' => 'names' ) );
		$cat_slugs = wp_get_post_categories( $p->ID, array( 'fields' => 'slugs' ) );

		$content = wp_strip_all_tags( $p->post_content );
		$content = preg_replace( '/\s+/', ' ', $content );
		$content = trim( $content );

		$row = wp_json_encode(
			array(
				'post_id'        => $p->ID,
				'title'          => html_entity_decode( $p->post_title, ENT_QUOTES, 'UTF-8' ),
				'date'           => $p->post_date,
				'content'        => $content,
				'categories'     => array_values( $cat_names ),
				'category_slugs' => array_values( $cat_slugs ),
				'url'            => get_permalink( $p->ID ),
			)
		);

		if ( false === $row ) {
			fclose( $fp );
			WP_CLI::error( 'Failed to JSON-encode post ID ' . $p->ID );
		}
		$write_or_error( $fp, $row, 'post row for post ID ' . $p->ID );
		++$total_exported;

		if ( 0 === $total_exported % 500 ) {
			WP_CLI::log( "Exported $total_exported posts..." );
		}
	}

	$last_id = $all_posts[ count( $all_posts ) - 1 ]->ID;
	wp_cache_flush();
}

$write_or_error( $fp, "\n]", 'closing JSON array to ' . $output_file );
if ( false === fclose( $fp ) ) {
	WP_CLI::error( 'Failed to close export file: ' . $output_file );
}
// phpcs:enable

WP_CLI::success( "Exported $total_exported posts to $output_file" );
