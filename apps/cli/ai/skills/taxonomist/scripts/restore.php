<?php
/**
 * Restore taxonomy state from a backup file.
 *
 * Performs a full authoritative restore: the category taxonomy after this
 * script runs will exactly match the backup.
 *
 * Usage:
 *   TAXONOMIST_BACKUP=/path/to/backup.json studio wp eval-file restore.php
 *
 * Environment variables:
 *   TAXONOMIST_BACKUP  Path to the backup JSON file created by backup.php.
 *                      Required.
 *
 * @package Taxonomist
 */

$backup_file = getenv( 'TAXONOMIST_BACKUP' );
if ( ! $backup_file || ! file_exists( $backup_file ) ) {
	WP_CLI::error( 'Set TAXONOMIST_BACKUP env var to the backup file path' );
}

$backup = json_decode( file_get_contents( $backup_file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
if ( ! $backup ) {
	WP_CLI::error( 'Failed to parse backup file' );
}

WP_CLI::log( 'Restoring from backup: ' . $backup['timestamp'] );
WP_CLI::log( 'Posts: ' . $backup['total_posts'] . ', Categories: ' . $backup['total_categories'] );

$backup_slugs   = array();
$old_id_to_slug = array();
foreach ( $backup['categories'] as $category ) {
	$backup_slugs[ $category['slug'] ]      = $category;
	$old_id_to_slug[ $category['term_id'] ] = $category['slug'];
}

// Step 1: Recreate missing categories and update existing ones.
$existing_terms   = get_terms(
	array(
		'taxonomy'   => 'category',
		'hide_empty' => false,
	)
);
$existing_by_slug = array();
foreach ( $existing_terms as $t ) {
	$existing_by_slug[ $t->slug ] = $t;
}

$slug_to_id = array();
$created    = 0;
$updated    = 0;

foreach ( $backup['categories'] as $category ) {
	$slug = $category['slug'];

	if ( isset( $existing_by_slug[ $slug ] ) ) {
		$existing     = $existing_by_slug[ $slug ];
		$needs_update = (
			$existing->name !== $category['name'] ||
			$existing->description !== $category['description']
		);
		if ( $needs_update ) {
			wp_update_term(
				$existing->term_id,
				'category',
				array(
					'name'        => $category['name'],
					'description' => $category['description'],
				)
			);
			++$updated;
			WP_CLI::log( 'Updated category: ' . $category['name'] );
		}
		$slug_to_id[ $slug ] = $existing->term_id;
	} else {
		$temp_name = $category['name'];
		$result    = wp_insert_term(
			$temp_name,
			'category',
			array(
				'slug'        => $category['slug'],
				'description' => $category['description'],
			)
		);
		if ( is_wp_error( $result ) && 'term_exists' === $result->get_error_code() ) {
			$temp_name = $category['name'] . '-taxonomist-' . uniqid();
			$result    = wp_insert_term(
				$temp_name,
				'category',
				array(
					'slug'        => $category['slug'] . '-taxonomist-' . uniqid(),
					'description' => $category['description'],
				)
			);
		}
		if ( ! is_wp_error( $result ) ) {
			$slug_to_id[ $slug ] = $result['term_id'];
			++$created;
			WP_CLI::log( 'Recreated category: ' . $category['name'] );
		} else {
			WP_CLI::warning( 'Failed to recreate ' . $category['name'] . ': ' . $result->get_error_message() );
		}
	}
}

// Step 2: Restore parent-child hierarchy.
$hierarchy_fixed = 0;
foreach ( $backup['categories'] as $category ) {
	$slug       = $category['slug'];
	$old_parent = $category['parent'];

	if ( ! isset( $slug_to_id[ $slug ] ) ) {
		continue;
	}

	$current_id       = $slug_to_id[ $slug ];
	$target_parent_id = 0;

	if ( $old_parent > 0 && isset( $old_id_to_slug[ $old_parent ] ) ) {
		$parent_slug = $old_id_to_slug[ $old_parent ];
		if ( isset( $slug_to_id[ $parent_slug ] ) ) {
			$target_parent_id = $slug_to_id[ $parent_slug ];
		} else {
			WP_CLI::warning( "Parent slug '$parent_slug' not found for category '$slug'" );
		}
	}

	$current_term = get_term( $current_id, 'category' );
	if ( ! $current_term ) {
		continue;
	}

	$needs_fix = (
		(int) $current_term->parent !== $target_parent_id ||
		$current_term->name !== $category['name'] ||
		$current_term->slug !== $category['slug']
	);
	if ( $needs_fix ) {
		wp_update_term(
			$current_id,
			'category',
			array(
				'parent' => $target_parent_id,
				'name'   => $category['name'],
				'slug'   => $category['slug'],
			)
		);
		++$hierarchy_fixed;
	}
}

if ( $hierarchy_fixed > 0 ) {
	WP_CLI::log( "Fixed $hierarchy_fixed parent-child relationships." );
}

// Step 3: Restore every post's categories.
$restored    = 0;
$error_count = 0;
foreach ( $backup['post_categories'] as $pc ) {
	$current_post_id = $pc['post_id'];
	$target_ids      = array();

	foreach ( $pc['category_slugs'] as $slug ) {
		if ( isset( $slug_to_id[ $slug ] ) ) {
			$target_ids[] = $slug_to_id[ $slug ];
		} else {
			WP_CLI::warning( "Category slug '$slug' not found for post ID $current_post_id" );
			++$error_count;
		}
	}

	$current_post = get_post( $current_post_id );
	if ( ! $current_post ) {
		WP_CLI::warning( 'Post ID ' . $current_post_id . ' no longer exists' );
		++$error_count;
		continue;
	}

	$set_result = wp_set_post_categories( $current_post_id, $target_ids );
	if ( is_wp_error( $set_result ) || false === $set_result ) {
		WP_CLI::warning( 'Failed to restore categories for post ID ' . $current_post_id );
		++$error_count;
		continue;
	}
	++$restored;

	if ( 0 === $restored % 500 && $restored > 0 ) {
		WP_CLI::log( "Restored $restored posts..." );
		wp_cache_flush();
	}
}

// Step 4: Delete categories created after the backup.
$post_restore_terms = get_terms(
	array(
		'taxonomy'   => 'category',
		'hide_empty' => false,
	)
);
$deleted            = 0;
foreach ( $post_restore_terms as $t ) {
	if ( ! isset( $backup_slugs[ $t->slug ] ) ) {
		$default_cat = (int) get_option( 'default_category' );
		if ( $t->term_id === $default_cat ) {
			$first_backup_slug = array_key_first( $backup_slugs );
			if ( $first_backup_slug && isset( $slug_to_id[ $first_backup_slug ] ) ) {
				update_option( 'default_category', $slug_to_id[ $first_backup_slug ] );
			}
		}
		wp_delete_term( $t->term_id, 'category' );
		WP_CLI::log( 'Deleted post-backup category: ' . $t->name );
		++$deleted;
	}
}

// Step 5: Restore the default_category setting.
if ( isset( $backup['default_category_slug'] ) ) {
	$default_slug = $backup['default_category_slug'];
	if ( isset( $slug_to_id[ $default_slug ] ) ) {
		update_option( 'default_category', $slug_to_id[ $default_slug ] );
		WP_CLI::log( 'Restored default category: ' . $default_slug );
	}
}

// Step 6: Recount term usage.
WP_CLI::runcommand( 'term recount category' );

WP_CLI::success(
	"Restored $restored posts. " .
	"Created $created categories, updated $updated, deleted $deleted. " .
	"Errors: $error_count."
);
