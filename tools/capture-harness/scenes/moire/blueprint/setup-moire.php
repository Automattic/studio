<?php
/**
 * Moire blueprint setup. Runs after the theme install and WXR import.
 *
 * - Registers the 8 featured images (files already unzipped into uploads/)
 *   under their original attachment IDs, so imported _thumbnail_id meta and
 *   wp-image-* references resolve without remote downloads.
 * - Rewrites the seed site's URL (http://localhost:8885) to this site's URL.
 * - Sets the title, tagline, reading and permalink options the demo uses.
 * - Clears any saved global styles so the Dia yellow/brown palette baked into
 *   the theme's theme.json is what renders.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$moire_old_url = 'http://localhost:8885';
$moire_new_url = untrailingslashit( home_url() );
$moire_media   = json_decode( file_get_contents( WP_CONTENT_DIR . '/moire-media.json' ), true );

require_once ABSPATH . 'wp-admin/includes/image.php';

foreach ( (array) $moire_media as $moire_item ) {
	if ( get_post( $moire_item['id'] ) ) {
		continue;
	}
	$moire_upload = wp_get_upload_dir();
	$moire_id     = wp_insert_attachment(
		array(
			'import_id'      => $moire_item['id'],
			'post_title'     => $moire_item['title'],
			'post_name'      => $moire_item['name'],
			'post_date'      => $moire_item['date'],
			'post_date_gmt'  => $moire_item['date_gmt'],
			'post_excerpt'   => $moire_item['caption'],
			'post_content'   => $moire_item['description'],
			'post_mime_type' => $moire_item['mime'],
			'post_status'    => 'inherit',
			'guid'           => $moire_upload['baseurl'] . '/' . $moire_item['file'],
		),
		$moire_upload['basedir'] . '/' . $moire_item['file'],
		(int) $moire_item['parent'],
		true
	);
	if ( is_wp_error( $moire_id ) ) {
		echo 'Media error: ' . esc_html( $moire_id->get_error_message() ) . "\n";
		continue;
	}
	wp_update_attachment_metadata( $moire_id, $moire_item['meta'] );
	if ( '' !== $moire_item['alt'] ) {
		update_post_meta( $moire_id, '_wp_attachment_image_alt', $moire_item['alt'] );
	}
	if ( $moire_item['parent'] ) {
		set_post_thumbnail( (int) $moire_item['parent'], $moire_id );
	}
}

// Replace the seed site URL in content (cover images, nav links, inline links).
global $wpdb;
if ( $moire_old_url !== $moire_new_url ) {
	$wpdb->query(
		$wpdb->prepare(
			"UPDATE {$wpdb->posts} SET post_content = REPLACE(post_content, %s, %s)",
			$moire_old_url,
			$moire_new_url
		)
	);
}

// The WXR importer drops the non-public wp_theme / wp_template_part_area terms,
// which detaches the customized "Blog Home" template and "Footer" part from the
// theme. Reattach them so the front page renders like the source site.
foreach ( get_posts( array( 'post_type' => array( 'wp_template', 'wp_template_part' ), 'post_status' => 'any', 'numberposts' => -1 ) ) as $moire_tpl ) {
	if ( ! has_term( '', 'wp_theme', $moire_tpl ) ) {
		wp_set_object_terms( $moire_tpl->ID, get_stylesheet(), 'wp_theme' );
	}
	if ( 'wp_template_part' === $moire_tpl->post_type && ! has_term( '', 'wp_template_part_area', $moire_tpl ) ) {
		$moire_area = in_array( $moire_tpl->post_name, array( 'header', 'footer' ), true ) ? $moire_tpl->post_name : 'uncategorized';
		wp_set_object_terms( $moire_tpl->ID, $moire_area, 'wp_template_part_area' );
	}
}

// Dia palette lives in theme.json; drop any user global styles that could override it.
foreach ( get_posts( array( 'post_type' => 'wp_global_styles', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) ) as $moire_gs ) {
	wp_delete_post( $moire_gs, true );
}

update_option( 'blogname', 'Moire' );
update_option( 'blogdescription', 'A journal of cloth, cut, and the art of getting dressed.' );
update_option( 'show_on_front', 'posts' );
update_option( 'posts_per_page', 10 );
update_option( 'permalink_structure', '/%year%/%monthnum%/%day%/%postname%/' );
update_option( 'rewrite_rules', '' );
flush_rewrite_rules( false );

// Remove the importer's bookkeeping post, if any.
foreach ( get_posts( array( 'post_type' => 'import_session', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids' ) ) as $moire_session ) {
	wp_delete_post( $moire_session, true );
}
