<?php
/**
 * Register pre-staged media files as WordPress attachments.
 *
 * Reads a JSON payload describing one or more media files that have already
 * been copied into the running site's wp-content/uploads/<year>/<month>/
 * directory, then calls wp_insert_attachment for each one. Idempotent:
 * before inserting it queries `_wp_attached_file` for an existing post; if
 * found, the existing post ID is reused instead.
 *
 * Used by `installMediaForUrl` in the streaming pipeline (Phase 1.5) to
 * synchronously import per-URL media into the live replica WP site so pages
 * render with real images during streaming rather than broken thumbnails.
 *
 * Input JSON shape:
 *   [
 *     {
 *       "filename": "hero.jpg",
 *       "year": "2024",
 *       "month": "11",
 *       "sourceUrl": "https://cdn.example.com/hero.jpg",
 *       "title":     "hero",            // optional; falls back to filename
 *       "mimeType":  "image/jpeg"        // optional; auto-detected via WP if omitted
 *     },
 *     ...
 *   ]
 *
 * Output (single line of JSON to stdout):
 *   {
 *     "results": [
 *       { "sourceUrl": "...", "filename": "hero.jpg", "postId": 42, "reused": false, "localUrl": "https://.../uploads/2024/11/hero.jpg" },
 *       ...
 *     ],
 *     "errors": [
 *       { "sourceUrl": "...", "filename": "...", "error": "..." }
 *     ]
 *   }
 *
 * Usage:
 *   wp eval-file install-media.php <payload.json>
 *
 * Must run via WP-CLI. Will not execute in a web context.
 *
 * @package Studio
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	return;
}

$payload_path = isset( $args[0] ) ? $args[0] : '';
if ( empty( $payload_path ) || ! file_exists( $payload_path ) ) {
	WP_CLI::error( "Payload not found: $payload_path" );
}

$raw = file_get_contents( $payload_path );
if ( false === $raw ) {
	WP_CLI::error( "Could not read payload: $payload_path" );
}

$entries = json_decode( $raw, true );
if ( ! is_array( $entries ) ) {
	WP_CLI::error( 'Payload JSON must be an array of entries.' );
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

$uploads = wp_upload_dir();
$results = array();
$errors  = array();

// --- Studio 120s IPC-silence-timeout mitigations (mirror import-wxr.php) -----
// Skip intermediate image-size (thumbnail) generation. Regenerating every
// registered size inside wp_generate_attachment_metadata() for hundreds of CDN
// images is the dominant cost and runs SILENTLY — tripping Studio's 120s "no
// activity" wp-cli IPC window and failing the WHOLE media install
// (mediaInstalled: 0; carried <img> left pointing at the source CDN). The carry
// replica renders faithfully from the full-size image (srcset variants fall
// back to src); thumbnails can be regenerated later via `wp media regenerate`.
add_filter( 'intermediate_image_sizes_advanced', '__return_empty_array' );

// Heartbeat. The result JSON is emitted only AFTER this loop (see the
// DLA_INSTALL_MEDIA_JSON_BEGIN sentinel), so a large media set otherwise runs
// silently past Studio's 120s window. WP_CLI::log writes to the STDOUT handle,
// keeping the IPC channel active; it is printed BEFORE the sentinel, so the
// parent's marker-delimited slice (media-install.ts) ignores it.
$dla_progress = 0;

foreach ( $entries as $entry ) {
	if ( 0 === ( ++$dla_progress % 5 ) ) {
		WP_CLI::log( sprintf( '  …installed %d media', $dla_progress ) );
	}
	$filename   = isset( $entry['filename'] ) ? (string) $entry['filename'] : '';
	$year       = isset( $entry['year'] ) ? (string) $entry['year'] : '';
	$month      = isset( $entry['month'] ) ? (string) $entry['month'] : '';
	$source_url = isset( $entry['sourceUrl'] ) ? (string) $entry['sourceUrl'] : '';

	if ( '' === $filename || '' === $year || '' === $month ) {
		$errors[] = array(
			'sourceUrl' => $source_url,
			'filename'  => $filename,
			'error'     => 'Missing filename/year/month in entry',
		);
		continue;
	}

	$rel_path = $year . '/' . $month . '/' . $filename;
	$abs_path = trailingslashit( $uploads['basedir'] ) . $rel_path;

	if ( ! file_exists( $abs_path ) ) {
		$errors[] = array(
			'sourceUrl' => $source_url,
			'filename'  => $filename,
			'error'     => 'File not found at expected uploads path: ' . $abs_path,
		);
		continue;
	}

	// Idempotency check: re-use any existing attachment whose
	// `_wp_attached_file` meta matches this relative path. Cheaper and
	// more correct than relying on `attachment_url_to_postid` which goes
	// through filtered URLs.
	$existing = get_posts(
		array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => 1,
			'fields'         => 'ids',
			'meta_query'     => array(
				array(
					'key'     => '_wp_attached_file',
					'value'   => $rel_path,
					'compare' => '=',
				),
			),
		)
	);

	if ( ! empty( $existing ) ) {
		$post_id   = (int) $existing[0];
		$local_url = trailingslashit( $uploads['baseurl'] ) . $rel_path;
		$results[] = array(
			'sourceUrl' => $source_url,
			'filename'  => $filename,
			'postId'    => $post_id,
			'reused'    => true,
			'localUrl'  => $local_url,
		);
		continue;
	}

	$mime_type = isset( $entry['mimeType'] ) && '' !== $entry['mimeType']
		? (string) $entry['mimeType']
		: ( wp_check_filetype( $filename )['type'] ?: 'application/octet-stream' );

	// SVG MIME rejection marker. Default WP disallows image/svg+xml, so
	// wp_check_filetype() yields no type for .svg unless a plugin (Safe SVG)
	// has allowed it — the octet-stream fallback above would then insert a
	// broken attachment. Emit a DISTINCT per-file error instead so the TS
	// layer (media-install.ts) can retry this one file with its rasterized
	// PNG sibling in a second mini-batch.
	if ( 'application/octet-stream' === $mime_type && preg_match( '/\.svg$/i', $filename ) ) {
		$errors[] = array(
			'sourceUrl' => $source_url,
			'filename'  => $filename,
			'error'     => 'svg_mime_rejected: image/svg+xml is not an allowed MIME type on this site (Safe SVG inactive)',
		);
		continue;
	}

	$title = isset( $entry['title'] ) && '' !== $entry['title']
		? (string) $entry['title']
		: pathinfo( $filename, PATHINFO_FILENAME );

	$attachment = array(
		'guid'           => trailingslashit( $uploads['baseurl'] ) . $rel_path,
		'post_mime_type' => $mime_type,
		'post_title'     => sanitize_text_field( $title ),
		'post_content'   => '',
		'post_status'    => 'inherit',
	);

	$post_id = wp_insert_attachment( $attachment, $abs_path );
	if ( is_wp_error( $post_id ) || ! $post_id ) {
		$errors[] = array(
			'sourceUrl' => $source_url,
			'filename'  => $filename,
			'error'     => is_wp_error( $post_id ) ? $post_id->get_error_message() : 'wp_insert_attachment returned 0',
		);
		continue;
	}

	$metadata = wp_generate_attachment_metadata( $post_id, $abs_path );
	wp_update_attachment_metadata( $post_id, $metadata );

	if ( '' !== $source_url ) {
		update_post_meta( $post_id, '_dla_source_url', $source_url );
	}

	$local_url = trailingslashit( $uploads['baseurl'] ) . $rel_path;
	$results[] = array(
		'sourceUrl' => $source_url,
		'filename'  => $filename,
		'postId'    => (int) $post_id,
		'reused'    => false,
		'localUrl'  => $local_url,
	);
}

$response_json = wp_json_encode(
	array(
		'results' => $results,
		'errors'  => $errors,
	)
);

// Write the full response to a sidecar file next to the payload. Studio's
// `wp eval-file` caps captured stdout at 64KB, so large responses (hundreds of
// attachments — common on Shopify CDN-heavy sites) get truncated mid-JSON and
// the parent can't parse them. The sidecar file is read directly off the host
// filesystem (Studio mounts the site dir), bypassing the stdout cap entirely.
$result_path = $payload_path . '.result.json';
$wrote_file  = false !== file_put_contents( $result_path, $response_json );

// Use a unique sentinel so the parent process can isolate our JSON in
// stdout even if WP echoes notices during the run. When the sidecar file was
// written, emit only a tiny pointer (always well under 64KB); otherwise fall
// back to inline JSON for backward compatibility with small payloads.
echo "DLA_INSTALL_MEDIA_JSON_BEGIN\n";
if ( $wrote_file ) {
	echo wp_json_encode( array( 'resultFile' => $result_path ) );
} else {
	echo $response_json;
}
echo "\nDLA_INSTALL_MEDIA_JSON_END\n";
