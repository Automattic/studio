<?php
/**
 * Apply category changes from an AI-generated suggestions file.
 *
 * Reads a JSON file of per-post category suggestions and applies them.
 * Categories are resolved by slug to prevent drift between the
 * export/analysis and apply phases.
 *
 * Usage:
 *   studio wp eval-file apply-changes.php suggestions=/path/to/suggestions.json
 *
 * Arguments:
 *   suggestions  Path to the suggestions JSON file. Required.
 *                Format: [{"post_id": 123, "cats": ["wordpress", "ai"]}, ...]
 *                Values in "cats" are category slugs.
 *   categories   Path to the category plan JSON file: the categories to
 *                create, and the new names or descriptions of existing ones.
 *                Format: [{"slug": "ai", "name": "AI", "description": "..."}, ...]
 *   log          Path for the change log TSV.
 *                Default: /tmp/taxonomist-changes.tsv
 *   mode         "preview" (default) shows what would change.
 *                "apply" executes the changes.
 *   remove       Comma-separated category slugs to strip from posts that
 *                receive new suggestions.
 *
 * @package Taxonomist
 */

// WP-CLI passes the arguments after the file as `$args`: key=value pairs.
$options = array();
foreach ( $args as $arg ) {
	list( $key, $value ) = array_pad( explode( '=', $arg, 2 ), 2, '' );
	$options[ $key ]     = $value;
}

$suggestions_file = isset( $options['suggestions'] ) ? $options['suggestions'] : '';
$categories_file  = isset( $options['categories'] ) ? $options['categories'] : '';
$log_file         = isset( $options['log'] ) ? $options['log'] : '/tmp/taxonomist-changes.tsv';
$apply_mode       = isset( $options['mode'] ) ? $options['mode'] : 'preview';
$remove_cats_str  = isset( $options['remove'] ) ? $options['remove'] : '';

if ( ! $suggestions_file || ! file_exists( $suggestions_file ) ) {
	WP_CLI::error( 'Pass the suggestions file as suggestions=<path>' );
}

$suggestions_json = file_get_contents( $suggestions_file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
if ( false === $suggestions_json ) {
	WP_CLI::error( 'Failed to read suggestions file' );
}
$suggestions = json_decode( $suggestions_json, true );
if ( null === $suggestions && JSON_ERROR_NONE !== json_last_error() ) {
	WP_CLI::error( 'Failed to parse suggestions file' );
}
if ( ! is_array( $suggestions ) ) {
	WP_CLI::error( 'Suggestions file must decode to a JSON array' );
}

$all_cats     = get_terms(
	array(
		'taxonomy'   => 'category',
		'hide_empty' => false,
	)
);
$slug_to_id = array();
$id_to_name = array();
foreach ( $all_cats as $t ) {
	$slug_to_id[ $t->slug ]    = $t->term_id;
	$id_to_name[ $t->term_id ] = $t->name;
}

// The plan's categories: checked here, saved once every check has passed.
$category_plan = array();
if ( $categories_file ) {
	$category_plan = json_decode( (string) file_get_contents( $categories_file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	if ( ! is_array( $category_plan ) ) {
		WP_CLI::error( 'The categories file must decode to a JSON array' );
	}
}
$planned_slugs = array();
foreach ( $category_plan as $planned ) {
	$slug = isset( $planned['slug'] ) ? $planned['slug'] : '';
	if ( ! $slug || ( ! isset( $slug_to_id[ $slug ] ) && empty( $planned['name'] ) ) ) {
		WP_CLI::error( 'Each planned category needs a slug, and a new one a name: ' . wp_json_encode( $planned ) );
	}
	$planned_slugs[ $slug ] = true;
}

$remove_slugs = array_filter( array_map( 'trim', explode( ',', $remove_cats_str ) ) );
$remove_ids   = array();
foreach ( $remove_slugs as $slug ) {
	if ( isset( $slug_to_id[ $slug ] ) ) {
		$remove_ids[] = $slug_to_id[ $slug ];
	}
}

$default_cat_id = (int) get_option( 'default_category' );
if ( in_array( $default_cat_id, $remove_ids, true ) ) {
	$default_term = get_term( $default_cat_id, 'category' );
	$default_name = $default_term ? $default_term->name : "ID $default_cat_id";
	WP_CLI::error(
		"remove= includes '$default_name' which is the site's default category. " .
		'Change the default category setting first (wp option update default_category NEW_ID), then retry.'
	);
}

$unresolved = array();
foreach ( $suggestions as $suggestion ) {
	$suggested_refs = isset( $suggestion['cats'] ) ? $suggestion['cats'] : array();
	foreach ( $suggested_refs as $ref ) {
		if ( ! isset( $slug_to_id[ $ref ] ) && ! isset( $planned_slugs[ $ref ] ) ) {
			$unresolved[ $ref ] = true;
		}
	}
}
if ( ! empty( $unresolved ) ) {
	$list = implode( ', ', array_keys( $unresolved ) );
	WP_CLI::error(
		"Taxonomy drift detected: these categories from the suggestions do not exist in the live site: $list. " .
		'Add them to the categories file, or re-export and re-analyze.'
	);
}

// A preview stands in a placeholder ID for each category it would create.
foreach ( $category_plan as $planned ) {
	$slug   = $planned['slug'];
	$exists = isset( $slug_to_id[ $slug ] );
	$fields = array_filter(
		array(
			'name'        => isset( $planned['name'] ) ? $planned['name'] : '',
			'description' => isset( $planned['description'] ) ? $planned['description'] : '',
		),
		'strlen'
	);
	WP_CLI::log( ( $exists ? 'Update' : 'Create' ) . " category $slug" );
	if ( 'apply' !== $apply_mode ) {
		$id                  = $exists ? $slug_to_id[ $slug ] : "new:$slug";
		$slug_to_id[ $slug ] = $id;
		$id_to_name[ $id ]   = isset( $fields['name'] ) ? $fields['name'] : $id_to_name[ $id ];
		continue;
	}
	$result = $exists
		? wp_update_term( $slug_to_id[ $slug ], 'category', $fields )
		: wp_insert_term( $fields['name'], 'category', array_merge( $fields, array( 'slug' => $slug ) ) );
	if ( is_wp_error( $result ) ) {
		WP_CLI::error( "Failed to save category $slug: " . $result->get_error_message() );
	}
	$slug_to_id[ $slug ]              = $result['term_id'];
	$id_to_name[ $result['term_id'] ] = get_term( $result['term_id'], 'category' )->name;
}

// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fopen
// phpcs:disable WordPress.WP.AlternativeFunctions.file_system_operations_fclose
$log = fopen( $log_file, 'w' );
if ( false === $log ) {
	WP_CLI::error( 'Failed to open log file for writing: ' . $log_file );
}
$header_written = fputcsv( $log, array( 'timestamp', 'action', 'post_id', 'post_title', 'old_categories', 'new_categories', 'cats_added', 'cats_removed' ), "\t" );
if ( false === $header_written ) {
	fclose( $log );
	WP_CLI::error( 'Failed to write log header to ' . $log_file );
}

$changes     = 0;
$skipped     = 0;
$error_count = 0;

foreach ( $suggestions as $suggestion ) {
	$current_post_id = isset( $suggestion['post_id'] ) ? $suggestion['post_id'] : $suggestion['id'];
	$suggested_refs  = isset( $suggestion['cats'] ) ? $suggestion['cats'] : array();

	if ( empty( $suggested_refs ) ) {
		++$skipped;
		continue;
	}

	$current_post = get_post( $current_post_id );
	if ( ! $current_post ) {
		++$error_count;
		continue;
	}

	$current_ids   = wp_get_post_categories( $current_post_id );
	$current_names = array();
	foreach ( $current_ids as $cid ) {
		if ( isset( $id_to_name[ $cid ] ) ) {
			$current_names[ $cid ] = $id_to_name[ $cid ];
		}
	}

	$kept_ids = array();
	foreach ( $current_ids as $cid ) {
		if ( ! in_array( $cid, $remove_ids, true ) ) {
			$kept_ids[] = $cid;
		}
	}

	$suggested_ids = array();
	foreach ( $suggested_refs as $ref ) {
		if ( isset( $slug_to_id[ $ref ] ) ) {
			$suggested_ids[] = $slug_to_id[ $ref ];
		}
	}

	$new_ids = array_values( array_unique( array_merge( array_values( $kept_ids ), $suggested_ids ) ) );

	$sorted_current = $current_ids;
	$sorted_new     = $new_ids;
	sort( $sorted_current );
	sort( $sorted_new );
	if ( $sorted_current === $sorted_new ) {
		++$skipped;
		continue;
	}

	$added_ids   = array_diff( $new_ids, $current_ids );
	$removed_ids = array_diff( $current_ids, $new_ids );

	$added_names = array();
	foreach ( $added_ids as $aid ) {
		$added_names[] = $id_to_name[ $aid ];
	}

	$removed_names = array();
	foreach ( $removed_ids as $rid ) {
		$removed_names[] = isset( $current_names[ $rid ] ) ? $current_names[ $rid ] : '?';
	}

	$new_names = array();
	foreach ( $new_ids as $nid ) {
		$new_names[] = $id_to_name[ $nid ];
	}

	$ts      = gmdate( 'Y-m-d H:i:s' );
	$log_row = array(
		$ts,
		'SET_CATS',
		$current_post_id,
		$current_post->post_title,
		implode( '|', array_values( $current_names ) ),
		implode( '|', $new_names ),
		implode( '|', $added_names ),
		implode( '|', $removed_names ),
	);

	if ( 'apply' === $apply_mode ) {
		$set_result = wp_set_post_categories( $current_post_id, $new_ids );
		if ( is_wp_error( $set_result ) || false === $set_result ) {
			++$error_count;
			WP_CLI::warning( 'Failed to set categories for post ID ' . $current_post_id );
			continue;
		}
	}

	$log_result = fputcsv( $log, $log_row, "\t" );
	if ( false === $log_result ) {
		fclose( $log );
		WP_CLI::error( 'Failed to write change log row for post ID ' . $current_post_id );
	}

	++$changes;
	if ( 0 === $changes % 200 ) {
		WP_CLI::log( "Processed $changes changes..." );
		wp_cache_flush();
	}
}

fclose( $log );
// phpcs:enable

$verb = ( 'apply' === $apply_mode ) ? 'Applied' : 'Would apply';
WP_CLI::success( "$verb $changes changes. Skipped: $skipped. Errors: $error_count." );
WP_CLI::log( 'Log: ' . $log_file );
