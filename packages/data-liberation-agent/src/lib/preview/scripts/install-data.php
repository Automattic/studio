<?php
/**
 * install-data.php — vendored helper invoked by data-install.ts via
 * `studio wp eval-file <this-file> <json-payload-path>`.
 *
 * Inserts the CPT taxonomy terms + content items for the WordPress-driven data
 * path (JS data-mounts → query loops). Idempotent:
 *   - terms matched/created by slug within the taxonomy.
 *   - posts matched by `_dla_item_id` meta (the stable source id); existing
 *     posts are updated in place, never duplicated.
 *   - a post a human edited in wp-admin AFTER our last import is NOT clobbered
 *     (modified-since-import guard via `_dla_imported_at`); reported as skipped.
 *   - a non-DLA post already occupying the item's slug is left alone and
 *     reported as a collision rather than overwritten.
 * (idempotency hardening adopted from wordpress-block-design-compiler's seeder.)
 *
 * Requires the generated CPT mu-plugin to be installed FIRST so the post type +
 * taxonomy are registered when this runs (mu-plugins always load under wp-cli).
 *
 * Payload shape:
 *   {
 *     "cpt": "objet",
 *     "taxonomy": "objet_cat",
 *     "fields": ["price_eur", "dimensions", ...],
 *     "terms":  [ { "slug": "glass", "label": "Glass" }, ... ],
 *     "items":  [ {
 *        "id": "opaline-1965", "title": "...", "content": "...",
 *        "terms": ["glass"], "meta": { "price_eur": 120, ... },
 *        "gallery": [ { "caption": "...", "url": "..." } ]
 *     }, ... ]
 *   }
 *
 * Output: { "inserted": N, "updated": N, "terms": N } or an error object.
 */

// WP-CLI eval-file exposes positional args via $args; fall back to $argv.
$json_path = null;
if ( isset( $args ) && is_array( $args ) && ! empty( $args[0] ) ) {
	$json_path = $args[0];
} elseif ( isset( $argv[1] ) ) {
	$json_path = $argv[1];
}
if ( ! $json_path || ! file_exists( $json_path ) ) {
	echo json_encode( array( 'error' => 'missing JSON payload', 'tried' => $json_path ) );
	exit( 1 );
}

$data = json_decode( file_get_contents( $json_path ), true );
if ( ! is_array( $data ) || empty( $data['cpt'] ) || empty( $data['taxonomy'] ) ) {
	echo json_encode( array( 'error' => 'invalid payload (need cpt + taxonomy)' ) );
	exit( 1 );
}

$cpt    = $data['cpt'];
$tax    = $data['taxonomy'];
$fields = isset( $data['fields'] ) && is_array( $data['fields'] ) ? $data['fields'] : array();

if ( ! post_type_exists( $cpt ) ) {
	echo json_encode( array( 'error' => "post type '$cpt' is not registered — install the CPT mu-plugin first" ) );
	exit( 1 );
}

// 1) Terms (idempotent by slug).
$terms_done = 0;
foreach ( ( isset( $data['terms'] ) ? $data['terms'] : array() ) as $t ) {
	if ( empty( $t['slug'] ) ) { continue; }
	$existing = term_exists( $t['slug'], $tax );
	if ( ! $existing ) {
		$label = isset( $t['label'] ) ? $t['label'] : $t['slug'];
		$res   = wp_insert_term( $label, $tax, array( 'slug' => $t['slug'] ) );
		if ( ! is_wp_error( $res ) ) { $terms_done++; }
	}
}

// 1b) Remove WordPress's seeded default content ("Hello world!" post + "Sample
// Page" page) so it can't surface as a stray first card in the query loops
// (loops order by date ASC, and the seeds predate every imported post, so they
// would lead every grid). Only UN-managed seeds are trashed: a real data item
// that legitimately owns one of these slugs carries `_dla_item_id` and is left
// untouched. Trashed (not force-deleted) so it stays recoverable, and idempotent
// — once trashed, get_page_by_path no longer returns it on later runs. Runs
// BEFORE the item insert so an item that wants the slug isn't blocked as a
// collision by the lingering seed.
$defaults_trashed = 0;
$seed_defaults    = array(
	array( 'slug' => 'hello-world', 'type' => 'post' ),
	array( 'slug' => 'sample-page', 'type' => 'page' ),
);
foreach ( $seed_defaults as $seed ) {
	$seed_post = get_page_by_path( $seed['slug'], OBJECT, $seed['type'] );
	if ( $seed_post && '' === (string) get_post_meta( $seed_post->ID, '_dla_item_id', true ) ) {
		if ( wp_trash_post( $seed_post->ID ) ) { $defaults_trashed++; }
	}
}

// 2) Items (idempotent by _dla_item_id, with edit + collision guards).
$inserted         = 0;
$updated          = 0;
$skipped_modified = 0;
$collisions       = 0;
foreach ( ( isset( $data['items'] ) ? $data['items'] : array() ) as $item ) {
	if ( empty( $item['id'] ) ) { continue; }
	$slug = sanitize_title( $item['id'] );

	$found = get_posts( array(
		'post_type'        => $cpt,
		'post_status'      => 'any',
		'numberposts'      => 1,
		'fields'           => 'ids',
		'meta_key'         => '_dla_item_id',
		'meta_value'       => $item['id'],
		'suppress_filters' => false,
	) );

	$is_update = false;
	if ( ! empty( $found ) ) {
		$post_id  = (int) $found[0];
		$imported = (int) get_post_meta( $post_id, '_dla_imported_at', true );
		$modified = (int) get_post_modified_time( 'U', true, $post_id );
		// Edited in wp-admin after our last import (>5s buffer) → don't clobber.
		if ( $imported && $modified > $imported + 5 ) {
			$skipped_modified++;
			continue;
		}
		// wp_slash(): wp_update_post() unslashes internally; without this it
		// strips backslashes from any block-attribute JSON in post_content.
		$res = wp_update_post( wp_slash( array(
			'ID'           => $post_id,
			'post_title'   => isset( $item['title'] ) ? $item['title'] : '',
			'post_content' => isset( $item['content'] ) ? $item['content'] : '',
		) ), true );
		if ( is_wp_error( $res ) ) { continue; }
		$is_update = true;
	} else {
		// Slug-collision: a non-DLA post already owns this slug → leave it.
		$collision = get_page_by_path( $slug, OBJECT, $cpt );
		if ( $collision && get_post_meta( $collision->ID, '_dla_item_id', true ) !== $item['id'] ) {
			$collisions++;
			continue;
		}
		// wp_slash(): wp_insert_post() unslashes internally; without this it
		// strips backslashes from any block-attribute JSON in post_content.
		$post_id = wp_insert_post( wp_slash( array(
			'post_type'    => $cpt,
			'post_status'  => 'publish',
			'post_name'    => $slug,
			'post_title'   => isset( $item['title'] ) ? $item['title'] : '',
			'post_content' => isset( $item['content'] ) ? $item['content'] : '',
		) ), true );
		if ( is_wp_error( $post_id ) || ! $post_id ) { continue; }
	}

	// wp_slash() meta values: update_post_meta() unslashes internally, so
	// backslash-bearing values (e.g. JSON or escaped text in custom meta) would
	// otherwise be corrupted. slash->unslash is identity for plain values.
	update_post_meta( $post_id, '_dla_item_id', wp_slash( $item['id'] ) );
	if ( isset( $item['gallery'] ) && is_array( $item['gallery'] ) ) {
		update_post_meta( $post_id, '_dla_gallery', wp_slash( $item['gallery'] ) );
	}
	$meta = isset( $item['meta'] ) && is_array( $item['meta'] ) ? $item['meta'] : array();
	foreach ( $fields as $key ) {
		if ( array_key_exists( $key, $meta ) ) {
			update_post_meta( $post_id, $key, wp_slash( $meta[ $key ] ) );
		}
	}
	if ( isset( $item['terms'] ) && is_array( $item['terms'] ) ) {
		wp_set_object_terms( $post_id, array_values( $item['terms'] ), $tax, false );
	}

	// Stamp the import time LAST so it's newer than the writes above (the
	// modified-since guard compares against this on the next run).
	update_post_meta( $post_id, '_dla_imported_at', time() );

	if ( $is_update ) { $updated++; } else { $inserted++; }
}

echo json_encode( array(
	'inserted'        => $inserted,
	'updated'         => $updated,
	'skippedModified' => $skipped_modified,
	'collisions'      => $collisions,
	'terms'           => $terms_done,
	'defaultsTrashed' => $defaults_trashed,
) );
